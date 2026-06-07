from __future__ import annotations

import logging
from typing import Any

from ruamel.yaml.comments import CommentedMap

from .parser import (
    BACKEND_TIER_NAME,
    classify_service,
    dump_yaml,
    extract_replicas,
    extract_xtuning,
    read_env_number,
    resolve_host_profile,
    safe_tier,
    write_env_value,
)
from .patcher import build_error_response
from .schemas import (
    MutatedVariableDetail,
    ParsedManifest,
    ProfilesConfig,
    ServiceContext,
    SolverResult,
    TierProfileConfig,
)

logger = logging.getLogger(__name__)

MAX_ITERATIONS = 50
_HDD_MAX_CONNECTIONS_CEIL = 50
_HDD_MAXMEMORY_CEIL = 50


def solve_analysis(parsed: ParsedManifest) -> SolverResult:
    payload = parsed.payload
    trace = parsed.trace
    warnings = parsed.warnings
    profiles = parsed.profiles
    contexts = _build_contexts(parsed)

    trace.append(
        "[Manifest] Services (alphabetical): "
        + ", ".join(s.name for s in contexts) + "."
    )

    profile = resolve_host_profile(
        payload.selected_profile, profiles, trace, payload.custom_profile_config
    )
    effective_free_ram = payload.host_hardware.free_ram_mb * profile.ram_safety_buffer
    cpu_budget = payload.host_hardware.cpu_cores * profile.cpu_threshold_multiplier
    storage_type = payload.host_hardware.storage_type

    floor_total = sum(
        profiles.floors[s.tier].ram_mb * s.replicas for s in contexts
    )
    if floor_total > effective_free_ram:
        return SolverResult(
            payload=payload,
            trace=trace,
            warnings=warnings,
            profiles=profiles,
            baseline_yaml_string=parsed.baseline_yaml_string,
            contexts=contexts,
            response=build_error_response(
                status="UNSOLVABLE",
                yaml_string=dump_yaml(parsed.yaml, parsed.document),
                trace=trace + [
                    "[Capacity] Minimum memory floors exceed available RAM: "
                    f"{round(floor_total, 1)} MB > {round(effective_free_ram, 1)} MB."
                ],
                warnings=warnings,
                services=contexts,
                baseline_yaml_string=parsed.baseline_yaml_string,
                free_ram_mb=payload.host_hardware.free_ram_mb,
            ),
        )

    inject_missing_defaults(contexts, profiles)
    recalculate(contexts, profiles, storage_type)
    initial_predicted_ram = sum(s.current_ram_mb * s.replicas for s in contexts)

    for service in contexts:
        if not service.xtuning_optimizable and (
            service.current_ram_mb * service.replicas
        ) > effective_free_ram:
            return SolverResult(
                payload=payload,
                trace=trace,
                warnings=warnings,
                profiles=profiles,
                baseline_yaml_string=parsed.baseline_yaml_string,
                contexts=contexts,
                response=build_error_response(
                    status="UNSOLVABLE",
                    yaml_string=dump_yaml(parsed.yaml, parsed.document),
                    trace=trace + [
                        f"[Capacity] '{service.name}' requires "
                        f"{round(service.current_ram_mb, 1)} MB but is unoptimizable "
                        f"(exceeds free RAM of {round(effective_free_ram, 1)} MB)."
                    ],
                    warnings=warnings,
                    services=contexts,
                    baseline_yaml_string=parsed.baseline_yaml_string,
                    free_ram_mb=payload.host_hardware.free_ram_mb,
                ),
            )

    _apply_presolve_adjustments(
        contexts,
        storage_type,
        initial_predicted_ram,
        effective_free_ram,
        warnings,
        trace,
    )

    for service in contexts:
        service.initial_ram_mb = service.current_ram_mb
        service.final_ram_mb = service.current_ram_mb
        service.cpu = service_cpu(service, profiles)

    cfg = payload.custom_profile_config
    iteration_cap = cfg.max_iterations if cfg is not None else MAX_ITERATIONS
    allow_cgroups = cfg.allow_cgroups if cfg is not None else True
    floor_strictness = (
        cfg.floor_strictness
        if (cfg is not None and cfg.floor_strictness is not None)
        else 1.0
    )

    _, c_gap, cgroups_used = run_solver(
        contexts=contexts,
        profiles=profiles,
        storage_type=storage_type,
        effective_free_ram=effective_free_ram,
        cpu_budget=cpu_budget,
        iteration_cap=iteration_cap,
        allow_cgroups=allow_cgroups,
        floor_strictness=floor_strictness,
        trace=trace,
    )

    final_predicted_ram = sum(s.final_ram_mb * s.replicas for s in contexts)
    final_cpu = sum(s.cpu * s.replicas for s in contexts)
    final_m_gap = final_predicted_ram - effective_free_ram
    final_c_gap = final_cpu - cpu_budget
    status = resolve_status(cgroups_used, final_m_gap, final_c_gap, effective_free_ram, final_predicted_ram)
    floor_flags = {
        service.name: at_floor(service, profiles, floor_strictness)
        for service in contexts
    }

    return SolverResult(
        payload=payload,
        trace=trace,
        warnings=warnings,
        profiles=profiles,
        baseline_yaml_string=parsed.baseline_yaml_string,
        contexts=contexts,
        effective_free_ram=effective_free_ram,
        cpu_budget=cpu_budget,
        initial_predicted_ram=initial_predicted_ram,
        final_predicted_ram=final_predicted_ram,
        final_cpu=final_cpu,
        c_gap=c_gap,
        floor_strictness=floor_strictness,
        status=status,
        floor_flags=floor_flags,
    )


def _build_contexts(parsed: ParsedManifest) -> list[ServiceContext]:
    service_order = sorted(parsed.services)
    return [
        ServiceContext(
            name=name,
            node=parsed.services[name],
            tier=safe_tier(
                classify_service(parsed.services[name], parsed.profiles, service_name=name, trace=parsed.trace),
                parsed.profiles,
                service_name=name,
                trace=parsed.trace,
            ),
            replicas=extract_replicas(parsed.services[name]),
            **extract_xtuning(parsed.services[name], name, parsed.trace),
        )
        for name in service_order
    ]


def _apply_presolve_adjustments(
    contexts: list[ServiceContext],
    storage_type: str,
    initial_predicted_ram: float,
    effective_free_ram: float,
    warnings: list[str],
    trace: list[str],
) -> None:
    if initial_predicted_ram > 0.80 * effective_free_ram:
        for service in contexts:
            service.current_ram_mb *= 0.90
        trace.append("[Optimize] Trimmed baseline footprints by 10% (RAM utilization > 80%).")

    if storage_type == "HDD":
        applied = False
        for service in contexts:
            if service.tier == "database" and service.current_ram_mb > 256:
                service.current_ram_mb *= 1.25
                applied = True
        if applied:
            trace.append("[Hardware] Applied HDD database buffer (rotational storage penalty).")
        else:
            warnings.append("HDD storage detected but no database service present.")
    else:
        trace.append("[Hardware] SSD storage profile applied.")


def resolve_status(
    cgroups_used: bool,
    final_m_gap: float,
    final_c_gap: float,
    effective_free_ram: float,
    final_predicted_ram: float,
) -> str:
    status = "FULLY_SOLVED"
    if cgroups_used and final_m_gap <= 0 and final_c_gap <= 0:
        status = "DEGRADED_SAFE"
    elif final_m_gap > 0 or final_c_gap > 0:
        status = "UNSOLVABLE"

    if status == "FULLY_SOLVED" and (effective_free_ram - final_predicted_ram) < 64:
        status = "DEGRADED_SAFE"

    return status


def _primary_variable_name(tier: str) -> str | None:
    return {
        "database": "max_connections",
        "backend_hybrid": "WORKERS",
        "cache": "maxmemory",
    }.get(tier)


def _resolve_variable(node: Any, canonical: str, tier_config: TierProfileConfig) -> str:
    aliases = tier_config.variable_aliases.get(canonical, [])
    for candidate in [canonical] + list(aliases):
        if read_env_number(node, candidate) is not None:
            return candidate
    return canonical


def resolve_primary_variable(service: ServiceContext, profiles: ProfilesConfig) -> str | None:
    if service.xtuning_target_variable:
        return service.xtuning_target_variable
    canonical = _primary_variable_name(service.tier)
    if canonical is None:
        return None
    tier_config = profiles.tiers[service.tier]
    return _resolve_variable(service.node, canonical, tier_config)


def resolve_secondary_variable(service: ServiceContext, profiles: ProfilesConfig) -> str | None:
    if service.tier != "backend_hybrid":
        return None
    tier_config = profiles.tiers[service.tier]
    return _resolve_variable(service.node, "WEB_CONCURRENCY", tier_config)


def resolve_floor_value(
    service: ServiceContext, resolved_var: str, profiles: ProfilesConfig
) -> float | None:
    tier = service.tier
    floor_vars = profiles.floors[tier].variables
    if resolved_var in floor_vars:
        return floor_vars[resolved_var]
    tier_config = profiles.tiers[tier]
    for canon, alias_list in tier_config.variable_aliases.items():
        if resolved_var in alias_list and canon in floor_vars:
            return floor_vars[canon]
    if resolved_var == service.xtuning_target_variable:
        canonical = _primary_variable_name(tier)
        if canonical in floor_vars:
            return floor_vars[canonical]
    return None


def service_ram(
    service: ServiceContext, profiles: ProfilesConfig, storage_type: str = ""
) -> float:
    if service.xtuning_hardcoded_ram_mb is not None:
        return service.xtuning_hardcoded_ram_mb

    tier_config = profiles.tiers[service.tier]
    is_hdd = storage_type == "HDD"

    if service.tier == "database":
        var = _resolve_variable(service.node, "max_connections", tier_config)
        connections = read_env_number(service.node, var) or 100
        if is_hdd:
            connections = min(connections, _HDD_MAX_CONNECTIONS_CEIL)
        return 128.0 + (connections * 15.0)

    if service.tier == "backend_hybrid":
        workers_var = _resolve_variable(service.node, "WORKERS", tier_config)
        workers = read_env_number(service.node, workers_var) or 4
        web_var = _resolve_variable(service.node, "WEB_CONCURRENCY", tier_config)
        web_concurrency = read_env_number(service.node, web_var) or 4
        return 64.0 + (workers * 32.0) + (web_concurrency * 48.0)

    if service.tier == "cache":
        var = _resolve_variable(service.node, "maxmemory", tier_config)
        maxmemory = read_env_number(service.node, var) or 256
        if is_hdd:
            maxmemory = min(maxmemory, _HDD_MAXMEMORY_CEIL)
        return 16.0 + maxmemory

    return tier_config.base_ram_mb


def service_cpu(service: ServiceContext, profiles: ProfilesConfig) -> float:
    tier_config = profiles.tiers[service.tier]
    base_cpu = tier_config.base_cpu
    canonical = _primary_variable_name(service.tier)
    if not canonical:
        return base_cpu

    var = _resolve_variable(service.node, canonical, tier_config)
    default = tier_config.default_max_variables.get(canonical)
    current = read_env_number(service.node, var)
    if not default or current is None:
        return base_cpu

    scale = current / default
    if service.tier == "backend_hybrid":
        web_var = _resolve_variable(service.node, "WEB_CONCURRENCY", tier_config)
        web_default = tier_config.default_max_variables.get("WEB_CONCURRENCY")
        web_value = read_env_number(service.node, web_var)
        if web_default and web_value is not None:
            scale = (scale + (web_value / web_default)) / 2

    return base_cpu * scale


def at_floor(
    service: ServiceContext, profiles: ProfilesConfig, floor_strictness: float = 1.0
) -> bool:
    floor = profiles.floors[service.tier]
    base_floor = (
        service.xtuning_ram_floor_mb
        if service.xtuning_ram_floor_mb is not None
        else floor.ram_mb
    )
    if service.current_ram_mb <= base_floor * floor_strictness:
        return True
    tier_config = profiles.tiers[service.tier]
    for canon_var, floor_value in floor.variables.items():
        resolved = _resolve_variable(service.node, canon_var, tier_config)
        current = read_env_number(service.node, resolved)
        if current is not None and current > floor_value:
            return False
    return bool(floor.variables)


def inject_missing_defaults(contexts: list[ServiceContext], profiles: ProfilesConfig) -> None:
    for service in contexts:
        tier_config = profiles.tiers[service.tier]
        defaults = tier_config.default_max_variables
        aliases_map = tier_config.variable_aliases
        for canonical_key, default_value in defaults.items():
            all_candidates = [canonical_key] + aliases_map.get(canonical_key, [])
            if all(read_env_number(service.node, c) is None for c in all_candidates):
                write_env_value(service.node, canonical_key, default_value)


def recalculate(
    contexts: list[ServiceContext], profiles: ProfilesConfig, storage_type: str = ""
) -> None:
    for service in contexts:
        service.current_ram_mb = service_ram(service, profiles, storage_type)
        service.final_ram_mb = service.current_ram_mb
        service.cpu = service_cpu(service, profiles)


def record_mutation(
    service: ServiceContext, variable_name: str, old_value: float, new_value: float
) -> None:
    existing = service.variables_mutated.get(variable_name)
    from_val = existing.from_val if existing else old_value
    service.variables_mutated[variable_name] = MutatedVariableDetail(
        **{"from": from_val, "to": new_value}
    )


def _priority_key(service: ServiceContext, profiles: ProfilesConfig) -> float:
    tier_config = profiles.tiers[service.tier]
    return tier_config.ram_scaling_factor * service.replicas


def _project_variable(
    service: ServiceContext,
    variable_name: str,
    headroom_mb: float,
    profiles: ProfilesConfig,
    storage_type: str,
    trace: list[str],
) -> float:
    current = read_env_number(service.node, variable_name)
    floor_val = resolve_floor_value(service, variable_name, profiles)
    if current is None or floor_val is None:
        return service.current_ram_mb * service.replicas

    tier_config = profiles.tiers[service.tier]
    scaling = tier_config.ram_scaling_factor

    base_cost = service_ram(
        ServiceContext(
            name=service.name,
            node={},
            tier=service.tier,
            replicas=service.replicas,
        ),
        profiles,
        storage_type,
    ) * service.replicas

    if scaling > 0:
        cost_per_unit = scaling * service.replicas
        max_var = int((headroom_mb - base_cost) / cost_per_unit)
    else:
        return service.current_ram_mb * service.replicas

    projected = max(int(floor_val), max_var)
    projected = max(1, projected)

    if projected < int(current):
        write_env_value(service.node, variable_name, projected)
        record_mutation(service, variable_name, current, projected)
        old_ram = service.current_ram_mb
        service.current_ram_mb = service_ram(service, profiles, storage_type)
        service.final_ram_mb = service.current_ram_mb
        service.cpu = service_cpu(service, profiles)
        saved_mb = max(0.0, old_ram - service.current_ram_mb)
        trace.append(
            f"[Solver] Projected '{variable_name}' for '{service.name}': "
            f"{int(current)} -> {projected} "
            f"(saved {round(saved_mb * service.replicas, 1)} MB)."
        )

    return service.current_ram_mb * service.replicas


def run_solver(
    contexts: list[ServiceContext],
    profiles: ProfilesConfig,
    storage_type: str,
    effective_free_ram: float,
    cpu_budget: float,
    iteration_cap: int,
    allow_cgroups: bool,
    floor_strictness: float,
    trace: list[str],
) -> tuple[float, float, bool]:
    m_predicted = sum(s.current_ram_mb * s.replicas for s in contexts)
    c_predicted = sum(s.cpu * s.replicas for s in contexts)
    m_gap = m_predicted - effective_free_ram
    c_gap = c_predicted - cpu_budget

    if m_gap <= 0 and c_gap <= 0:
        margin_mb = effective_free_ram - m_predicted
        margin_cpu = cpu_budget - c_predicted
        trace.append(
            f"[Baseline] Services fit within budget. "
            f"Margin: {round(margin_mb, 1)} MB RAM, {round(margin_cpu, 2)} vCPU."
        )
        return _finalise(contexts, profiles, cpu_budget, effective_free_ram, allow_cgroups, trace)

    trace.append(
        f"[Baseline] Resource deficit: "
        f"{round(abs(m_gap), 1)} MB RAM, {round(abs(c_gap), 2)} vCPU. "
        "Starting algebraic projection."
    )

    tunable = sorted(
        [s for s in contexts if s.xtuning_optimizable and s.tier != "backend_low_priority"],
        key=lambda s: _priority_key(s, profiles),
        reverse=True,
    )

    headroom = effective_free_ram

    for service in tunable:
        others_ram = sum(
            s.current_ram_mb * s.replicas for s in contexts if s is not service
        )
        available = headroom - others_ram

        variable_name = resolve_primary_variable(service, profiles)
        if not variable_name:
            continue

        service_committed = _project_variable(
            service, variable_name, available, profiles, storage_type, trace
        )

        secondary = resolve_secondary_variable(service, profiles)
        if secondary and secondary != variable_name:
            residual = available - service_committed
            if residual > 0:
                _project_variable(
                    service, secondary, residual, profiles, storage_type, trace
                )

    m_predicted = sum(s.current_ram_mb * s.replicas for s in contexts)
    c_predicted = sum(s.cpu * s.replicas for s in contexts)
    m_gap = m_predicted - effective_free_ram
    c_gap = c_predicted - cpu_budget

    if m_gap <= 0 and c_gap <= 0:
        trace.append(
            f"[Solver] Algebraic projection resolved all deficits. "
            f"Final RAM: {round(m_predicted, 1)} MB / {round(effective_free_ram, 1)} MB budget."
        )
    else:
        trace.append(
            f"[Solver] Projection complete. Residual deficit: "
            f"{round(max(0.0, m_gap), 1)} MB RAM, {round(max(0.0, c_gap), 2)} vCPU."
        )

    return _finalise(contexts, profiles, cpu_budget, effective_free_ram, allow_cgroups, trace)


def _finalise(
    contexts: list[ServiceContext],
    profiles: ProfilesConfig,
    cpu_budget: float,
    effective_free_ram: float,
    allow_cgroups: bool,
    trace: list[str],
) -> tuple[float, float, bool]:
    m_predicted = sum(s.current_ram_mb * s.replicas for s in contexts)
    c_predicted = sum(s.cpu * s.replicas for s in contexts)
    m_gap = m_predicted - effective_free_ram
    c_gap = c_predicted - cpu_budget

    cgroups_used = False
    if (m_gap > 0) and not allow_cgroups:
        trace.append("[Safety] Cgroup injection disabled; cannot fit within host capacity.")
    elif allow_cgroups:
        cgroups_used = inject_cgroups(contexts, profiles, c_gap, effective_free_ram)
        if cgroups_used:
            m_predicted = sum(s.final_ram_mb for s in contexts)
            m_gap = m_predicted - effective_free_ram
            if m_gap > 0:
                trace.append(
                    f"[Safety] Hard resource limits injected; "
                    f"remaining RAM gap: {round(m_gap, 1)} MB."
                )
            else:
                trace.append("[Safety] Profile-based resource limits injected.")

    return m_gap, c_gap, cgroups_used


def inject_cgroups(
    contexts: list[ServiceContext],
    profiles: ProfilesConfig,
    c_gap: float,
    effective_free_ram: float,
) -> bool:
    active_footprint = sum(s.current_ram_mb * s.replicas for s in contexts)
    overflow = max(0.0, active_footprint - effective_free_ram)

    exempt = [s for s in contexts if s.xtuning_never_cgroup or not s.xtuning_optimizable]
    eligible = [s for s in contexts if not s.xtuning_never_cgroup and s.xtuning_optimizable]
    eligible_footprint = sum(s.current_ram_mb * s.replicas for s in eligible)

    if overflow > 0 and eligible:
        total_headroom = sum(
            max(0.0, (s.current_ram_mb - (
                s.xtuning_ram_floor_mb
                if s.xtuning_ram_floor_mb is not None
                else profiles.floors[s.tier].ram_mb
            )) * s.replicas)
            for s in eligible
        )
        if total_headroom < overflow:
            return False

    injected = False
    for service in eligible:
        floor_ram = (
            service.xtuning_ram_floor_mb
            if service.xtuning_ram_floor_mb is not None
            else profiles.floors[service.tier].ram_mb
        )
        reduction = (
            overflow * ((service.current_ram_mb * service.replicas) / eligible_footprint)
            if eligible_footprint
            else 0.0
        )
        budgeted = (service.current_ram_mb * service.replicas) - reduction
        limit_mb = max(budgeted / service.replicas, floor_ram)
        service.final_ram_mb = limit_mb

        mem_str = f"{int(limit_mb)}M"
        if not _limits_already_set(service, mem_str, c_gap):
            _write_resource_limit(service.node, "memory", mem_str)
            if c_gap > 0:
                cpu_limit = max(0.05, service.cpu)
                _write_resource_limit(service.node, "cpus", round(cpu_limit, 2))
            service.cgroups_injected = True
            injected = True

    for service in exempt:
        service.final_ram_mb = service.current_ram_mb
        if c_gap > 0:
            _write_resource_limit(service.node, "cpus", round(max(0.05, service.cpu), 2))

    return injected


def _limits_already_set(service: ServiceContext, mem_str: str, c_gap: float) -> bool:
    deploy = service.node.get("deploy")
    if not isinstance(deploy, dict):
        return False
    resources = deploy.get("resources")
    if not isinstance(resources, dict):
        return False
    limits = resources.get("limits")
    if not isinstance(limits, dict):
        return False
    if str(limits.get("memory")) != mem_str:
        return False
    if c_gap > 0:
        cpu_limit = round(max(0.05, service.cpu), 2)
        return str(limits.get("cpus")) == str(cpu_limit)
    return True


def _write_resource_limit(service: Any, key: str, value: Any) -> None:
    deploy = service.setdefault("deploy", CommentedMap())
    resources = deploy.setdefault("resources", CommentedMap())
    limits = resources.setdefault("limits", CommentedMap())
    limits[key] = value
