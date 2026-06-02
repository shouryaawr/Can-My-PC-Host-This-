import graphlib
import json
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
            trace=["[STAGE 0] Invalid host hardware payload."],
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
            trace=[f"[STAGE 1] YAML parse error: {exc}"],
            warnings=warnings,
        )

    services = _extract_services(document)
    if not services:
        return _response(
            status="INVALID_MANIFEST",
            yaml_string=payload.yaml_string,
            trace=["[STAGE 1] No services found in manifest."],
            warnings=warnings,
        )

    dependencies = {name: _extract_depends_on(service) for name, service in services.items()}
    service_order = list(services.keys())
    if len(services) > 1:
        sorter = graphlib.TopologicalSorter()
        for name, deps in dependencies.items():
            sorter.add(name, *(dep for dep in deps if dep in services))
        try:
            service_order = list(reversed(tuple(sorter.static_order())))
        except graphlib.CycleError as exc:
            return _response(
                status="INVALID_MANIFEST",
                yaml_string=payload.yaml_string,
                trace=[f"[STAGE 1] Dependency cycle detected: {exc}"],
                warnings=warnings,
            )

    contexts = [
        ServiceContext(
            name=name,
            node=services[name],
            tier=_classify_service(services[name], profiles),
            replicas=_extract_replicas(services[name]),
        )
        for name in service_order
    ]
    trace.append(f"[STAGE 1] Evaluation order: {', '.join(service.name for service in contexts)}")

    floor_total = sum(
        profiles["floors"][service.tier]["ram_mb"] * service.replicas for service in contexts
    )
    if floor_total > payload.host_hardware.free_ram_mb:
        return _response(
            status="UNSOLVABLE",
            yaml_string=_dump_yaml(yaml, document),
            trace=trace
            + [
                "[STAGE 1] Rock-bottom memory floors exceed available host RAM: "
                f"{round(floor_total, 1)}MB > {round(payload.host_hardware.free_ram_mb, 1)}MB."
            ],
            warnings=warnings,
            services=contexts,
        )

    profile = profiles["host_profiles"][payload.selected_profile]
    effective_free_ram = payload.host_hardware.free_ram_mb * profile["ram_safety_buffer"]
    cpu_budget = payload.host_hardware.cpu_cores * profile["cpu_threshold_multiplier"]

    _inject_missing_defaults(contexts, profiles)
    _recalculate(contexts, profiles, apply_hdd_penalty=False)
    initial_predicted_ram = sum(service.current_ram_mb for service in contexts)

    if initial_predicted_ram > 0.80 * effective_free_ram:
        for service in contexts:
            service.current_ram_mb *= 0.90
        trace.append("[STAGE 2] RAM pressure safeguard applied: flat 10% footprint deduction.")

    hdd_database_penalty = False
    if payload.host_hardware.storage_type == "HDD":
        for service in contexts:
            if service.tier == "database" and service.current_ram_mb > 256:
                service.current_ram_mb *= 1.25
                hdd_database_penalty = True
        if hdd_database_penalty:
            trace.append("[STAGE 2] HDD database penalty applied: +25% database footprint.")
        else:
            warnings.append("HDD storage detected, but no database layer is running.")

    for service in contexts:
        service.initial_ram_mb = service.current_ram_mb
        service.final_ram_mb = service.current_ram_mb
        service.cpu = _service_cpu(service, profiles)

    m_predicted = sum(service.current_ram_mb for service in contexts)
    c_predicted = sum(service.cpu for service in contexts)
    m_gap = m_predicted - effective_free_ram
    c_gap = c_predicted - cpu_budget
    trace.append(
        "[STAGE 2] Initial footprint: "
        f"M_predicted={round(m_predicted, 1)}MB, C_predicted={round(c_predicted, 2)}, "
        f"M_gap={round(m_gap, 1)}MB, C_gap={round(c_gap, 2)}."
    )

    cgroups_used = False
    current_iteration = 0
    while m_gap > 0 and current_iteration < MAX_ITERATIONS:
        current_iteration += 1
        changes = 0

        for service in _optimization_queue(contexts):
            if _at_floor(service, profiles) or service.tier == "backend_low_priority":
                continue

            variable_name = _primary_variable_name(service.tier)
            if not variable_name:
                continue

            current_value = _read_env_number(service.node, variable_name)
            floor_value = profiles["floors"][service.tier]["variables"].get(variable_name)
            if current_value is None or floor_value is None or current_value <= floor_value:
                continue

            previous_gap = m_gap
            next_value = max(floor_value, int(current_value * 0.5))
            if next_value == current_value:
                next_value = floor_value

            _write_env_value(service.node, variable_name, next_value)
            _record_mutation(service, variable_name, current_value, next_value)
            old_ram = service.current_ram_mb
            service.current_ram_mb = _service_ram(service, profiles)
            service.final_ram_mb = service.current_ram_mb
            m_predicted = sum(item.current_ram_mb for item in contexts)
            m_gap = m_predicted - effective_free_ram
            changes += 1
            trace.append(
                f"[STAGE 3][iter={current_iteration}] {service.name}: "
                f"{variable_name} {round(current_value, 1)} -> {round(next_value, 1)} | "
                f"M_gap: {round(previous_gap, 1)}MB -> {round(m_gap, 1)}MB"
            )

            if old_ram == service.current_ram_mb:
                continue
            if m_gap <= 0:
                break

        if changes == 0:
            trace.append(f"[STAGE 3][iter={current_iteration}] No variable alterations available.")
            break

    if m_gap > 0:
        cgroups_used = _inject_cgroups(contexts, profiles, c_gap, effective_free_ram)
        if cgroups_used:
            m_predicted = sum(service.final_ram_mb for service in contexts)
            m_gap = m_predicted - effective_free_ram
            trace.append(
                "[CGROUPS] Hard resource fences injected; "
                f"final M_gap={round(m_gap, 1)}MB."
            )

    final_predicted_ram = sum(service.final_ram_mb for service in contexts)
    final_cpu = sum(service.cpu for service in contexts)
    final_m_gap = final_predicted_ram - effective_free_ram
    status = "FULLY_SOLVED"
    if cgroups_used and final_m_gap <= 0:
        status = "DEGRADED_SAFE"
    elif final_m_gap > 0:
        status = "UNSOLVABLE"

    return AnalyzeResponse(
        status=status,
        optimized_yaml_string=_dump_yaml(yaml, document),
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
        warnings=warnings,
        execution_trace=trace,
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


def _extract_depends_on(service: Any) -> list[str]:
    depends_on = service.get("depends_on", []) if isinstance(service, dict) else []
    if isinstance(depends_on, list):
        return [str(item) for item in depends_on]
    if isinstance(depends_on, dict):
        return [str(item) for item in depends_on.keys()]
    return []


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

    service_text = " ".join(strings)
    if any(token in service_text for token in ("worker", "celery", "beat", "queue")):
        return "backend_low_priority"
    if isinstance(service, dict) and service.get("ports"):
        return "backend_hybrid"
    return "backend_low_priority"


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


def _recalculate(
    contexts: list[ServiceContext], profiles: dict[str, Any], apply_hdd_penalty: bool
) -> None:
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
        return (64.0 + (workers * 32.0)) * replicas
    if service.tier == "cache":
        maxmemory = _read_env_number(service.node, "maxmemory")
        maxmemory = maxmemory if maxmemory is not None else 256
        return (16.0 + maxmemory) * replicas
    return tier_config["base_ram_mb"] * replicas


def _service_cpu(service: ServiceContext, profiles: dict[str, Any]) -> float:
    return profiles["tiers"][service.tier]["base_cpu"] * service.replicas


def _optimization_queue(contexts: list[ServiceContext]) -> list[ServiceContext]:
    total = sum(service.current_ram_mb for service in contexts)
    dominant_databases = {
        service.name
        for service in contexts
        if service.tier == "database" and total > 0 and service.current_ram_mb > total * 0.50
    }
    order_index = {service.name: index for index, service in enumerate(contexts)}
    return sorted(
        contexts,
        key=lambda service: (
            service.name not in dominant_databases,
            -service.initial_ram_mb,
            service.name,
            order_index[service.name],
        ),
    )


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
        warnings=warnings,
        execution_trace=trace,
    )
