import json
import re
from dataclasses import dataclass, field
from io import StringIO
from pathlib import Path
from typing import Any

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap

from .schemas import (
    AnalyzeRequest,
    AnalyzeResponse,
    MutatedVariableDetail,
    OptimizationMetrics,
    ServiceAnalysisResult,
)


MAX_ITERATIONS = 50


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
        )

    profiles = _load_profiles()
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
        )

    services = _extract_services(document)
    if not services:
        return _response(
            status="INVALID_MANIFEST",
            yaml_string=payload.yaml_string,
            trace=["[Manifest] No services found in manifest."],
            warnings=warnings,
        )

    service_order = sorted(services)

    contexts = [
        ServiceContext(
            name=name,
            node=services[name],
            tier=_classify_service(services[name], profiles),
            replicas=_extract_replicas(services[name]),
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
            trace=trace
            + [
                "[Capacity] Minimum service memory floors exceed host RAM: "
                f"{round(floor_total, 1)}MB > {round(payload.host_hardware.free_ram_mb, 1)}MB."
            ],
            warnings=warnings,
            services=contexts,
        )

    profile = profiles["host_profiles"][payload.selected_profile]
    effective_free_ram = payload.host_hardware.free_ram_mb * profile["ram_safety_buffer"]
    cpu_budget = payload.host_hardware.cpu_cores * profile["cpu_threshold_multiplier"]

    # Calculate initial baseline footprints based on service tiers
    _inject_missing_defaults(contexts, profiles)
    _recalculate(contexts, profiles)
    initial_predicted_ram = sum(service.current_ram_mb for service in contexts)

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

    # Check host limits and scale down services if memory is tight
    cgroups_used = False
    current_iteration = 0
    while (m_gap > 0 or c_gap > 0) and current_iteration < MAX_ITERATIONS:
        current_iteration += 1
        changes = 0

        for service in contexts:
            if _at_floor(service, profiles) or service.tier == "backend_low_priority":
                continue

            variable_name = _primary_variable_name(service.tier)
            if not variable_name:
                continue

            if c_gap > 0:
                variable_name = _primary_variable_name(service.tier)
                if not variable_name:
                    continue

                current_value = _read_env_number(service.node, variable_name)
                floor_value = profiles["floors"][service.tier]["variables"].get(variable_name)
                if current_value is None or floor_value is None or current_value <= floor_value:
                    continue

                next_value = max(floor_value, int(current_value) - 1)
                if next_value == current_value:
                    continue

                _write_env_value(service.node, variable_name, next_value)
                _record_mutation(service, variable_name, current_value, next_value)
                service.current_ram_mb = _service_ram(service, profiles)
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
            floor_value = profiles["floors"][service.tier]["variables"].get(variable_name)
            if current_value is None or floor_value is None or current_value <= floor_value:
                if service.tier != "backend_hybrid" or variable_name != "WORKERS":
                    continue

                variable_name = "WEB_CONCURRENCY"
                current_value = _read_env_number(service.node, variable_name)
                floor_value = profiles["floors"][service.tier]["variables"].get(variable_name)
                if current_value is None or floor_value is None or current_value <= floor_value:
                    continue

            next_value = max(floor_value, int(current_value * 0.5))
            if next_value == current_value:
                next_value = floor_value

            _write_env_value(service.node, variable_name, next_value)
            _record_mutation(service, variable_name, current_value, next_value)
            old_ram = service.current_ram_mb
            service.current_ram_mb = _service_ram(service, profiles)
            service.final_ram_mb = service.current_ram_mb
            service.cpu = _service_cpu(service, profiles)
            m_predicted = sum(item.current_ram_mb for item in contexts)
            c_predicted = sum(item.cpu for item in contexts)
            m_gap = m_predicted - effective_free_ram
            c_gap = c_predicted - cpu_budget
            changes += 1
            saved_ram = max(0.0, old_ram - service.current_ram_mb)
            if variable_name == "WEB_CONCURRENCY":
                trace.append(
                    "[Optimize] Reduced WEB_CONCURRENCY for "
                    f"service:{service.name} to save memory as workers hit their minimum floor."
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

    optimized_yaml = _dump_yaml(yaml, document)

    return AnalyzeResponse(
        status=status,
        optimized_yaml_string=optimized_yaml,
        optimized_yaml=optimized_yaml,
        metrics=OptimizationMetrics(
            initial_predicted_ram_mb=initial_predicted_ram,
            final_predicted_ram_mb=final_predicted_ram,
            ram_margin_mb=effective_free_ram - final_predicted_ram,
            cpu_saturation_pct=(final_cpu / cpu_budget * 100) if cpu_budget else 0.0,
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


def _extract_services(document: Any) -> dict[str, Any]:
    if isinstance(document, dict) and isinstance(document.get("services"), dict):
        return document["services"]
    if isinstance(document, dict):
        return document
    return {}


def _extract_replicas(service: Any) -> int:
    try:
        replicas = service.get("deploy", {}).get("replicas", 1)
        return max(1, int(replicas))
    except Exception:
        return 1


def _classify_service(service: Any, profiles: dict[str, Any]) -> str:
    strings = [item.lower() for item in _walk_strings(service)]
    for value in strings:
        if "compiler.tier" in value:
            for tier_name in profiles["tiers"].keys():
                if tier_name in value:
                    return tier_name

    image = str(service.get("image", "") if isinstance(service, dict) else "").lower()
    for image_fragment, tier in profiles["image_lookup_table"].items():
        if image_fragment in image:
            return tier

    # Ports = highest priority (after explicit tier / image match)
    if isinstance(service, dict) and service.get("ports"):
        return "backend_hybrid"

    # Keyword detection = lowest priority
    # Use regex tokenization so compound names like "celery-worker", "workerProcess",
    # "WORKERS", and "queue_handler" are correctly decomposed into atomic words.
    service_text = " ".join(
        str(v) for v in service.values()
    ) if isinstance(service, dict) else str(service)

    tokens = set(re.findall(r"[A-Za-z]+", service_text.lower()))

    if any(k in t for t in tokens for k in {"worker", "celery", "beat", "queue"}):
        return "backend_low_priority"

    return "backend"


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
        defaults = profiles["tiers"][service.tier]["default_max_variables"]
        for key, value in defaults.items():
            if _read_env_number(service.node, key) is None:
                _write_env_value(service.node, key, value)


def _primary_variable_name(tier: str) -> str | None:
    return {
        "database": "max_connections",
        "backend_hybrid": "WORKERS",
        "cache": "maxmemory",
    }.get(tier)


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


def _recalculate(contexts: list[ServiceContext], profiles: dict[str, Any]) -> None:
    for service in contexts:
        service.current_ram_mb = _service_ram(service, profiles)
        service.final_ram_mb = service.current_ram_mb
        service.cpu = _service_cpu(service, profiles)


def _service_ram(service: ServiceContext, profiles: dict[str, Any]) -> float:
    tier_config = profiles["tiers"][service.tier]
    replicas = service.replicas
    if service.tier == "database":
        max_connections = _read_env_number(service.node, "max_connections")
        max_connections = max_connections if max_connections is not None else 100
        return (128.0 + (max_connections * 15.0)) * replicas
    if service.tier == "backend_hybrid":
        workers = _read_env_number(service.node, "WORKERS")
        workers = workers if workers is not None else 4
        web_concurrency = _read_env_number(service.node, "WEB_CONCURRENCY")
        web_concurrency = web_concurrency if web_concurrency is not None else 4
        return (64.0 + (workers * 32.0) + (web_concurrency * 48.0)) * replicas
    if service.tier == "cache":
        maxmemory = _read_env_number(service.node, "maxmemory")
        maxmemory = maxmemory if maxmemory is not None else 256
        return (16.0 + maxmemory) * replicas
    return tier_config["base_ram_mb"] * replicas


def _service_cpu(service: ServiceContext, profiles: dict[str, Any]) -> float:
    tier_config = profiles["tiers"][service.tier]
    base_cpu = tier_config["base_cpu"] * service.replicas
    variable_name = _primary_variable_name(service.tier)
    if not variable_name:
        return base_cpu

    default_value = tier_config["default_max_variables"].get(variable_name)
    current_value = _read_env_number(service.node, variable_name)
    if not default_value or current_value is None:
        return base_cpu

    cpu_scale = current_value / default_value
    if service.tier == "backend_hybrid":
        web_default = tier_config["default_max_variables"].get("WEB_CONCURRENCY")
        web_value = _read_env_number(service.node, "WEB_CONCURRENCY")
        if web_default and web_value is not None:
            cpu_scale = (cpu_scale + (web_value / web_default)) / 2

    return base_cpu * cpu_scale


def _at_floor(service: ServiceContext, profiles: dict[str, Any]) -> bool:
    floor = profiles["floors"][service.tier]
    if service.current_ram_mb <= floor["ram_mb"] * service.replicas:
        return True
    for variable_name, floor_value in floor["variables"].items():
        current_value = _read_env_number(service.node, variable_name)
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
    injected = False
    active_footprint = sum(service.current_ram_mb for service in contexts)
    overflow = max(0.0, active_footprint - effective_free_ram)

    for service in contexts:
        floor_ram = profiles["floors"][service.tier]["ram_mb"]
        reduction_share = (
            overflow * (service.current_ram_mb / active_footprint) if active_footprint else 0.0
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
    return injected


def _write_resource_limit(service: Any, key: str, value: Any) -> None:
    deploy = service.setdefault("deploy", CommentedMap())
    resources = deploy.setdefault("resources", CommentedMap())
    limits = resources.setdefault("limits", CommentedMap())
    limits[key] = value


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
) -> AnalyzeResponse:
    service_contexts = services or []
    return AnalyzeResponse(
        status=status,
        optimized_yaml_string=yaml_string,
        optimized_yaml=yaml_string,
        metrics=OptimizationMetrics(
            initial_predicted_ram_mb=sum(service.initial_ram_mb for service in service_contexts),
            final_predicted_ram_mb=sum(service.final_ram_mb for service in service_contexts),
            ram_margin_mb=0.0,
            cpu_saturation_pct=0.0,
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
            )
            for service in service_contexts
        ],
        warnings=warnings,
        execution_trace=trace,
        trace_log=trace,
    )
