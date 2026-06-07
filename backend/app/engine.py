from __future__ import annotations

from .parser import parse_analysis_payload
from .patcher import build_response
from .schemas import AnalyzeRequest, AnalyzeResponse, ProfilesConfig, ensure_profiles_config
from .solver import solve_analysis


def run_optimization_engine(
    payload: AnalyzeRequest,
    profiles: ProfilesConfig | None = None,
) -> AnalyzeResponse:
    config = ensure_profiles_config(profiles)
    parsed = parse_analysis_payload(payload, config)
    if parsed.response is not None:
        return parsed.response

    solved = solve_analysis(parsed)
    if solved.response is not None:
        return solved.response

    return build_response(solved)
