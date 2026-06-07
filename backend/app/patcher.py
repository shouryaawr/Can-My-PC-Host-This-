from __future__ import annotations

from .schemas import (
    AnalyzeResponse,
    OptimizationMetrics,
    PatchCoord,
    ServiceAnalysisResult,
    ServiceContext,
    SolverResult,
)

def build_response(result: SolverResult) -> AnalyzeResponse:
    patches = build_patches(result.contexts, result.c_gap)
    optimized_yaml = result.baseline_yaml_string
    service_results = build_service_results(result.contexts, result.floor_flags)

    return AnalyzeResponse(
        status=result.status,
        optimized_yaml_string=optimized_yaml,
        optimized_yaml=optimized_yaml,
        baseline_yaml_string=result.baseline_yaml_string,
        patches=patches,
        metrics=OptimizationMetrics(
            initial_predicted_ram_mb=result.initial_predicted_ram,
            final_predicted_ram_mb=result.final_predicted_ram,
            ram_margin_mb=result.effective_free_ram - result.final_predicted_ram,
            cpu_saturation_pct=(result.final_cpu / result.cpu_budget * 100) if result.cpu_budget else 0.0,
            free_ram_mb=result.payload.host_hardware.free_ram_mb,
        ),
        services=service_results,
        topology=service_results,
        warnings=result.warnings,
        execution_trace=result.trace,
        trace_log=result.trace,
    )

def build_error_response(
    status: str,
    yaml_string: str,
    trace: list[str],
    warnings: list[str],
    services: list[ServiceContext] | None = None,
    baseline_yaml_string: str = "",
    free_ram_mb: float = 0.0,
) -> AnalyzeResponse:
    contexts = services or []
    service_results = build_service_results(contexts)
    return AnalyzeResponse(
        status=status,
        optimized_yaml_string=yaml_string,
        optimized_yaml=yaml_string,
        baseline_yaml_string=baseline_yaml_string or yaml_string,
        patches=[],
        metrics=OptimizationMetrics(
            initial_predicted_ram_mb=sum(s.initial_ram_mb * s.replicas for s in contexts),
            final_predicted_ram_mb=sum(s.final_ram_mb * s.replicas for s in contexts),
            ram_margin_mb=0.0,
            cpu_saturation_pct=0.0,
            free_ram_mb=free_ram_mb,
        ),
        services=service_results,
        topology=service_results,
        warnings=warnings,
        execution_trace=trace,
        trace_log=trace,
    )

def build_service_results(
    contexts: list[ServiceContext],
    floor_flags: dict[str, bool] | None = None,
) -> list[ServiceAnalysisResult]:
    flags = floor_flags or {}
    return [
        ServiceAnalysisResult(
            name=s.name,
            tier=s.tier,
            replicas=s.replicas,
            initial_ram_mb=s.initial_ram_mb,
            final_ram_mb=s.final_ram_mb,
            variables_mutated=s.variables_mutated,
            cgroups_injected=s.cgroups_injected,
            at_floor=flags.get(s.name, False),
        )
        for s in contexts
    ]

def build_patches(
    contexts: list[ServiceContext], c_gap: float
) -> list[PatchCoord]:
    patches: list[PatchCoord] = []

    for service in contexts:
        _emit_env_patches(service, patches)
        if service.cgroups_injected:
            _emit_cgroup_patches(service, c_gap, patches)

    return patches

def _emit_env_patches(service: ServiceContext, patches: list[PatchCoord]) -> None:
    if not service.variables_mutated:
        return

    env = service.node.get("environment")
    for var_name, detail in service.variables_mutated.items():
        if isinstance(env, dict):
            patches.append(PatchCoord(
                op="set",
                path=["services", service.name, "environment", var_name],
                value=detail.to_val,
            ))
        elif isinstance(env, list):
            for i, item in enumerate(env):
                if isinstance(item, str) and item.startswith(f"{var_name}="):
                    patches.append(PatchCoord(
                        op="set",
                        path=["services", service.name, "environment", i],
                        value=f"{var_name}={detail.to_val}",
                    ))
                    break

def _emit_cgroup_patches(
    service: ServiceContext, c_gap: float, patches: list[PatchCoord]
) -> None:
    mem_limit = f"{int(service.final_ram_mb)}M"
    patches.append(PatchCoord(
        op="set",
        path=["services", service.name, "deploy", "resources", "limits", "memory"],
        value=mem_limit,
    ))
    if c_gap > 0 or service.xtuning_never_cgroup:
        cpu_limit = round(max(0.05, service.cpu), 2)
        patches.append(PatchCoord(
            op="set",
            path=["services", service.name, "deploy", "resources", "limits", "cpus"],
            value=cpu_limit,
        ))
