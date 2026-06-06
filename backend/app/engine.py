import json
import logging
import re
from copy import deepcopy
from dataclasses import dataclass, field
from io import StringIO
from pathlib import Path
from typing import Any

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap

from .schemas import (
    AnalyzeRequest,
    AnalyzeResponse,
    CustomProfileConfig,
    MutatedVariableDetail,
    OptimizationMetrics,
    ServiceAnalysisResult,
)


logger = logging.getLogger(__name__)

MAX_ITERATIONS = 50
BACKEND_TIER_NAME = "backend"
SAFE_HOST_PROFILES = {
    "silent_running": {"cpu_threshold_multiplier": 0.80, "ram_safety_buffer": 0.70},
    "max_performance": {"cpu_threshold_multiplier": 1.50, "ram_safety_buffer": 0.95},
    "background_dev": {"cpu_threshold_multiplier": 1.00, "ram_safety_buffer": 0.50},
}
SAFE_BACKEND_TIER = {
    "base_ram_mb": 64.00,
    "base_cpu": 0.10,
    "ram_scaling_factor": 0.00,
    "default_max_variables": {},
}
SAFE_BACKEND_FLOOR = {
    "ram_mb": 32.00,
    "variables": {},
}


@dataclass
class ServiceContext:
    name: str
    node: Any
    tier: str
    replicas: int
    initial_ram_mb: float = 0.0
    final_ram_mb: float = 0.0
    current_ram_mb: float = 0.0
    cpu: float = 0.0
    variables_mutated: dict[str, MutatedVariableDetail] = field(default_factory=dict)
    cgroups_injected: bool = False
    # x-tuning extension fields
    xtuning_ram_floor_mb: float | None = None
    xtuning_never_cgroup: bool = False
    xtuning_target_variable: str | None = None
    xtuning_optimizable: bool = True
    xtuning_hardcoded_ram_mb: float | None = None


import re

# Matches hardcoded memory bounds often found in Java/Node.js entrypoints.
# If these exist, environment tweaking is ignored by the runtime, so we
# must flag the service as unoptimizable unless overridden.
_HARDCODED_MEMORY_REGEX = re.compile(r"(-Xmx\d+[gmGM]|--max-old-space-size=\d+)")


def _parse_hardcoded_memory_mb(flag: str) -> float | None:
    if flag.startswith("--max-old-space-size="):
        try:
            return float(flag.split("=")[1])
        except ValueError:
            return None
    elif flag.startswith("-Xmx"):
        val_str = flag[4:]
        if not val_str:
            return None
        unit = val_str[-1].lower()
        try:
            val = float(val_str[:-1])
            if unit == 'g':
                return val * 1024.0
            elif unit == 'm':
                return val
        except ValueError:
            pass
    return None


def run_optimization_engine(payload: AnalyzeRequest) -> AnalyzeResponse:
    trace: list[str] = []
    warnings: list[str] = []

    if (
        payload.host_hardware.free_ram_mb > payload.host_hardware.total_ram_mb
        or payload.host_hardware.cpu_cores < 1
    ):
        return _response(
            status="INVALID_MANIFEST",
            yaml_string=payload.yaml_string,
            trace=["[Validate] Host hardware payload is not usable."],
            warnings=warnings,
            free_ram_mb=payload.host_hardware.free_ram_mb,
        )

    # Sanitize RAM inputs: absorb any floating-point micro-drift from the
    # frontend's unit-serialization layer before any budget math runs.
    total_ram_mb = int(round(payload.host_hardware.total_ram_mb))
    free_ram_mb  = int(round(payload.host_hardware.free_ram_mb))

    # Re-assign back so all downstream reads on payload.host_hardware stay
    # consistent without touching the Pydantic model's field types.
    payload.host_hardware.total_ram_mb = total_ram_mb
    payload.host_hardware.free_ram_mb  = free_ram_mb

    profiles = _load_safe_profiles(trace)
    yaml = YAML(typ="rt")
    yaml.preserve_quotes = True

    try:
        document = yaml.load(payload.yaml_string)
    except Exception as exc:
        return _response(
            status="INVALID_MANIFEST",
            yaml_string=payload.yaml_string,
            trace=[f"[Manifest] Could not parse YAML: {exc}"],
            warnings=warnings,
            free_ram_mb=payload.host_hardware.free_ram_mb,
        )

    # Null-serialization pass: round-trip the unmutated document tree through
    # _dump_yaml() immediately after parsing, before any variable injection or
    # scaling modifications. The result is a canonically formatted baseline that
    # eliminates quote-style and spacing false-positives in the frontend diff.
    baseline_yaml_string = _dump_yaml(yaml, document)

    # Pre-flight orchestrator check: reject non-Docker-Compose manifests fast,
    # before any service extraction or optimization logic runs.
    orchestrator_rejection = _detect_orchestrator(document)
    if orchestrator_rejection:
        name, hint = orchestrator_rejection
        return _response(
            status="UNSUPPORTED_ORCHESTRATOR",
            yaml_string=payload.yaml_string,
            trace=[
                f"[Orchestrator] Detected a {name} manifest. "
                f"{hint} "
                "This tool is designed for Docker Compose files that run on a local PC. "
                "Please provide a valid docker-compose.yml or compose.yaml."
            ],
            warnings=warnings,
            free_ram_mb=payload.host_hardware.free_ram_mb,
        )

    _check_port_conflicts(document, warnings)

    services = _extract_services(document)
    if not services:
        return _response(
            status="INVALID_MANIFEST",
            yaml_string=payload.yaml_string,
            trace=["[Manifest] No services found in manifest."],
            warnings=warnings,
            free_ram_mb=payload.host_hardware.free_ram_mb,
        )

    service_order = sorted(services)

    contexts = [
        ServiceContext(
            name=name,
            node=services[name],
            tier=_safe_tier(
                _classify_service(services[name], profiles, service_name=name, trace=trace),
                profiles,
                service_name=name,
                trace=trace,
            ),
            replicas=_extract_replicas(services[name]),
            **_extract_xtuning(services[name], name, trace),
        )
        for name in service_order
    ]
    trace.append(
        "[Manifest] Evaluating services alphabetically: "
        f"{', '.join(service.name for service in contexts)}."
    )

    floor_total = sum(
        profiles["floors"][service.tier]["ram_mb"] * service.replicas for service in contexts
    )
    if floor_total > payload.host_hardware.free_ram_mb:
        return _response(
            status="UNSOLVABLE",
            yaml_string=_dump_yaml(yaml, document),
            baseline_yaml_string=baseline_yaml_string,
            trace=trace
            + [
                "[Capacity] Minimum service memory floors exceed host RAM: "
                f"{round(floor_total, 1)}MB > {round(payload.host_hardware.free_ram_mb, 1)}MB."
            ],
            warnings=warnings,
            services=contexts,
            free_ram_mb=payload.host_hardware.free_ram_mb,
        )

    profile = _host_profile(payload.selected_profile, profiles, trace, payload.custom_profile_config)
    effective_free_ram = payload.host_hardware.free_ram_mb * profile["ram_safety_buffer"]
    cpu_budget = payload.host_hardware.cpu_cores * profile["cpu_threshold_multiplier"]

    # Calculate initial baseline footprints based on service tiers
    storage_type = payload.host_hardware.storage_type
    _inject_missing_defaults(contexts, profiles)
    _recalculate(contexts, profiles, storage_type)
    initial_predicted_ram = sum(service.current_ram_mb for service in contexts)

    # Pre-budget check: if a strict unoptimizable monolith needs more RAM than
    # the host physically has, bail immediately. Tuning cannot save it.
    for service in contexts:
        if not service.xtuning_optimizable and service.current_ram_mb > payload.host_hardware.free_ram_mb:
            return _response(
                status="UNSOLVABLE",
                yaml_string=_dump_yaml(yaml, document),
                baseline_yaml_string=baseline_yaml_string,
                trace=trace
                + [
                    f"[Capacity] Service '{service.name}' requires {round(service.current_ram_mb, 1)}MB "
                    "but is marked unoptimizable (hardcoded bounds or x-tuning.optimizable=false). "
                    f"This exceeds total host free RAM ({round(payload.host_hardware.free_ram_mb, 1)}MB)."
                ],
                warnings=warnings,
                services=contexts,
                free_ram_mb=payload.host_hardware.free_ram_mb,
            )

    if initial_predicted_ram > 0.80 * effective_free_ram:
        for service in contexts:
            service.current_ram_mb *= 0.90
        trace.append("[Optimize] Trimmed baseline service footprints by 10% because RAM is tight.")

    if payload.host_hardware.storage_type == "HDD":
        hdd_database_penalty = False
        for service in contexts:
            if service.tier == "database" and service.current_ram_mb > 256:
                service.current_ram_mb *= 1.25
                hdd_database_penalty = True
        if hdd_database_penalty:
            trace.append("[Hardware] Applied HDD database cushion for slower host storage.")
        else:
            warnings.append("HDD storage detected, but no database layer is running.")
    else:
        trace.append("[Hardware] Applied standard SSD profile for host storage.")

    for service in contexts:
        service.initial_ram_mb = service.current_ram_mb
        service.final_ram_mb = service.current_ram_mb
        service.cpu = _service_cpu(service, profiles)

    m_predicted = sum(service.current_ram_mb for service in contexts)
    c_predicted = sum(service.cpu for service in contexts)
    m_gap = m_predicted - effective_free_ram
    c_gap = c_predicted - cpu_budget
    trace.append(
        "[Baseline] Services need "
        f"{round(m_predicted, 1)}MB RAM and {round(c_predicted, 2)} CPU; "
        f"host gaps are {round(m_gap, 1)}MB RAM and {round(c_gap, 2)} CPU."
    )

    # Resolve per-request knobs from the custom profile config, falling back to
    # safe neutral values so non-custom requests are completely unaffected.
    cfg = payload.custom_profile_config
    iteration_cap = cfg.max_iterations if cfg is not None else MAX_ITERATIONS
    allow_cgroups = cfg.allow_cgroups if cfg is not None else True
    floor_strictness = cfg.floor_strictness if cfg is not None else 1.0

    # Check host limits and scale down services if memory is tight
    cgroups_used = False
    current_iteration = 0
    while (m_gap > 0 or c_gap > 0) and current_iteration < iteration_cap:
        current_iteration += 1
        changes = 0

        for service in contexts:
            if not service.xtuning_optimizable:
                continue
            if _at_floor(service, profiles, floor_strictness) or service.tier == "backend_low_priority":
                continue

            variable_name = _resolve_primary_variable(service, profiles)
            if not variable_name:
                continue

            if c_gap > 0:
                current_value = _read_env_number(service.node, variable_name)
                floor_value = _resolve_floor_value(service, variable_name, profiles)
                if current_value is None or floor_value is None or current_value <= floor_value:
                    continue

                next_value = max(floor_value, int(current_value) - 1)
                if next_value == current_value:
                    continue

                _write_env_value(service.node, variable_name, next_value)
                _record_mutation(service, variable_name, current_value, next_value)
                service.current_ram_mb = _service_ram(service, profiles, storage_type)
                service.final_ram_mb = service.current_ram_mb
                service.cpu = _service_cpu(service, profiles)
                m_predicted = sum(item.current_ram_mb for item in contexts)
                c_predicted = sum(item.cpu for item in contexts)
                m_gap = m_predicted - effective_free_ram
                c_gap = c_predicted - cpu_budget
                changes += 1
                if service.tier == "backend_hybrid":
                    trace.append(
                        "[Optimize] Throttled internal worker threads for "
                        f"service:{service.name} to reduce host CPU core saturation."
                    )
                else:
                    trace.append(
                        f"[Optimize] Throttled {variable_name} for "
                        f"service:{service.name} to reduce host CPU core saturation."
                    )

                if m_gap <= 0 and c_gap <= 0:
                    break
                continue

            current_value = _read_env_number(service.node, variable_name)
            floor_value = _resolve_floor_value(service, variable_name, profiles)
            if current_value is None or floor_value is None or current_value <= floor_value:
                # Primary variable is at floor; try the secondary variable
                # (e.g. WEB_CONCURRENCY or its alias for backend_hybrid).
                secondary_var = _resolve_secondary_variable(service, profiles)
                if not secondary_var or secondary_var == variable_name:
                    continue
                variable_name = secondary_var
                current_value = _read_env_number(service.node, variable_name)
                floor_value = _resolve_floor_value(service, variable_name, profiles)
                if current_value is None or floor_value is None or current_value <= floor_value:
                    continue

            next_value = max(floor_value, int(current_value * 0.5))
            if next_value == current_value:
                next_value = floor_value

            _write_env_value(service.node, variable_name, next_value)
            _record_mutation(service, variable_name, current_value, next_value)
            old_ram = service.current_ram_mb
            service.current_ram_mb = _service_ram(service, profiles, storage_type)
            service.final_ram_mb = service.current_ram_mb
            service.cpu = _service_cpu(service, profiles)
            m_predicted = sum(item.current_ram_mb for item in contexts)
            c_predicted = sum(item.cpu for item in contexts)
            m_gap = m_predicted - effective_free_ram
            c_gap = c_predicted - cpu_budget
            changes += 1
            saved_ram = max(0.0, old_ram - service.current_ram_mb)
            primary_name = _resolve_primary_variable(service, profiles)
            if variable_name != primary_name:
                trace.append(
                    f"[Optimize] Reduced {variable_name} for "
                    f"service:{service.name} to save memory as primary variable hit its minimum floor."
                )
            else:
                trace.append(
                    f"[Optimize] Reduced {service.name} {variable_name} from "
                    f"{round(current_value, 1)} to {round(next_value, 1)} to save "
                    f"{round(saved_ram, 1)}MB due to host memory limits."
                )

            if old_ram == service.current_ram_mb:
                continue
            if m_gap <= 0 and c_gap <= 0:
                break

        if changes == 0:
            trace.append("[Optimize] No more service knobs can be lowered safely.")
            break

    # Fallback to safety boundaries if we are still over capacity
    if m_gap > 0 or c_gap > 0:
        if not allow_cgroups:
            # With cgroup injection disabled, any remaining gap (RAM or CPU)
            # means we cannot fit the services — always UNSOLVABLE.
            trace.append(
                "[Safety] Cgroup injection is disabled by the custom profile configuration; "
                "cannot fit services within host capacity."
            )
            optimized_yaml = _dump_yaml(yaml, document)


            return AnalyzeResponse(
                status="UNSOLVABLE",
                optimized_yaml_string=optimized_yaml,
                optimized_yaml=optimized_yaml,
                baseline_yaml_string=baseline_yaml_string,
                metrics=OptimizationMetrics(
                    initial_predicted_ram_mb=initial_predicted_ram,
                    final_predicted_ram_mb=sum(s.final_ram_mb for s in contexts),
                    ram_margin_mb=effective_free_ram - sum(s.final_ram_mb for s in contexts),
                    cpu_saturation_pct=(sum(s.cpu for s in contexts) / cpu_budget * 100)
                    if cpu_budget
                    else 0.0,
                    free_ram_mb=payload.host_hardware.free_ram_mb,
                ),
                services=[
                    ServiceAnalysisResult(
                        name=service.name,
                        tier=service.tier,
                        replicas=service.replicas,
                        initial_ram_mb=service.initial_ram_mb,
                        final_ram_mb=service.final_ram_mb,
                        variables_mutated=service.variables_mutated,
                        cgroups_injected=service.cgroups_injected,
                        at_floor=_at_floor(service, profiles, floor_strictness),
                    )
                    for service in contexts
                ],
                topology=[
                    ServiceAnalysisResult(
                        name=service.name,
                        tier=service.tier,
                        replicas=service.replicas,
                        initial_ram_mb=service.initial_ram_mb,
                        final_ram_mb=service.final_ram_mb,
                        variables_mutated=service.variables_mutated,
                        cgroups_injected=service.cgroups_injected,
                        at_floor=_at_floor(service, profiles, floor_strictness),
                    )
                    for service in contexts
                ],
                warnings=warnings,
                execution_trace=trace,
                trace_log=trace,
            )
        cgroups_used = _inject_cgroups(contexts, profiles, c_gap, effective_free_ram)
        if cgroups_used:
            m_predicted = sum(service.final_ram_mb for service in contexts)
            c_predicted = sum(service.cpu for service in contexts)
            m_gap = m_predicted - effective_free_ram
            c_gap = c_predicted - cpu_budget
            trace.append(
                "[Safety] Added hard resource limits because tuning alone could not fit the host; "
                f"remaining RAM gap is {round(m_gap, 1)}MB."
            )

    final_predicted_ram = sum(service.final_ram_mb for service in contexts)
    final_cpu = sum(service.cpu for service in contexts)
    final_m_gap = final_predicted_ram - effective_free_ram
    final_c_gap = final_cpu - cpu_budget
    status = "FULLY_SOLVED"
    if cgroups_used and final_m_gap <= 0 and final_c_gap <= 0:
        status = "DEGRADED_SAFE"
    elif final_m_gap > 0 or final_c_gap > 0:
        status = "UNSOLVABLE"

    # Narrow-margin safety boundary: even when the layout technically fits,
    # a margin below 64 MB leaves almost no headroom for runtime variance.
    # Degrade the status to signal the host is critically tight on memory.
    if status == "FULLY_SOLVED" and (effective_free_ram - final_predicted_ram) < 64:
        status = "DEGRADED_SAFE"

    optimized_yaml = _dump_yaml(yaml, document)


    return AnalyzeResponse(
        status=status,
        optimized_yaml_string=optimized_yaml,
        optimized_yaml=optimized_yaml,
        baseline_yaml_string=baseline_yaml_string,
        metrics=OptimizationMetrics(
            initial_predicted_ram_mb=initial_predicted_ram,
            final_predicted_ram_mb=final_predicted_ram,
            ram_margin_mb=effective_free_ram - final_predicted_ram,
            cpu_saturation_pct=(final_cpu / cpu_budget * 100) if cpu_budget else 0.0,
            free_ram_mb=payload.host_hardware.free_ram_mb,
        ),
        services=[
            ServiceAnalysisResult(
                name=service.name,
                tier=service.tier,
                replicas=service.replicas,
                initial_ram_mb=service.initial_ram_mb,
                final_ram_mb=service.final_ram_mb,
                variables_mutated=service.variables_mutated,
                cgroups_injected=service.cgroups_injected,
                at_floor=_at_floor(service, profiles, floor_strictness),
            )
            for service in contexts
        ],
        topology=[
            ServiceAnalysisResult(
                name=service.name,
                tier=service.tier,
                replicas=service.replicas,
                initial_ram_mb=service.initial_ram_mb,
                final_ram_mb=service.final_ram_mb,
                variables_mutated=service.variables_mutated,
                cgroups_injected=service.cgroups_injected,
                at_floor=_at_floor(service, profiles, floor_strictness),
            )
            for service in contexts
        ],
        warnings=warnings,
        execution_trace=trace,
        trace_log=trace,
    )


def _load_profiles() -> dict[str, Any]:
    path = Path(__file__).with_name("profiles.json")
    return json.loads(path.read_text(encoding="utf-8"))


def _load_safe_profiles(trace: list[str]) -> dict[str, Any]:
    try:
        profiles = _load_profiles()
    except Exception as exc:
        logger.exception("Could not load profiles.json; using safe fallback profile structure.")
        trace.append(
            "[Profiles] Could not load profiles.json; using safe fallback profile structure: "
            f"{exc}"
        )
        profiles = {}

    return _validate_profiles(profiles, trace)


def _validate_profiles(profiles: Any, trace: list[str]) -> dict[str, Any]:
    if not isinstance(profiles, dict):
        logger.error("profiles.json root must be a JSON object; got %s.", type(profiles).__name__)
        trace.append(
            "[Profiles] profiles.json root must be an object; using safe fallback profile "
            "structure."
        )
        profiles = {}

    validated = dict(profiles)

    if not isinstance(validated.get("host_profiles"), dict):
        logger.error("profiles.json host_profiles must be an object; using safe host defaults.")
        trace.append(
            "[Profiles] profiles.json host_profiles must be an object; using safe host "
            "profile defaults."
        )
        validated["host_profiles"] = deepcopy(SAFE_HOST_PROFILES)

    if not isinstance(validated.get("tiers"), dict):
        logger.error("profiles.json tiers must be an object; using empty safe tier dictionary.")
        trace.append(
            "[Profiles] profiles.json tiers must be an object; using empty safe tier "
            "dictionary."
        )
        validated["tiers"] = {}

    if not isinstance(validated.get("floors"), dict):
        logger.error("profiles.json floors must be an object; using empty safe floor dictionary.")
        trace.append(
            "[Profiles] profiles.json floors must be an object; using empty safe floor "
            "dictionary."
        )
        validated["floors"] = {}

    _validate_tier_dictionaries(validated, trace)

    if not isinstance(validated.get("image_lookup_table"), dict):
        logger.error(
            "profiles.json image_lookup_table must be an object; using empty lookup table."
        )
        trace.append(
            "[Profiles] profiles.json image_lookup_table must be an object; using empty "
            "image lookup table."
        )
        validated["image_lookup_table"] = {}

    _ensure_backend_fallback(validated)
    return validated


def _validate_tier_dictionaries(profiles: dict[str, Any], trace: list[str]) -> None:
    tiers = profiles["tiers"]
    floors = profiles["floors"]

    for tier_name, tier_config in list(tiers.items()):
        if _valid_tier_config(tier_config):
            continue

        logger.error("Tier profile %r is malformed and will be ignored.", tier_name)
        trace.append(
            f"[Profiles] Tier profile '{tier_name}' is malformed; services using it will "
            f"fall back to '{BACKEND_TIER_NAME}'."
        )
        tiers.pop(tier_name, None)

    for tier_name, floor_config in list(floors.items()):
        if _valid_floor_config(floor_config):
            continue

        logger.error("Floor profile %r is malformed and will be ignored.", tier_name)
        trace.append(
            f"[Profiles] Floor profile '{tier_name}' is malformed; services using it will "
            f"fall back to '{BACKEND_TIER_NAME}'."
        )
        floors.pop(tier_name, None)


def _valid_tier_config(config: Any) -> bool:
    return (
        isinstance(config, dict)
        and _is_json_number(config.get("base_ram_mb"))
        and _is_json_number(config.get("base_cpu"))
        and _is_json_number(config.get("ram_scaling_factor"))
        and isinstance(config.get("default_max_variables"), dict)
    )


def _valid_floor_config(config: Any) -> bool:
    return (
        isinstance(config, dict)
        and _is_json_number(config.get("ram_mb"))
        and isinstance(config.get("variables"), dict)
    )


def _is_json_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _ensure_backend_fallback(profiles: dict[str, Any]) -> None:
    if not isinstance(profiles.get("tiers"), dict):
        profiles["tiers"] = {}
    if not isinstance(profiles.get("floors"), dict):
        profiles["floors"] = {}

    profiles["tiers"].setdefault(BACKEND_TIER_NAME, deepcopy(SAFE_BACKEND_TIER))
    profiles["floors"].setdefault(BACKEND_TIER_NAME, deepcopy(SAFE_BACKEND_FLOOR))


def _safe_tier(
    tier: Any,
    profiles: dict[str, Any],
    service_name: str | None = None,
    trace: list[str] | None = None,
) -> str:
    if isinstance(tier, str):
        normalized_tier = tier.strip().lower()
    else:
        normalized_tier = ""

    if not normalized_tier:
        _record_backend_tier_fallback(
            service_name,
            f"invalid tier token {tier!r}",
            trace,
        )
        return BACKEND_TIER_NAME

    if (
        normalized_tier in profiles.get("tiers", {})
        and normalized_tier in profiles.get("floors", {})
    ):
        return normalized_tier

    _ensure_backend_fallback(profiles)
    _record_backend_tier_fallback(
        service_name,
        f"tier '{normalized_tier}' is missing from tiers or floors configuration",
        trace,
    )
    return BACKEND_TIER_NAME


def _host_profile(
    selected_profile: str,
    profiles: dict[str, Any],
    trace: list[str],
    custom_profile_config: CustomProfileConfig | None = None,
) -> dict[str, float]:
    # If a custom config object is present, bypass the lookup table entirely.
    if custom_profile_config is not None:
        trace.append(
            f"[Profiles] Using custom host profile: "
            f"ram_safety_buffer={custom_profile_config.ram_safety_buffer}, "
            f"cpu_threshold_multiplier={custom_profile_config.cpu_threshold_multiplier}."
        )
        return {
            "ram_safety_buffer": custom_profile_config.ram_safety_buffer,
            "cpu_threshold_multiplier": custom_profile_config.cpu_threshold_multiplier,
        }

    host_profiles = profiles.get("host_profiles", {})
    profile = host_profiles.get(selected_profile) if isinstance(host_profiles, dict) else None
    if (
        isinstance(profile, dict)
        and _is_json_number(profile.get("ram_safety_buffer"))
        and _is_json_number(profile.get("cpu_threshold_multiplier"))
    ):
        return profile

    fallback_name = "background_dev"
    logger.error(
        "Host profile %r is missing or malformed; using %s.",
        selected_profile,
        fallback_name,
    )
    trace.append(
        f"[Profiles] Host profile '{selected_profile}' is missing or malformed; "
        f"using '{fallback_name}'."
    )
    return deepcopy(SAFE_HOST_PROFILES[fallback_name])


def _record_backend_tier_fallback(
    service_name: str | None,
    reason: str,
    trace: list[str] | None,
) -> None:
    rendered_service = service_name or "<unknown>"
    message = (
        f"[Profiles] Service '{rendered_service}' fell back to default "
        f"'{BACKEND_TIER_NAME}' tier because {reason}."
    )
    logger.warning(message)
    if trace is not None:
        trace.append(message)


def _safe_image_lookup_table(profiles: dict[str, Any]) -> dict[str, Any]:
    lookup_table = profiles.get("image_lookup_table", {})
    return lookup_table if isinstance(lookup_table, dict) else {}


# ---------------------------------------------------------------------------
# Orchestrator fingerprint table
# ---------------------------------------------------------------------------
# Each entry is: (top-level key, optional value substring, display name, hint)
# The value substring check is applied to str(document[key]) and is
# case-insensitive. Use None to match purely on key presence.
_ORCHESTRATOR_SIGNATURES: list[tuple[str, str | None, str, str]] = [
    (
        "apiVersion",
        None,
        "Kubernetes",
        "Kubernetes manifests are designed for distributed clusters, not local PC hosting.",
    ),
    (
        "kind",
        None,
        "Kubernetes",
        "Kubernetes manifests are designed for distributed clusters, not local PC hosting.",
    ),
    (
        "job",
        None,
        "HashiCorp Nomad",
        "Nomad job files target distributed infrastructure, not local Docker Compose stacks.",
    ),
    (
        "- hosts",
        None,
        "Ansible Playbook",
        "Ansible playbooks describe remote provisioning, not local container orchestration.",
    ),
    (
        "hosts",
        None,
        "Ansible Playbook",
        "Ansible playbooks describe remote provisioning, not local container orchestration.",
    ),
    (
        "swarm",
        None,
        "Docker Swarm stack",
        "Docker Swarm stack files require a multi-node Swarm cluster, not a single local host.",
    ),
]

# Docker Compose version strings that are also valid — do not false-positive on them.
_COMPOSE_VERSION_PREFIXES = ("2", "3")


def _detect_orchestrator(document: Any) -> tuple[str, str] | None:
    """Return (display_name, hint) when the document looks like a non-Compose
    orchestrator manifest, or ``None`` when it is safe to proceed.

    The check is intentionally shallow — it only inspects the top-level key
    set and, where relevant, the first few characters of a key's value.  This
    keeps the pre-flight O(1) on the key set regardless of manifest size.
    """
    if not isinstance(document, dict):
        return None

    top_keys = set(document.keys())

    # Kubernetes: presence of `apiVersion` or `kind` at the root is unambiguous.
    if "apiVersion" in top_keys or "kind" in top_keys:
        return (
            "Kubernetes",
            "Kubernetes manifests are designed for distributed clusters, not local PC hosting.",
        )

    # Nomad: `job` block at root with no `services` sibling.
    if "job" in top_keys and "services" not in top_keys:
        return (
            "HashiCorp Nomad",
            "Nomad job files target distributed infrastructure, not local Docker Compose stacks.",
        )

    # Ansible: playbooks are YAML *lists* at root, or contain a `hosts` key
    # without a `services` sibling.
    if isinstance(document, list) and document and isinstance(document[0], dict) and "hosts" in document[0]:
        return (
            "Ansible Playbook",
            "Ansible playbooks describe remote provisioning, not local container orchestration.",
        )
    if "hosts" in top_keys and "services" not in top_keys:
        return (
            "Ansible Playbook",
            "Ansible playbooks describe remote provisioning, not local container orchestration.",
        )

    # Helm chart: Chart.yaml always has an `apiVersion` (caught above) and a
    # `description` field. Belt-and-suspenders check for Chart.yaml shape.
    if "description" in top_keys and "appVersion" in top_keys and "services" not in top_keys:
        return (
            "Helm Chart (Chart.yaml)",
            "Helm chart definitions describe Kubernetes packaging, not local Docker Compose stacks.",
        )

    # Docker Swarm stack files look exactly like Compose files but use
    # `deploy.mode: global` or reference swarm-only secrets/configs at root.
    if "secrets" in top_keys and "services" in top_keys:
        # Compose files can also have secrets — only flag when the secrets block
        # contains a `driver` key, which is Swarm-only.
        secrets_block = document.get("secrets")
        if isinstance(secrets_block, dict):
            for secret_cfg in secrets_block.values():
                if isinstance(secret_cfg, dict) and "driver" in secret_cfg:
                    return (
                        "Docker Swarm stack",
                        "Docker Swarm stack files require a multi-node Swarm cluster, not a single local host.",
                    )

    return None


def _extract_services(document: Any) -> dict[str, Any]:
    if isinstance(document, dict) and isinstance(document.get("services"), dict):
        return document["services"]
    # Strictly require a `services` block — never fall back to treating top-level
    # YAML keys (e.g. `version`, `volumes`) as service definitions.
    return {}


def _extract_replicas(service: Any) -> int:
    try:
        replicas = service.get("deploy", {}).get("replicas", 1)
        return max(1, int(replicas))
    except Exception:
        return 1


def _extract_xtuning(
    service: Any,
    service_name: str,
    trace: list[str],
) -> dict[str, Any]:
    """Parse the optional ``x-tuning`` extension block from a service node.

    Returns a dict suitable for splatting into the ServiceContext constructor.
    Keys are only included when the corresponding x-tuning sub-key is present
    and valid, so absent keys fall back to the dataclass field defaults.
    """
    result: dict[str, Any] = {}
    if not isinstance(service, dict):
        return result

    xtuning = service.get("x-tuning")
    if not isinstance(xtuning, dict):
        return result

    # ram_floor_mb — must be a positive number
    raw_floor = xtuning.get("ram_floor_mb")
    if _is_json_number(raw_floor) and raw_floor > 0:
        result["xtuning_ram_floor_mb"] = float(raw_floor)
        trace.append(
            f"[x-tuning] Service '{service_name}' overrides RAM floor to "
            f"{raw_floor} MB via x-tuning.ram_floor_mb."
        )
    elif raw_floor is not None:
        trace.append(
            f"[x-tuning] Service '{service_name}' has invalid x-tuning.ram_floor_mb "
            f"({raw_floor!r}); ignoring and using tier default."
        )

    # never_cgroup — truthy boolean
    raw_nc = xtuning.get("never_cgroup")
    if raw_nc is True:
        result["xtuning_never_cgroup"] = True
        trace.append(
            f"[x-tuning] Service '{service_name}' is marked never_cgroup; "
            "it will be excluded from memory cgroup limits."
        )

    # target_variable — explicit variable name override for the tuning loop.
    # Allows services using non-standard env var names (e.g. POOL_SIZE, JAVA_OPTS)
    # to participate in optimization without modifying profiles.json.
    raw_tv = xtuning.get("target_variable")
    if isinstance(raw_tv, str) and raw_tv.strip():
        result["xtuning_target_variable"] = raw_tv.strip()
        trace.append(
            f"[x-tuning] Service '{service_name}' overrides tuning target to "
            f"'{raw_tv.strip()}' via x-tuning.target_variable."
        )
    elif raw_tv is not None:
        trace.append(
            f"[x-tuning] Service '{service_name}' has invalid x-tuning.target_variable "
            f"({raw_tv!r}); ignoring and using profile synonym resolution."
        )

    # Always attempt to extract hardcoded memory bounds so we can correctly compute
    # the baseline RAM footprint, even if the service is explicitly marked.
    command_str = str(service.get("command", ""))
    entrypoint_str = str(service.get("entrypoint", ""))
    match = _HARDCODED_MEMORY_REGEX.search(command_str) or _HARDCODED_MEMORY_REGEX.search(entrypoint_str)
    if match:
        extracted_mb = _parse_hardcoded_memory_mb(match.group(1))
        if extracted_mb:
            result["xtuning_hardcoded_ram_mb"] = extracted_mb

    # optimizable — explicit boolean override. If absent, fallback to regex match.
    raw_opt = xtuning.get("optimizable")
    if isinstance(raw_opt, bool):
        result["xtuning_optimizable"] = raw_opt
        trace.append(
            f"[x-tuning] Service '{service_name}' explicitly marked optimizable={raw_opt}."
        )
    elif match:
        result["xtuning_optimizable"] = False
        trace.append(
            f"[x-tuning] Service '{service_name}' has hardcoded memory bounds in command/entrypoint; "
            "marking as unoptimizable."
        )

    return result


def _classify_service(
    service: Any,
    profiles: dict[str, Any],
    service_name: str | None = None,
    trace: list[str] | None = None,
) -> str:
    # --- Explicit tier via compiler.tier label ---
    # Walk the labels block directly (dict or list form) so we reliably match the
    # label KEY ("compiler.tier") against the tier VALUE (e.g. "database").
    if isinstance(service, dict):
        labels = service.get("labels", {})
        if isinstance(labels, dict):
            for label_key, label_val in labels.items():
                if str(label_key).lower() == "compiler.tier":
                    candidate = str(label_val).strip().lower()
                    if candidate in profiles.get("tiers", {}):
                        return candidate
        elif isinstance(labels, list):
            for item in labels:
                if isinstance(item, str) and item.lower().startswith("compiler.tier="):
                    candidate = item.split("=", 1)[1].strip().lower()
                    if candidate in profiles.get("tiers", {}):
                        return candidate

    image = str(service.get("image", "") if isinstance(service, dict) else "").lower()
    for image_fragment, tier in _safe_image_lookup_table(profiles).items():
        if image_fragment in image:
            return tier

    # Ports = highest priority (after explicit tier / image match)
    if isinstance(service, dict) and service.get("ports"):
        return "backend_hybrid"

    # Keyword detection = lowest priority.
    # Include the service *name* in the token scan — compound names like
    # "celery_worker", "celery-worker", or "workerProcess" must be detected
    # even when the service body itself contains no matching keywords.
    name_part = service_name or ""
    body_parts = " ".join(str(v) for v in service.values()) if isinstance(service, dict) else str(service)
    service_text = f"{name_part} {body_parts}"

    tokens = set(re.findall(r"[A-Za-z]+", service_text.lower()))

    if any(k in t for t in tokens for k in {"worker", "celery", "beat", "queue"}):
        return "backend_low_priority"

    _record_backend_tier_fallback(
        service_name,
        "no explicit tier, image, port, or keyword classifier matched",
        trace,
    )
    return BACKEND_TIER_NAME


def _walk_strings(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        items: list[str] = []
        for key, child in value.items():
            items.extend(_walk_strings(key))
            items.extend(_walk_strings(child))
        return items
    if isinstance(value, list):
        items = []
        for child in value:
            items.extend(_walk_strings(child))
        return items
    return []


def _inject_missing_defaults(contexts: list[ServiceContext], profiles: dict[str, Any]) -> None:
    for service in contexts:
        tier_config = profiles["tiers"][service.tier]
        defaults = tier_config["default_max_variables"]
        aliases_map = tier_config.get("variable_aliases", {})
        for canonical_key, default_value in defaults.items():
            # Skip injection when the canonical variable OR any of its synonyms
            # is already present — the service already configures this knob.
            all_candidates = [canonical_key] + aliases_map.get(canonical_key, [])
            if all(_read_env_number(service.node, c) is None for c in all_candidates):
                _write_env_value(service.node, canonical_key, default_value)


def _primary_variable_name(tier: str) -> str | None:
    """Return the *canonical* primary variable name for a tier, or None."""
    return {
        "database": "max_connections",
        "backend_hybrid": "WORKERS",
        "cache": "maxmemory",
    }.get(tier)


def _resolve_variable(service_node: Any, canonical_name: str, tier_config: dict) -> str:
    """Return the first environment variable present in *service_node* from the
    canonical name and its configured aliases, or *canonical_name* itself when
    none is set (enabling downstream default injection).
    """
    aliases = tier_config.get("variable_aliases", {}).get(canonical_name, [])
    for candidate in [canonical_name] + list(aliases):
        if _read_env_number(service_node, candidate) is not None:
            return candidate
    return canonical_name


def _resolve_primary_variable(service: ServiceContext, profiles: dict[str, Any]) -> str | None:
    """Return the actual environment variable name to tune for *service*.

    Priority order:
    1. ``x-tuning.target_variable`` override (absolute precedence)
    2. Canonical primary variable or the first alias found in the environment
    3. ``None`` when the tier has no primary variable
    """
    if service.xtuning_target_variable:
        return service.xtuning_target_variable
    canonical = _primary_variable_name(service.tier)
    if canonical is None:
        return None
    tier_config = profiles["tiers"][service.tier]
    return _resolve_variable(service.node, canonical, tier_config)


def _resolve_secondary_variable(service: ServiceContext, profiles: dict[str, Any]) -> str | None:
    """For ``backend_hybrid`` services, return the resolved secondary variable
    (WEB_CONCURRENCY or its alias) after the primary is exhausted.
    Returns ``None`` for tiers without a secondary tuning variable.
    """
    if service.tier != "backend_hybrid":
        return None
    tier_config = profiles["tiers"][service.tier]
    return _resolve_variable(service.node, "WEB_CONCURRENCY", tier_config)


def _resolve_floor_value(service: ServiceContext, resolved_variable_name: str, profiles: dict[str, Any]) -> float | None:
    """Look up the floor value for a resolved (possibly aliased) variable name.

    Floor entries are always keyed by canonical name, so this function maps an
    alias back to its canonical before looking up the floor.
    """
    tier = service.tier
    floor_vars = profiles["floors"][tier]["variables"]
    # Direct hit: resolved name IS the canonical.
    if resolved_variable_name in floor_vars:
        return floor_vars[resolved_variable_name]
    # Indirect hit: resolved name is an alias — walk the alias table.
    tier_config = profiles["tiers"][tier]
    for canon, alias_list in tier_config.get("variable_aliases", {}).items():
        if resolved_variable_name in alias_list and canon in floor_vars:
            return floor_vars[canon]
    # Custom x-tuning override: fall back to the tier's canonical primary floor.
    if resolved_variable_name == service.xtuning_target_variable:
        canonical_primary = _primary_variable_name(tier)
        if canonical_primary in floor_vars:
            return floor_vars[canonical_primary]
    return None


def _read_env_number(service: Any, key: str) -> float | None:
    environment = _ensure_environment(service)
    if isinstance(environment, dict) and key in environment:
        return _to_float(environment[key])
    if isinstance(environment, list):
        prefix = f"{key}="
        for item in environment:
            if isinstance(item, str) and item.startswith(prefix):
                return _to_float(item[len(prefix) :])
    return None


def _write_env_value(service: Any, key: str, value: float) -> None:
    environment = _ensure_environment(service)
    rendered_value: int | float = int(value) if float(value).is_integer() else value
    if isinstance(environment, dict):
        environment[key] = rendered_value
        return
    if isinstance(environment, list):
        prefix = f"{key}="
        for index, item in enumerate(environment):
            if isinstance(item, str) and item.startswith(prefix):
                environment[index] = f"{key}={rendered_value}"
                return
        environment.append(f"{key}={rendered_value}")


def _ensure_environment(service: Any) -> Any:
    if not isinstance(service, dict):
        return CommentedMap()
    environment = service.get("environment")
    if isinstance(environment, (dict, list)):
        return environment
    environment = CommentedMap()
    service["environment"] = environment
    return environment


def _to_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _recalculate(
    contexts: list[ServiceContext],
    profiles: dict[str, Any],
    storage_type: str = "",
) -> None:
    for service in contexts:
        service.current_ram_mb = _service_ram(service, profiles, storage_type)
        service.final_ram_mb = service.current_ram_mb
        service.cpu = _service_cpu(service, profiles)


_HDD_MAX_CONNECTIONS_CEIL = 50
_HDD_MAXMEMORY_CEIL = 50


def _service_ram(
    service: ServiceContext,
    profiles: dict[str, Any],
    storage_type: str = "",
) -> float:
    replicas = service.replicas
    if service.xtuning_hardcoded_ram_mb is not None:
        return service.xtuning_hardcoded_ram_mb * replicas

    tier_config = profiles["tiers"][service.tier]
    is_hdd = storage_type == "HDD"
    if service.tier == "database":
        var = _resolve_variable(service.node, "max_connections", tier_config)
        max_connections = _read_env_number(service.node, var)
        max_connections = max_connections if max_connections is not None else 100
        if is_hdd:
            max_connections = min(max_connections, _HDD_MAX_CONNECTIONS_CEIL)
        return (128.0 + (max_connections * 15.0)) * replicas
    if service.tier == "backend_hybrid":
        workers_var = _resolve_variable(service.node, "WORKERS", tier_config)
        workers = _read_env_number(service.node, workers_var)
        workers = workers if workers is not None else 4
        web_var = _resolve_variable(service.node, "WEB_CONCURRENCY", tier_config)
        web_concurrency = _read_env_number(service.node, web_var)
        web_concurrency = web_concurrency if web_concurrency is not None else 4
        return (64.0 + (workers * 32.0) + (web_concurrency * 48.0)) * replicas
    if service.tier == "cache":
        var = _resolve_variable(service.node, "maxmemory", tier_config)
        maxmemory = _read_env_number(service.node, var)
        maxmemory = maxmemory if maxmemory is not None else 256
        if is_hdd:
            maxmemory = min(maxmemory, _HDD_MAXMEMORY_CEIL)
        return (16.0 + maxmemory) * replicas
    return tier_config["base_ram_mb"] * replicas


def _service_cpu(service: ServiceContext, profiles: dict[str, Any]) -> float:
    tier_config = profiles["tiers"][service.tier]
    base_cpu = tier_config["base_cpu"] * service.replicas
    canonical = _primary_variable_name(service.tier)
    if not canonical:
        return base_cpu

    # Resolve to whichever variable name is actually set in the environment.
    variable_name = _resolve_variable(service.node, canonical, tier_config)
    default_value = tier_config["default_max_variables"].get(canonical)
    current_value = _read_env_number(service.node, variable_name)
    if not default_value or current_value is None:
        return base_cpu

    cpu_scale = current_value / default_value
    if service.tier == "backend_hybrid":
        web_var = _resolve_variable(service.node, "WEB_CONCURRENCY", tier_config)
        web_default = tier_config["default_max_variables"].get("WEB_CONCURRENCY")
        web_value = _read_env_number(service.node, web_var)
        if web_default and web_value is not None:
            cpu_scale = (cpu_scale + (web_value / web_default)) / 2

    return base_cpu * cpu_scale


def _at_floor(
    service: ServiceContext,
    profiles: dict[str, Any],
    floor_strictness: float = 1.0,
) -> bool:
    floor = profiles["floors"][service.tier]
    # Prefer the per-service x-tuning RAM floor override when present.
    base_floor_mb = (
        service.xtuning_ram_floor_mb
        if service.xtuning_ram_floor_mb is not None
        else floor["ram_mb"]
    )
    # Apply floor_strictness as a multiplier on the raw floor target.
    # A value of 1.0 (the default) leaves the floor completely unchanged.
    effective_floor_mb = base_floor_mb * floor_strictness
    if service.current_ram_mb <= effective_floor_mb * service.replicas:
        return True
    for canonical_var, floor_value in floor["variables"].items():
        # Resolve to the actual environment variable (canonical or alias) so
        # services using non-standard names are correctly floor-detected.
        tier_config = profiles["tiers"][service.tier]
        resolved_var = _resolve_variable(service.node, canonical_var, tier_config)
        current_value = _read_env_number(service.node, resolved_var)
        if current_value is not None and current_value > floor_value:
            return False
    return bool(floor["variables"])


def _record_mutation(
    service: ServiceContext, variable_name: str, old_value: float, new_value: float
) -> None:
    existing = service.variables_mutated.get(variable_name)
    from_value = existing.from_val if existing else old_value
    service.variables_mutated[variable_name] = MutatedVariableDetail(
        from_val=from_value,
        to_val=new_value,
    )


def _inject_cgroups(
    contexts: list[ServiceContext],
    profiles: dict[str, Any],
    c_gap: float,
    effective_free_ram: float,
) -> bool:
    active_footprint = sum(service.current_ram_mb for service in contexts)
    overflow = max(0.0, active_footprint - effective_free_ram)

    # Partition services into those eligible for cgroup limits and those exempt.
    # A service is exempt if never_cgroup is true OR it is not optimizable.
    exempt = [s for s in contexts if s.xtuning_never_cgroup or not s.xtuning_optimizable]
    eligible = [s for s in contexts if not s.xtuning_never_cgroup and s.xtuning_optimizable]

    eligible_footprint = sum(s.current_ram_mb for s in eligible)

    # Pre-flight: verify eligible services can absorb the full overflow before
    # writing a single byte to the YAML, so we never apply partial limits.
    if overflow > 0 and eligible:
        total_eligible_headroom = sum(
            max(
                0.0,
                s.current_ram_mb - (
                    s.xtuning_ram_floor_mb
                    if s.xtuning_ram_floor_mb is not None
                    else profiles["floors"][s.tier]["ram_mb"]
                ) * s.replicas,
            )
            for s in eligible
        )
        if total_eligible_headroom < overflow:
            # Eligible services cannot absorb the full overflow without pushing
            # at least one of them below its floor — refuse to apply partial limits.
            return False

    injected = False
    for service in eligible:
        floor_ram = (
            service.xtuning_ram_floor_mb
            if service.xtuning_ram_floor_mb is not None
            else profiles["floors"][service.tier]["ram_mb"]
        )
        # Redistribute overflow proportionally across eligible services only.
        reduction_share = (
            overflow * (service.current_ram_mb / eligible_footprint)
            if eligible_footprint
            else 0.0
        )
        budgeted_service_ram = service.current_ram_mb - reduction_share
        limit_mb = max(budgeted_service_ram / service.replicas, floor_ram)
        service.final_ram_mb = limit_mb * service.replicas
        _write_resource_limit(service.node, "memory", f"{int(limit_mb)}M")
        if c_gap > 0:
            cpu_limit = max(0.05, service.cpu / service.replicas)
            _write_resource_limit(service.node, "cpus", round(cpu_limit, 2))
        service.cgroups_injected = True
        injected = True

    # Exempt services keep their current RAM unchanged but still receive a CPU
    # limit when the CPU budget is blown, honouring the intent of never_cgroup
    # (no memory cap) while still participating in CPU governance.
    for service in exempt:
        service.final_ram_mb = service.current_ram_mb
        if c_gap > 0:
            cpu_limit = max(0.05, service.cpu / service.replicas)
            _write_resource_limit(service.node, "cpus", round(cpu_limit, 2))

    return injected


def _write_resource_limit(service: Any, key: str, value: Any) -> None:
    deploy = service.setdefault("deploy", CommentedMap())
    resources = deploy.setdefault("resources", CommentedMap())
    limits = resources.setdefault("limits", CommentedMap())
    limits[key] = value


def _check_port_conflicts(document: Any, warnings: list[str]) -> None:
    """Scan every service's ports block and emit warnings for host-port conflicts.

    Two conditions constitute a conflict:
    - The same (host_interface, host_port) tuple is claimed by more than one service.
    - A specific-interface binding shares its port number with an existing "0.0.0.0"
      wildcard binding that belongs to a different service (and vice-versa).
    """
    if not isinstance(document, dict):
        return

    raw_services: Any = document.get("services", document)
    if not isinstance(raw_services, dict):
        return

    # Map (host_interface, host_port) -> first service name that claimed it.
    seen: dict[tuple[str, str], str] = {}

    for service_name, service_node in raw_services.items():
        if not isinstance(service_node, dict):
            continue

        ports_block = service_node.get("ports")
        if not ports_block or not isinstance(ports_block, list):
            continue

        for entry in ports_block:
            bindings = _normalise_port_entry(entry)
            for iface, host_port in bindings:
                key = (iface, host_port)

                # --- Exact-duplicate check ---
                if key in seen:
                    if seen[key] != service_name:
                        warnings.append(
                            f"[Ports] Host port conflict on {iface}:{host_port} "
                            f"between services '{seen[key]}' and '{service_name}'."
                        )
                    # Already recorded; no need to overwrite.
                    continue

                # --- Wildcard vs specific-interface cross-check ---
                if iface == "0.0.0.0":
                    # A wildcard binding collides with any specific binding on the
                    # same port that is already registered from a *different* service.
                    for (existing_iface, existing_port), owner in seen.items():
                        if existing_port == host_port and owner != service_name:
                            warnings.append(
                                f"[Ports] Host port conflict on port {host_port}: "
                                f"wildcard binding by '{service_name}' conflicts with "
                                f"specific binding {existing_iface}:{host_port} "
                                f"by '{owner}'."
                            )
                else:
                    # A specific-interface binding collides with an existing wildcard
                    # (0.0.0.0) on the same port from a different service.
                    wildcard_key = ("0.0.0.0", host_port)
                    if wildcard_key in seen and seen[wildcard_key] != service_name:
                        warnings.append(
                            f"[Ports] Host port conflict on port {host_port}: "
                            f"specific binding {iface}:{host_port} by '{service_name}' "
                            f"conflicts with wildcard binding by '{seen[wildcard_key]}'."
                        )

                seen[key] = service_name


def _normalise_port_entry(entry: Any) -> list[tuple[str, str]]:
    """Return a list of (host_interface, host_port) tuples for a single port entry.

    Handles:
    - Short string syntax: "8080:80", "127.0.0.1:8080:80", bare "80"
    - Long object syntax: {published: <host_port>, target: <container_port>}
    """
    DEFAULT_IFACE = "0.0.0.0"

    if isinstance(entry, dict):
        # Long syntax — only the published (host) side matters for conflict detection.
        published = entry.get("published")
        if published is None:
            return []
        return [(DEFAULT_IFACE, str(published))]

    if not isinstance(entry, (str, int)):
        return []

    raw = str(entry).strip()
    if not raw:
        return []

    # Split on "/" to drop any protocol suffix (e.g. "8080:80/tcp").
    raw = raw.split("/")[0]

    parts = raw.split(":")
    if len(parts) == 1:
        # Bare container port with no host binding — no host port to conflict.
        return []
    if len(parts) == 2:
        # "host_port:container_port" — no interface specified.
        return [(DEFAULT_IFACE, parts[0])]
    # "interface:host_port:container_port"
    iface = parts[0] if parts[0] else DEFAULT_IFACE
    return [(iface, parts[1])]


def _dump_yaml(yaml: YAML, document: Any) -> str:
    buffer = StringIO()
    yaml.dump(document, buffer)
    return buffer.getvalue()


def _response(
    status: str,
    yaml_string: str,
    trace: list[str],
    warnings: list[str],
    services: list[ServiceContext] | None = None,
    baseline_yaml_string: str = "",
    free_ram_mb: float = 0.0,
) -> AnalyzeResponse:
    service_contexts = services or []
    return AnalyzeResponse(
        status=status,
        optimized_yaml_string=yaml_string,
        optimized_yaml=yaml_string,
        baseline_yaml_string=baseline_yaml_string or yaml_string,
        metrics=OptimizationMetrics(
            initial_predicted_ram_mb=sum(service.initial_ram_mb for service in service_contexts),
            final_predicted_ram_mb=sum(service.final_ram_mb for service in service_contexts),
            ram_margin_mb=0.0,
            cpu_saturation_pct=0.0,
            free_ram_mb=free_ram_mb,
        ),
        services=[
            ServiceAnalysisResult(
                name=service.name,
                tier=service.tier,
                replicas=service.replicas,
                initial_ram_mb=service.initial_ram_mb,
                final_ram_mb=service.final_ram_mb,
                variables_mutated=service.variables_mutated,
                cgroups_injected=service.cgroups_injected,
                at_floor=False,
            )
            for service in service_contexts
        ],
        topology=[
            ServiceAnalysisResult(
                name=service.name,
                tier=service.tier,
                replicas=service.replicas,
                initial_ram_mb=service.initial_ram_mb,
                final_ram_mb=service.final_ram_mb,
                variables_mutated=service.variables_mutated,
                cgroups_injected=service.cgroups_injected,
                at_floor=False,
            )
            for service in service_contexts
        ],
        warnings=warnings,
        execution_trace=trace,
        trace_log=trace,
    )
