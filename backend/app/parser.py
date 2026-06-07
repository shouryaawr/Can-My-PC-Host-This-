from __future__ import annotations

import logging
import re
from collections import deque
from io import StringIO
from typing import Any

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap

from .patcher import build_error_response
from .schemas import AnalyzeRequest, ParsedManifest, ProfilesConfig, load_profiles_config

logger = logging.getLogger(__name__)


class ManifestValidationError(ValueError):
    pass


class CircularDependencyError(ManifestValidationError):
    pass


MAX_SERVICES: int = 50
BACKEND_TIER_NAME = "backend"

SAFE_HOST_PROFILES: dict[str, dict[str, float]] = {
    "silent_running": {"cpu_threshold_multiplier": 0.80, "ram_safety_buffer": 0.70},
    "max_performance": {"cpu_threshold_multiplier": 1.50, "ram_safety_buffer": 0.95},
    "background_dev": {"cpu_threshold_multiplier": 1.00, "ram_safety_buffer": 0.50},
}
SAFE_BACKEND_TIER: dict[str, Any] = {
    "base_ram_mb": 64.00,
    "base_cpu": 0.10,
    "ram_scaling_factor": 0.00,
    "default_max_variables": {},
}
SAFE_BACKEND_FLOOR: dict[str, Any] = {
    "ram_mb": 32.00,
    "variables": {},
}

_HARDCODED_MEMORY_REGEX = re.compile(r"(-Xmx\d+[gmGM]|--max-old-space-size=\d+)")
HARDCODED_MEMORY_REGEX = _HARDCODED_MEMORY_REGEX


def load_profiles(trace: list[str] | None = None) -> ProfilesConfig:
    return load_profiles_config()


def parse_analysis_payload(payload: AnalyzeRequest, profiles: ProfilesConfig) -> ParsedManifest:
    trace: list[str] = []
    warnings: list[str] = []

    if (
        payload.host_hardware.free_ram_mb > payload.host_hardware.total_ram_mb
        or payload.host_hardware.cpu_cores < 1
    ):
        return ParsedManifest(
            payload=payload,
            trace=trace,
            warnings=warnings,
            profiles=profiles,
            response=build_error_response(
                status="INVALID_MANIFEST",
                yaml_string=payload.yaml_string,
                trace=["[Validate] Host hardware payload is invalid."],
                warnings=warnings,
                free_ram_mb=payload.host_hardware.free_ram_mb,
            ),
        )

    payload.host_hardware.total_ram_mb = int(round(payload.host_hardware.total_ram_mb))
    payload.host_hardware.free_ram_mb = int(round(payload.host_hardware.free_ram_mb))

    yaml = make_yaml()

    try:
        document = yaml.load(payload.yaml_string)
    except Exception as exc:
        return ParsedManifest(
            payload=payload,
            trace=trace,
            warnings=warnings,
            profiles=profiles,
            yaml=yaml,
            response=build_error_response(
                status="INVALID_MANIFEST",
                yaml_string=payload.yaml_string,
                trace=[f"[Manifest] YAML parse error: {exc}"],
                warnings=warnings,
                free_ram_mb=payload.host_hardware.free_ram_mb,
            ),
        )

    baseline_yaml_string = dump_yaml(yaml, document)

    orchestrator = detect_orchestrator(document)
    if orchestrator:
        name, hint = orchestrator
        return ParsedManifest(
            payload=payload,
            trace=trace,
            warnings=warnings,
            profiles=profiles,
            yaml=yaml,
            document=document,
            baseline_yaml_string=baseline_yaml_string,
            response=build_error_response(
                status="UNSUPPORTED_ORCHESTRATOR",
                yaml_string=payload.yaml_string,
                trace=[
                    f"[Orchestrator] Detected {name} manifest. "
                    f"{hint} "
                    "This tool is designed for Docker Compose files that run on a local PC."
                ],
                warnings=warnings,
                free_ram_mb=payload.host_hardware.free_ram_mb,
            ),
        )

    check_port_conflicts(document, warnings)
    services = extract_services(document)

    if not services:
        return ParsedManifest(
            payload=payload,
            trace=trace,
            warnings=warnings,
            profiles=profiles,
            yaml=yaml,
            document=document,
            baseline_yaml_string=baseline_yaml_string,
            response=build_error_response(
                status="INVALID_MANIFEST",
                yaml_string=payload.yaml_string,
                trace=["[Manifest] No services found."],
                warnings=warnings,
                free_ram_mb=payload.host_hardware.free_ram_mb,
            ),
        )

    try:
        check_service_cap(services)
        check_circular_dependencies(services)
    except ManifestValidationError as exc:
        return ParsedManifest(
            payload=payload,
            trace=trace,
            warnings=warnings,
            profiles=profiles,
            yaml=yaml,
            document=document,
            baseline_yaml_string=baseline_yaml_string,
            services=services,
            response=build_error_response(
                status="INVALID_MANIFEST",
                yaml_string=payload.yaml_string,
                trace=[f"[Validate] {exc}"],
                warnings=warnings,
                free_ram_mb=payload.host_hardware.free_ram_mb,
            ),
        )

    return ParsedManifest(
        payload=payload,
        trace=trace,
        warnings=warnings,
        profiles=profiles,
        yaml=yaml,
        document=document,
        baseline_yaml_string=baseline_yaml_string,
        services=services,
    )


def parse_hardcoded_memory_mb(flag: str) -> float | None:
    if flag.startswith("--max-old-space-size="):
        try:
            return float(flag.split("=")[1])
        except ValueError:
            return None
    if flag.startswith("-Xmx"):
        val_str = flag[4:]
        if not val_str:
            return None
        unit = val_str[-1].lower()
        try:
            val = float(val_str[:-1])
            if unit == "g":
                return val * 1024.0
            if unit == "m":
                return val
        except ValueError:
            pass
    return None


def check_service_cap(services: dict[str, Any]) -> None:
    count = len(services)
    if count > MAX_SERVICES:
        raise ManifestValidationError(
            f"Manifest defines {count} services, which exceeds the "
            f"maximum allowed limit of {MAX_SERVICES}. "
            "Split large stacks into smaller Compose files."
        )


def check_circular_dependencies(services: dict[str, Any]) -> None:
    adjacency: dict[str, list[str]] = {name: [] for name in services}
    in_degree: dict[str, int] = {name: 0 for name in services}

    for name, config in services.items():
        if not isinstance(config, dict):
            continue
        depends_on = config.get("depends_on", {})

        if isinstance(depends_on, dict):
            dependencies = list(depends_on.keys())
        elif isinstance(depends_on, list):
            dependencies = [d for d in depends_on if isinstance(d, str)]
        else:
            continue

        for dep in dependencies:
            if dep not in adjacency:
                adjacency[dep] = []
                in_degree[dep] = 0
            adjacency[dep].append(name)
            in_degree[name] += 1

    queue: deque[str] = deque(
        node for node, degree in in_degree.items() if degree == 0
    )
    processed = 0

    while queue:
        node = queue.popleft()
        processed += 1
        for dependent in adjacency[node]:
            in_degree[dependent] -= 1
            if in_degree[dependent] == 0:
                queue.append(dependent)

    total = len(in_degree)
    if processed < total:
        cycle_members = sorted(
            node for node, degree in in_degree.items() if degree > 0
        )
        raise CircularDependencyError(
            f"Circular dependency detected among services: "
            f"{', '.join(cycle_members)}. "
            "Resolve the dependency loop before re-submitting the manifest."
        )


def safe_image_lookup_table(profiles: ProfilesConfig) -> dict[str, str]:
    return profiles.image_lookup_table


def resolve_host_profile(
    selected_profile: str,
    profiles: ProfilesConfig,
    trace: list[str],
    custom_config: Any | None = None,
):
    if custom_config is not None:
        trace.append(
            f"[Profiles] Custom profile: "
            f"ram_safety_buffer={custom_config.ram_safety_buffer}, "
            f"cpu_threshold_multiplier={custom_config.cpu_threshold_multiplier}."
        )
        return custom_config
    return profiles.host_profiles.get(selected_profile, profiles.host_profiles["background_dev"])


def safe_tier(
    tier: Any,
    profiles: ProfilesConfig,
    service_name: str | None = None,
    trace: list[str] | None = None,
) -> str:
    normalized = tier.strip().lower() if isinstance(tier, str) else ""
    if not normalized:
        _record_tier_fallback(service_name, f"invalid tier token {tier!r}", trace)
        return BACKEND_TIER_NAME
    if normalized in profiles.tiers and normalized in profiles.floors:
        return normalized
    _record_tier_fallback(
        service_name,
        f"tier '{normalized}' not found in tiers/floors config",
        trace,
    )
    return BACKEND_TIER_NAME


def _record_tier_fallback(
    service_name: str | None, reason: str, trace: list[str] | None
) -> None:
    name = service_name or "<unknown>"
    msg = (
        f"[Profiles] Service '{name}' fell back to '{BACKEND_TIER_NAME}' tier: {reason}."
    )
    logger.warning(msg)
    if trace is not None:
        trace.append(msg)


def make_yaml() -> YAML:
    yaml = YAML(typ="rt")
    yaml.preserve_quotes = True
    return yaml


def dump_yaml(yaml: YAML, document: Any) -> str:
    buf = StringIO()
    yaml.dump(document, buf)
    return buf.getvalue()


def detect_orchestrator(document: Any) -> tuple[str, str] | None:
    if not isinstance(document, dict):
        return None

    top_keys = set(document.keys())

    if "apiVersion" in top_keys or "kind" in top_keys:
        return (
            "Kubernetes",
            "Kubernetes manifests are designed for distributed clusters, not local PC hosting.",
        )
    if "job" in top_keys and "services" not in top_keys:
        return (
            "HashiCorp Nomad",
            "Nomad job files target distributed infrastructure, not local Docker Compose stacks.",
        )
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
    if "description" in top_keys and "appVersion" in top_keys and "services" not in top_keys:
        return (
            "Helm Chart (Chart.yaml)",
            "Helm chart definitions describe Kubernetes packaging, not local Docker Compose stacks.",
        )
    if "secrets" in top_keys and "services" in top_keys:
        secrets_block = document.get("secrets")
        if isinstance(secrets_block, dict):
            for secret_cfg in secrets_block.values():
                if isinstance(secret_cfg, dict) and "driver" in secret_cfg:
                    return (
                        "Docker Swarm stack",
                        "Docker Swarm stack files require a multi-node Swarm cluster, not a single local host.",
                    )
    return None


def extract_services(document: Any) -> dict[str, Any]:
    if isinstance(document, dict) and isinstance(document.get("services"), dict):
        return document["services"]
    return {}


def extract_replicas(service: Any) -> int:
    try:
        return max(1, int(service.get("deploy", {}).get("replicas", 1)))
    except Exception:
        return 1


def extract_xtuning(
    service: Any,
    service_name: str,
    trace: list[str],
) -> dict[str, Any]:
    result: dict[str, Any] = {}
    if not isinstance(service, dict):
        return result
    xtuning = service.get("x-tuning")
    if not isinstance(xtuning, dict):
        return result

    raw_floor = xtuning.get("ram_floor_mb")
    if isinstance(raw_floor, (int, float)) and not isinstance(raw_floor, bool) and raw_floor > 0:
        result["xtuning_ram_floor_mb"] = float(raw_floor)
        trace.append(
            f"[x-tuning] '{service_name}' RAM floor overridden to {raw_floor} MB."
        )
    elif raw_floor is not None:
        trace.append(
            f"[x-tuning] '{service_name}' ram_floor_mb={raw_floor!r} is invalid; ignoring."
        )

    if xtuning.get("never_cgroup") is True:
        result["xtuning_never_cgroup"] = True
        trace.append(f"[x-tuning] '{service_name}' excluded from memory cgroup limits.")

    raw_tv = xtuning.get("target_variable")
    if isinstance(raw_tv, str) and raw_tv.strip():
        result["xtuning_target_variable"] = raw_tv.strip()
        trace.append(
            f"[x-tuning] '{service_name}' tuning target overridden to '{raw_tv.strip()}'."
        )
    elif raw_tv is not None:
        trace.append(
            f"[x-tuning] '{service_name}' target_variable={raw_tv!r} is invalid; ignoring."
        )

    command_str = str(service.get("command", ""))
    entrypoint_str = str(service.get("entrypoint", ""))
    match = _HARDCODED_MEMORY_REGEX.search(command_str) or _HARDCODED_MEMORY_REGEX.search(entrypoint_str)
    if match:
        extracted_mb = parse_hardcoded_memory_mb(match.group(1))
        if extracted_mb:
            result["xtuning_hardcoded_ram_mb"] = extracted_mb

    raw_opt = xtuning.get("optimizable")
    if isinstance(raw_opt, bool):
        result["xtuning_optimizable"] = raw_opt
        trace.append(f"[x-tuning] '{service_name}' optimizable={raw_opt}.")
    elif match:
        result["xtuning_optimizable"] = False
        trace.append(
            f"[x-tuning] '{service_name}' has hardcoded heap flags; marked unoptimizable."
        )

    return result


def classify_service(
    service: Any,
    profiles: ProfilesConfig,
    service_name: str | None = None,
    trace: list[str] | None = None,
) -> str:
    if isinstance(service, dict):
        labels = service.get("labels", {})
        if isinstance(labels, dict):
            for key, val in labels.items():
                if str(key).lower() == "compiler.tier":
                    candidate = str(val).strip().lower()
                    if candidate in profiles.tiers:
                        return candidate
        elif isinstance(labels, list):
            for item in labels:
                if isinstance(item, str) and item.lower().startswith("compiler.tier="):
                    candidate = item.split("=", 1)[1].strip().lower()
                    if candidate in profiles.tiers:
                        return candidate

    image = str(service.get("image", "") if isinstance(service, dict) else "").lower()
    for fragment, tier in safe_image_lookup_table(profiles).items():
        if fragment in image:
            return tier

    if isinstance(service, dict) and service.get("ports"):
        return "backend_hybrid"

    name_part = service_name or ""
    body_parts = " ".join(str(v) for v in service.values()) if isinstance(service, dict) else str(service)
    tokens = set(re.findall(r"[A-Za-z]+", f"{name_part} {body_parts}".lower()))
    if any(k in t for t in tokens for k in {"worker", "celery", "beat", "queue"}):
        return "backend_low_priority"

    _record_tier_fallback(service_name, "no classifier matched", trace)
    return BACKEND_TIER_NAME


def check_port_conflicts(document: Any, warnings: list[str]) -> None:
    if not isinstance(document, dict):
        return
    raw_services: Any = document.get("services", document)
    if not isinstance(raw_services, dict):
        return

    seen: dict[tuple[str, str], str] = {}

    for service_name, service_node in raw_services.items():
        if not isinstance(service_node, dict):
            continue
        ports_block = service_node.get("ports")
        if not ports_block or not isinstance(ports_block, list):
            continue
        for entry in ports_block:
            for iface, host_port in _normalise_port_entry(entry):
                key = (iface, host_port)
                if key in seen:
                    if seen[key] != service_name:
                        warnings.append(
                            f"[Ports] Host port conflict on {iface}:{host_port} "
                            f"between '{seen[key]}' and '{service_name}'."
                        )
                    continue
                if iface == "0.0.0.0":
                    for (ex_iface, ex_port), owner in seen.items():
                        if ex_port == host_port and owner != service_name:
                            warnings.append(
                                f"[Ports] Port {host_port}: wildcard binding by "
                                f"'{service_name}' conflicts with {ex_iface}:{host_port} "
                                f"by '{owner}'."
                            )
                else:
                    wildcard = ("0.0.0.0", host_port)
                    if wildcard in seen and seen[wildcard] != service_name:
                        warnings.append(
                            f"[Ports] Port {host_port}: specific binding by "
                            f"'{service_name}' conflicts with wildcard by '{seen[wildcard]}'."
                        )
                seen[key] = service_name


def _normalise_port_entry(entry: Any) -> list[tuple[str, str]]:
    default_iface = "0.0.0.0"
    if isinstance(entry, dict):
        published = entry.get("published")
        return [(default_iface, str(published))] if published is not None else []
    if not isinstance(entry, (str, int)):
        return []
    raw = str(entry).strip()
    if not raw:
        return []
    raw = re.sub(r"\$\{[^}]+\}", "ENV_PORT_VAR", raw)
    raw = raw.split("/")[0]
    parts = raw.split(":")
    if len(parts) == 1:
        return []
    if len(parts) == 2:
        return [(default_iface, parts[0])]
    iface = parts[0] if parts[0] else default_iface
    return [(iface, parts[1])]


def ensure_environment(service: Any) -> Any:
    if not isinstance(service, dict):
        return CommentedMap()
    env = service.get("environment")
    if isinstance(env, (dict, list)):
        return env
    env = CommentedMap()
    service["environment"] = env
    return env


def read_env_number(service: Any, key: str) -> float | None:
    environment = ensure_environment(service)
    if isinstance(environment, dict) and key in environment:
        return _to_float(environment[key])
    if isinstance(environment, list):
        prefix = f"{key}="
        for item in environment:
            if isinstance(item, str) and item.startswith(prefix):
                return _to_float(item[len(prefix):])
    return None


def write_env_value(service: Any, key: str, value: float) -> None:
    environment = ensure_environment(service)
    rendered: int | float = int(value) if float(value).is_integer() else value
    if isinstance(environment, dict):
        environment[key] = rendered
        return
    if isinstance(environment, list):
        prefix = f"{key}="
        for i, item in enumerate(environment):
            if isinstance(item, str) and item.startswith(prefix):
                environment[i] = f"{key}={rendered}"
                return
        environment.append(f"{key}={rendered}")


def _to_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
