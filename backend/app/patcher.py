from __future__ import annotations

from .schemas import (
    AnalyzeResponse,
    DiagnosticsPayload,
    OptimizationMetrics,
    ServiceAnalysisResult,
    ServiceContext,
    SolverResult,
)


def build_diagnostics(
    services: list[ServiceAnalysisResult],
    headroom_mb: float,
    free_ram_mb: float,
) -> DiagnosticsPayload:
    return DiagnosticsPayload(
        cgroups_active=any(service.cgroups_injected for service in services),
        oom_risk_flag=headroom_mb < 64,
        headroom_mb=headroom_mb,
        free_ram_mb=free_ram_mb,
    )


def build_response(result: SolverResult, optimized_yaml: str) -> AnalyzeResponse:
    service_results = build_service_results(result.contexts, result.floor_flags)
    free_ram_mb = result.payload.host_hardware.free_ram_mb
    ram_margin_mb = result.effective_free_ram - result.final_predicted_ram
    post_allocation_memory = free_ram_mb - result.initial_predicted_ram

    return AnalyzeResponse(
        status=result.status,
        optimized_yaml_string=optimized_yaml,
        optimized_yaml=optimized_yaml,
        baseline_yaml_string=result.baseline_yaml_string,
        metrics=OptimizationMetrics(
            initial_predicted_ram_mb=result.initial_predicted_ram,
            final_predicted_ram_mb=result.final_predicted_ram,
            ram_margin_mb=ram_margin_mb,
            cpu_saturation_pct=(result.final_cpu / result.cpu_budget * 100) if result.cpu_budget else 0.0,
            free_ram_mb=free_ram_mb,
        ),
        services=service_results,
        topology=service_results,
        post_allocation_memory=post_allocation_memory,
        diagnostics=build_diagnostics(service_results, ram_margin_mb, free_ram_mb),
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
    initial_predicted_ram = sum(s.initial_ram_mb * s.replicas for s in contexts)
    final_predicted_ram = sum(s.final_ram_mb * s.replicas for s in contexts)
    ram_margin_mb = 0.0
    return AnalyzeResponse(
        status=status,
        optimized_yaml_string=yaml_string,
        optimized_yaml=yaml_string,
        baseline_yaml_string=baseline_yaml_string or yaml_string,
        metrics=OptimizationMetrics(
            initial_predicted_ram_mb=initial_predicted_ram,
            final_predicted_ram_mb=final_predicted_ram,
            ram_margin_mb=ram_margin_mb,
            cpu_saturation_pct=0.0,
            free_ram_mb=free_ram_mb,
        ),
        services=service_results,
        topology=service_results,
        post_allocation_memory=free_ram_mb - initial_predicted_ram,
        diagnostics=build_diagnostics(service_results, ram_margin_mb, free_ram_mb),
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


