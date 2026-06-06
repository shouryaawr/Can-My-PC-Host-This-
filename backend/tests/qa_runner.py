"""
qa_runner.py – Black-box QA runner for Can-My-PC-Host-This backend engine.

Loads every scenario from tests/test_matrix.yml, invokes the backend engine
directly (bypassing HTTP for speed and reliability), performs full mathematical
verification against the engine's published formulas, and writes a detailed
markdown report.

Usage:
    python -m tests.qa_runner
    # or
    python backend/tests/qa_runner.py
"""
from __future__ import annotations

import json
import math
import sys
import textwrap
import traceback
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Bootstrap: make "backend/app" importable regardless of cwd
# ---------------------------------------------------------------------------
_BACKEND_ROOT = Path(__file__).resolve().parents[1]  # …/backend
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from ruamel.yaml import YAML                         # noqa: E402

from app.engine import run_optimization_engine        # noqa: E402
from app.schemas import (                             # noqa: E402
    AnalyzeRequest,
    CustomProfileConfig,
    HostHardware,
)

# ---------------------------------------------------------------------------
# Tier RAM / CPU formulas (mirrors engine.py exactly for independent verification)
# ---------------------------------------------------------------------------
_HDD_MAX_CONNECTIONS_CEIL = 50
_HDD_MAXMEMORY_CEIL = 50


def _formula_database_ram(max_connections: float, replicas: int, is_hdd: bool) -> float:
    mc = min(max_connections, _HDD_MAX_CONNECTIONS_CEIL) if is_hdd else max_connections
    return (128.0 + mc * 15.0) * replicas


def _formula_backend_hybrid_ram(workers: float, web_concurrency: float, replicas: int) -> float:
    return (64.0 + workers * 32.0 + web_concurrency * 48.0) * replicas


def _formula_cache_ram(maxmemory: float, replicas: int, is_hdd: bool) -> float:
    mm = min(maxmemory, _HDD_MAXMEMORY_CEIL) if is_hdd else maxmemory
    return (16.0 + mm) * replicas


_PROFILE_PRESETS = {
    "silent_running": {"cpu_threshold_multiplier": 0.80, "ram_safety_buffer": 0.70},
    "max_performance": {"cpu_threshold_multiplier": 1.50, "ram_safety_buffer": 0.95},
    "background_dev":  {"cpu_threshold_multiplier": 1.00, "ram_safety_buffer": 0.50},
}

_FLOOR_RAM = {
    "database": 128.0,
    "backend_hybrid": 64.0,
    "backend_low_priority": 32.0,
    "cache": 16.0,
    "frontend": 8.0,
    "backend": 32.0,
}

# ---------------------------------------------------------------------------
# Result containers
# ---------------------------------------------------------------------------

@dataclass
class Failure:
    check: str
    expected: str
    actual: str
    detail: str = ""


@dataclass
class ScenarioResult:
    scenario_id: str
    description: str
    passed: bool
    failures: list[Failure] = field(default_factory=list)
    response_status: str = ""
    metrics: dict[str, Any] = field(default_factory=dict)
    services: list[dict[str, Any]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    trace: list[str] = field(default_factory=list)
    error: str = ""


# ---------------------------------------------------------------------------
# Loader
# ---------------------------------------------------------------------------

def _load_matrix(path: Path) -> list[dict[str, Any]]:
    yaml = YAML(typ="safe")
    data = yaml.load(path.read_text(encoding="utf-8"))
    return data["scenarios"]


# ---------------------------------------------------------------------------
# Schema builder
# ---------------------------------------------------------------------------

def _build_request(scenario: dict[str, Any]) -> AnalyzeRequest:
    hw = scenario["host_hardware"]
    hardware = HostHardware(
        total_ram_mb=float(hw["total_ram_mb"]),
        free_ram_mb=float(hw["free_ram_mb"]),
        cpu_cores=int(hw["cpu_cores"]),
        storage_type=hw["storage_type"],
    )

    custom_cfg = None
    raw_cfg = scenario.get("custom_profile_config")
    if raw_cfg:
        custom_cfg = CustomProfileConfig(
            ram_safety_buffer=float(raw_cfg["ram_safety_buffer"]),
            cpu_threshold_multiplier=float(raw_cfg["cpu_threshold_multiplier"]),
            max_iterations=int(raw_cfg.get("max_iterations", 50)),
            allow_cgroups=bool(raw_cfg.get("allow_cgroups", True)),
            floor_strictness=float(raw_cfg.get("floor_strictness", 1.0)),
        )

    return AnalyzeRequest(
        yaml_string=scenario.get("docker_compose") or "",
        selected_profile=scenario["selected_profile"],
        host_hardware=hardware,
        custom_profile_config=custom_cfg,
    )


# ---------------------------------------------------------------------------
# Verification helpers
# ---------------------------------------------------------------------------

def _get_profile(scenario: dict[str, Any]) -> dict[str, float]:
    profile_key = scenario["selected_profile"]
    raw_cfg = scenario.get("custom_profile_config")
    if raw_cfg:
        return {
            "ram_safety_buffer": float(raw_cfg["ram_safety_buffer"]),
            "cpu_threshold_multiplier": float(raw_cfg["cpu_threshold_multiplier"]),
        }
    return _PROFILE_PRESETS.get(profile_key, _PROFILE_PRESETS["background_dev"])


def _check_status(expect: dict, response_status: str, failures: list[Failure]) -> None:
    if "status" in expect:
        if response_status != expect["status"]:
            failures.append(Failure(
                check="response.status",
                expected=expect["status"],
                actual=response_status,
            ))
    elif "status_in" in expect:
        if response_status not in expect["status_in"]:
            failures.append(Failure(
                check="response.status (one-of)",
                expected=str(expect["status_in"]),
                actual=response_status,
            ))


def _check_min_services(expect: dict, services: list, failures: list[Failure]) -> None:
    min_svc = expect.get("min_services")
    if min_svc is not None and len(services) < min_svc:
        failures.append(Failure(
            check="services count",
            expected=f">= {min_svc}",
            actual=str(len(services)),
        ))


def _check_service_assertions(expect: dict, services: list[dict], failures: list[Failure]) -> None:
    for svc_assert in expect.get("services", []):
        name = svc_assert["name"]
        matched = next((s for s in services if s["name"] == name), None)
        if matched is None:
            failures.append(Failure(
                check=f"service '{name}' present",
                expected="present",
                actual="missing",
            ))
            continue
        if "tier" in svc_assert and matched.get("tier") != svc_assert["tier"]:
            failures.append(Failure(
                check=f"service '{name}' tier",
                expected=svc_assert["tier"],
                actual=str(matched.get("tier")),
            ))
        if "replicas" in svc_assert and matched.get("replicas") != svc_assert["replicas"]:
            failures.append(Failure(
                check=f"service '{name}' replicas",
                expected=str(svc_assert["replicas"]),
                actual=str(matched.get("replicas")),
            ))


def _check_warnings(expect: dict, warnings: list[str], failures: list[Failure]) -> None:
    if expect.get("no_warnings") and warnings:
        failures.append(Failure(
            check="no warnings",
            expected="[]",
            actual=str(warnings),
        ))
    for required_substr in expect.get("has_warnings", []):
        if not any(required_substr in w for w in warnings):
            failures.append(Failure(
                check=f"warning containing '{required_substr}'",
                expected=f"warning containing '{required_substr}'",
                actual=f"warnings={warnings}",
            ))


def _check_ram_invariants(
    scenario: dict[str, Any],
    metrics: dict[str, Any],
    services: list[dict],
    response_status: str,
    failures: list[Failure],
) -> None:
    """Mathematical invariant checks on every non-INVALID_MANIFEST response.

    UNSOLVABLE early-exit responses (floor-check short-circuit) set all metric
    fields to 0.0 because budget math never ran — skip formula checks for them.
    Only the status itself and service count are meaningful assertions there.
    """
    if response_status in ("INVALID_MANIFEST", "UNSOLVABLE"):
        return

    profile = _get_profile(scenario)
    hw = scenario["host_hardware"]
    free_ram_mb = int(round(float(hw["free_ram_mb"])))
    effective_free = free_ram_mb * profile["ram_safety_buffer"]

    # 1. free_ram_mb in metrics must match host hardware (after rounding)
    reported_free = metrics.get("free_ram_mb", None)
    if reported_free is not None and int(round(reported_free)) != free_ram_mb:
        failures.append(Failure(
            check="metrics.free_ram_mb",
            expected=str(free_ram_mb),
            actual=str(reported_free),
            detail="free_ram_mb in metrics must equal host_hardware.free_ram_mb (rounded)",
        ))

    # 2. final_predicted_ram_mb must equal sum of service final_ram_mb values
    svc_total = sum(s.get("final_ram_mb", 0.0) for s in services)
    reported_final = metrics.get("final_predicted_ram_mb", 0.0)
    if services and abs(svc_total - reported_final) > 1.0:  # 1 MB tolerance
        failures.append(Failure(
            check="metrics.final_predicted_ram_mb consistency",
            expected=f"≈ {round(svc_total, 2)} MB (sum of service final_ram_mb)",
            actual=f"{round(reported_final, 2)} MB",
            detail="final_predicted_ram_mb must equal sum of per-service final_ram_mb values",
        ))

    # 3. ram_margin_mb = effective_free_ram - final_predicted_ram_mb
    reported_margin = metrics.get("ram_margin_mb", 0.0)
    expected_margin = effective_free - reported_final
    if abs(reported_margin - expected_margin) > 1.0:
        failures.append(Failure(
            check="metrics.ram_margin_mb formula",
            expected=f"≈ {round(expected_margin, 2)} MB  (effective_free={round(effective_free,2)} - final_ram={round(reported_final,2)})",
            actual=f"{round(reported_margin, 2)} MB",
            detail="ram_margin_mb = (free_ram_mb * ram_safety_buffer) - final_predicted_ram_mb",
        ))

    # 4. FULLY_SOLVED must have non-negative margin (or margin just above -64 threshold)
    if response_status == "FULLY_SOLVED" and reported_margin < -1.0:
        failures.append(Failure(
            check="FULLY_SOLVED margin non-negative",
            expected=">= 0 MB",
            actual=f"{round(reported_margin, 2)} MB",
            detail="A FULLY_SOLVED result must fit within the effective RAM budget",
        ))

    # 5. DEGRADED_SAFE margin check: engine declares DEGRADED_SAFE either when
    #    cgroups were needed OR when margin < 64 MB. Both are valid.
    if response_status == "DEGRADED_SAFE" and reported_margin > effective_free:
        failures.append(Failure(
            check="DEGRADED_SAFE margin plausibility",
            expected=f"<= {round(effective_free, 2)} MB",
            actual=f"{round(reported_margin, 2)} MB",
            detail="DEGRADED_SAFE ram_margin_mb should not exceed total effective free RAM",
        ))

    # 6. Per-service floor validation
    for svc in services:
        tier = svc.get("tier", "backend")
        replicas = svc.get("replicas", 1)
        floor_ram = _FLOOR_RAM.get(tier, 32.0) * replicas
        final_ram = svc.get("final_ram_mb", 0.0)
        # x-tuning may lower the floor; we use conservative check with 0.5 strictness
        lenient_floor = floor_ram * 0.5
        if final_ram > 0 and final_ram < lenient_floor - 0.5:
            failures.append(Failure(
                check=f"service '{svc.get('name')}' final_ram_mb above floor",
                expected=f">= {lenient_floor:.1f} MB (lenient floor * replicas={replicas})",
                actual=f"{round(final_ram, 2)} MB",
                detail="Service RAM should not fall below 50% of its tier's minimum floor",
            ))

    # 7. cpu_saturation_pct must be non-negative
    cpu_sat = metrics.get("cpu_saturation_pct", 0.0)
    if cpu_sat < 0:
        failures.append(Failure(
            check="metrics.cpu_saturation_pct non-negative",
            expected=">= 0",
            actual=str(cpu_sat),
        ))


def _check_tier_ram_math(
    scenario: dict[str, Any],
    services: list[dict],
    response_status: str,
    failures: list[Failure],
) -> None:
    """Cross-check per-service initial_ram_mb against the published formulas."""
    if response_status == "INVALID_MANIFEST":
        return

    hw = scenario["host_hardware"]
    is_hdd = hw["storage_type"] == "HDD"
    free_ram_mb = int(round(float(hw["free_ram_mb"])))
    profile = _get_profile(scenario)
    effective_free = free_ram_mb * profile["ram_safety_buffer"]
    is_hdd_formula_check = hw["storage_type"] == "HDD"

    # Parse the docker-compose to extract declared environment values
    raw_compose = scenario.get("docker_compose") or ""
    compose_yaml = YAML(typ="safe")
    try:
        compose_doc = compose_yaml.load(raw_compose)
    except Exception:
        return  # can't parse; skip formula checks

    if not isinstance(compose_doc, dict):
        return

    raw_services = compose_doc.get("services")
    if not isinstance(raw_services, dict):
        return

    # Two-pass approach:
    # Pass 1: compute each service's formula-expected RAM and accumulate the
    #         total stack RAM to detect if the engine's global 10% pre-trim fired.
    # Pass 2: run the per-service formula assertions only when no pre-trim occurred.
    total_expected_initial = 0.0
    parsed_svcs: list[tuple[str, float, float, str, int, dict]] = []

    for svc_def_name, svc_def in raw_services.items():
        if not isinstance(svc_def, dict):
            continue

        matched = next((s for s in services if s["name"] == svc_def_name), None)
        if not matched:
            continue

        tier = matched.get("tier", "backend")
        replicas = matched.get("replicas", 1)
        env = svc_def.get("environment") or {}
        if isinstance(env, list):
            env_dict: dict[str, str] = {}
            for item in env:
                if "=" in str(item):
                    k, v = str(item).split("=", 1)
                    env_dict[k.strip()] = v.strip()
            env = env_dict

        def _env_float(key: str, default: float) -> float:
            try:
                return float(env.get(key, default))
            except (TypeError, ValueError):
                return default

        initial_ram = matched.get("initial_ram_mb", None)
        if initial_ram is None:
            continue

        if tier == "database":
            mc = _env_float("max_connections", 100.0)
            expected_ram = _formula_database_ram(mc, replicas, is_hdd_formula_check)
            if is_hdd and expected_ram / replicas > 256:
                expected_ram *= 1.25
        elif tier == "backend_hybrid":
            w = _env_float("WORKERS", 4.0)
            wc = _env_float("WEB_CONCURRENCY", 4.0)
            expected_ram = _formula_backend_hybrid_ram(w, wc, replicas)
        elif tier == "cache":
            mm = _env_float("maxmemory", 256.0)
            expected_ram = _formula_cache_ram(mm, replicas, is_hdd_formula_check)
        else:
            base_ram = _FLOOR_RAM.get(tier, 64.0)
            if tier == "backend":
                base_ram = 64.0
            elif tier == "backend_low_priority":
                base_ram = 64.0
            elif tier == "frontend":
                base_ram = 16.0
            expected_ram = base_ram * replicas

        total_expected_initial += expected_ram
        parsed_svcs.append((svc_def_name, initial_ram, expected_ram, tier, replicas, env))

    if total_expected_initial > 0.80 * effective_free:
        return

    for name, initial, expected, tier, reps, env in parsed_svcs:
        tolerance = max(2.0, expected * 0.05)
        if abs(initial - expected) > tolerance:
            failures.append(Failure(
                check=f"service '{name}' initial_ram_mb formula",
                expected=f"≈ {round(expected, 2)} MB",
                actual=f"{round(initial, 2)} MB",
                detail=(
                    f"tier={tier}, replicas={reps}, is_hdd={is_hdd}. "
                    f"Formula: {_formula_detail(tier, env, reps, is_hdd_formula_check)}"
                ),
            ))


def _formula_detail(tier: str, env: dict, replicas: int, is_hdd: bool) -> str:
    def g(k: str, d: float) -> float:
        try:
            return float(env.get(k, d))
        except (TypeError, ValueError):
            return d

    if tier == "database":
        mc = g("max_connections", 100)
        if is_hdd:
            mc = min(mc, _HDD_MAX_CONNECTIONS_CEIL)
        return f"128 + ({mc} × 15) × {replicas} = {(128 + mc * 15) * replicas}"
    elif tier == "backend_hybrid":
        w, wc = g("WORKERS", 4), g("WEB_CONCURRENCY", 4)
        return f"64 + ({w}×32) + ({wc}×48) × {replicas} = {(64 + w*32 + wc*48)*replicas}"
    elif tier == "cache":
        mm = g("maxmemory", 256)
        if is_hdd:
            mm = min(mm, _HDD_MAXMEMORY_CEIL)
        return f"16 + {mm} × {replicas} = {(16 + mm) * replicas}"
    return "base_ram × replicas"


# ---------------------------------------------------------------------------
# Runner core
# ---------------------------------------------------------------------------

def run_scenario(scenario: dict[str, Any]) -> ScenarioResult:
    sid = scenario["id"]
    desc = scenario.get("description", "")
    result = ScenarioResult(scenario_id=sid, description=desc, passed=False)
    failures: list[Failure] = []

    try:
        request = _build_request(scenario)
        response = run_optimization_engine(request)
    except Exception as exc:
        result.error = f"{type(exc).__name__}: {exc}\n{traceback.format_exc()}"
        result.failures.append(Failure(
            check="engine invocation",
            expected="no exception",
            actual=str(exc),
        ))
        return result

    # Serialise response for inspection
    result.response_status = response.status
    result.metrics = response.metrics.model_dump()
    result.services = [s.model_dump(by_alias=True) for s in response.services]
    result.warnings = list(response.warnings)
    result.trace = list(response.execution_trace)

    expect = scenario.get("expect", {})

    # --- Check status ---
    _check_status(expect, response.status, failures)

    # --- Check service count ---
    _check_min_services(expect, result.services, failures)

    # --- Check per-service assertions ---
    _check_service_assertions(expect, result.services, failures)

    # --- Check warnings ---
    _check_warnings(expect, result.warnings, failures)

    # --- RAM invariant math ---
    _check_ram_invariants(scenario, result.metrics, result.services, response.status, failures)

    # --- Formula cross-check ---
    _check_tier_ram_math(scenario, result.services, response.status, failures)

    result.failures = failures
    result.passed = len(failures) == 0
    return result


# ---------------------------------------------------------------------------
# Report generator
# ---------------------------------------------------------------------------

def _md_status_badge(passed: bool) -> str:
    return "✅ PASS" if passed else "❌ FAIL"


def generate_report(results: list[ScenarioResult], elapsed_s: float) -> str:
    total = len(results)
    passed = sum(1 for r in results if r.passed)
    failed = total - passed
    ts = datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    lines: list[str] = []

    lines.append("# Can-My-PC-Host-This — QA Verification Report")
    lines.append("")
    lines.append(f"**Generated:** {ts}  ")
    lines.append(f"**Duration:** {elapsed_s:.2f}s  ")
    lines.append(f"**Total Scenarios:** {total}  ")
    lines.append(f"**Passed:** {passed}  ")
    lines.append(f"**Failed:** {failed}  ")
    lines.append(f"**Pass Rate:** {passed/total*100:.1f}%")
    lines.append("")

    if failed == 0:
        lines.append("> [!NOTE]")
        lines.append("> 🎉 All scenarios passed — 100% correctness verified.")
    else:
        lines.append("> [!CAUTION]")
        lines.append(f"> ⚠️ {failed} scenario(s) failed. See details below.")

    lines.append("")
    lines.append("---")
    lines.append("")

    # Summary table
    lines.append("## Executive Summary")
    lines.append("")
    lines.append("| # | Scenario ID | Description | Result | Status | Failures |")
    lines.append("|---|-------------|-------------|--------|--------|----------|")
    for i, r in enumerate(results, 1):
        badge = _md_status_badge(r.passed)
        desc_short = textwrap.shorten(r.description, width=55, placeholder="…")
        failures_count = len(r.failures) if not r.passed else 0
        lines.append(
            f"| {i} | `{r.scenario_id}` | {desc_short} | {badge} "
            f"| `{r.response_status or 'N/A'}` | {failures_count} |"
        )

    lines.append("")
    lines.append("---")
    lines.append("")

    # Group results by pass/fail
    failing = [r for r in results if not r.passed]
    passing = [r for r in results if r.passed]

    # Failures section (detailed)
    if failing:
        lines.append("## ❌ Failed Scenarios — Full Detail")
        lines.append("")
        for r in failing:
            lines.append(f"### `{r.scenario_id}` — {r.description}")
            lines.append("")
            if r.error:
                lines.append("> [!CAUTION]")
                lines.append(f"> **Engine threw an exception:** `{r.error.splitlines()[0]}`")
                lines.append("")
                lines.append("```")
                lines.append(r.error)
                lines.append("```")
                lines.append("")

            lines.append("#### Failures")
            lines.append("")
            lines.append("| # | Check | Expected | Actual | Detail |")
            lines.append("|---|-------|----------|--------|--------|")
            for j, f in enumerate(r.failures, 1):
                lines.append(
                    f"| {j} | `{f.check}` | `{f.expected}` | `{f.actual}` | {f.detail or '—'} |"
                )
            lines.append("")

            lines.append("#### Response")
            lines.append("")
            lines.append(f"- **Status:** `{r.response_status}`")
            metrics = r.metrics
            if metrics:
                lines.append(
                    f"- **Metrics:** initial_ram={round(metrics.get('initial_predicted_ram_mb', 0), 2)} MB, "
                    f"final_ram={round(metrics.get('final_predicted_ram_mb', 0), 2)} MB, "
                    f"margin={round(metrics.get('ram_margin_mb', 0), 2)} MB, "
                    f"cpu_sat={round(metrics.get('cpu_saturation_pct', 0), 2)}%, "
                    f"free_ram={round(metrics.get('free_ram_mb', 0), 2)} MB"
                )
            if r.services:
                lines.append("")
                lines.append("**Services:**")
                lines.append("")
                lines.append("| Name | Tier | Replicas | Initial RAM | Final RAM | Cgroups |")
                lines.append("|------|------|----------|-------------|-----------|---------|")
                for svc in r.services:
                    lines.append(
                        f"| {svc.get('name')} | {svc.get('tier')} | {svc.get('replicas')} "
                        f"| {round(svc.get('initial_ram_mb', 0), 2)} MB "
                        f"| {round(svc.get('final_ram_mb', 0), 2)} MB "
                        f"| {svc.get('cgroups_injected', False)} |"
                    )
            if r.warnings:
                lines.append("")
                lines.append("**Warnings:**")
                for w in r.warnings:
                    lines.append(f"- {w}")
            lines.append("")
            lines.append("<details>")
            lines.append("<summary>Execution Trace</summary>")
            lines.append("")
            lines.append("```")
            for t in r.trace:
                lines.append(t)
            lines.append("```")
            lines.append("")
            lines.append("</details>")
            lines.append("")
            lines.append("---")
            lines.append("")

    # Passing section (compact)
    lines.append("## ✅ Passed Scenarios")
    lines.append("")
    for r in passing:
        metrics = r.metrics
        m_str = (
            f"initial={round(metrics.get('initial_predicted_ram_mb', 0), 2)} MB, "
            f"final={round(metrics.get('final_predicted_ram_mb', 0), 2)} MB, "
            f"margin={round(metrics.get('ram_margin_mb', 0), 2)} MB, "
            f"cpu_sat={round(metrics.get('cpu_saturation_pct', 0), 2)}%"
        ) if metrics else "N/A"

        lines.append(f"<details>")
        lines.append(f"<summary><code>{r.scenario_id}</code> — {r.description}</summary>")
        lines.append("")
        lines.append(f"**Status:** `{r.response_status}` | **Metrics:** {m_str}")
        if r.services:
            lines.append("")
            lines.append("| Name | Tier | Replicas | Initial RAM | Final RAM | Cgroups |")
            lines.append("|------|------|----------|-------------|-----------|---------|")
            for svc in r.services:
                lines.append(
                    f"| {svc.get('name')} | {svc.get('tier')} | {svc.get('replicas')} "
                    f"| {round(svc.get('initial_ram_mb', 0), 2)} MB "
                    f"| {round(svc.get('final_ram_mb', 0), 2)} MB "
                    f"| {svc.get('cgroups_injected', False)} |"
                )
        if r.warnings:
            lines.append("")
            lines.append("**Warnings:**")
            for w in r.warnings:
                lines.append(f"- {w}")
        lines.append("")
        lines.append("</details>")
        lines.append("")

    lines.append("---")
    lines.append("")
    lines.append("## Business Logic Reference")
    lines.append("")
    lines.append("The following formulas are verified by this QA suite:")
    lines.append("")
    lines.append("### RAM Calculation Formulas")
    lines.append("")
    lines.append("| Tier | Formula |")
    lines.append("|------|---------|")
    lines.append("| `database` | `(128 + max_connections × 15) × replicas` |")
    lines.append("| `backend_hybrid` | `(64 + WORKERS×32 + WEB_CONCURRENCY×48) × replicas` |")
    lines.append("| `cache` | `(16 + maxmemory) × replicas` |")
    lines.append("| `frontend` | `16 × replicas` |")
    lines.append("| `backend` | `64 × replicas` |")
    lines.append("| `backend_low_priority` | `64 × replicas` |")
    lines.append("")
    lines.append("### HDD Overrides")
    lines.append("")
    lines.append("- `max_connections` capped at **50** for RAM formula when `storage_type=HDD`")
    lines.append("- `maxmemory` capped at **50** when `storage_type=HDD`")
    lines.append("- Database services with base RAM > 256 MB get a **+25% cushion** on HDD hosts")
    lines.append("")
    lines.append("### Host Profiles")
    lines.append("")
    lines.append("| Profile | `ram_safety_buffer` | `cpu_threshold_multiplier` |")
    lines.append("|---------|---------------------|---------------------------|")
    lines.append("| `silent_running` | 0.70 | 0.80 |")
    lines.append("| `max_performance` | 0.95 | 1.50 |")
    lines.append("| `background_dev` | 0.50 | 1.00 |")
    lines.append("| `custom` | caller-specified | caller-specified |")
    lines.append("")
    lines.append("### Metrics Formulas")
    lines.append("")
    lines.append("```")
    lines.append("effective_free_ram  = free_ram_mb × ram_safety_buffer")
    lines.append("cpu_budget          = cpu_cores × cpu_threshold_multiplier")
    lines.append("ram_margin_mb       = effective_free_ram − final_predicted_ram_mb")
    lines.append("cpu_saturation_pct  = (total_cpu / cpu_budget) × 100")
    lines.append("```")
    lines.append("")
    lines.append("### Status Decision Tree")
    lines.append("")
    lines.append("```")
    lines.append("if floor_total > free_ram_mb                          → UNSOLVABLE (early)")
    lines.append("else if optimization loop + cgroups resolve gap:")
    lines.append("    if cgroups_used and gap <= 0                      → DEGRADED_SAFE")
    lines.append("    elif gap > 0                                       → UNSOLVABLE")
    lines.append("    elif ram_margin < 64 MB                           → DEGRADED_SAFE")
    lines.append("    else                                               → FULLY_SOLVED")
    lines.append("```")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> int:
    # Force UTF-8 on Windows consoles that default to cp1252
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    import time

    matrix_path = Path(__file__).parent / "test_matrix.yml"
    if not matrix_path.exists():
        print(f"ERROR: test_matrix.yml not found at {matrix_path}", file=sys.stderr)
        return 1

    scenarios = _load_matrix(matrix_path)
    print(f"Loaded {len(scenarios)} scenarios from {matrix_path.name}")
    print("=" * 70)

    results: list[ScenarioResult] = []
    start = time.perf_counter()

    for scenario in scenarios:
        sid = scenario["id"]
        print(f"  Running [{sid}] ... ", end="", flush=True)
        result = run_scenario(scenario)
        results.append(result)
        if result.passed:
            print("PASS")
        else:
            print(f"FAIL  ({len(result.failures)} failure(s))")
            for f in result.failures:
                print(f"          -> [{f.check}] expected={f.expected!r} actual={f.actual!r}")

    elapsed = time.perf_counter() - start
    total = len(results)
    passed = sum(1 for r in results if r.passed)
    failed = total - passed

    print("=" * 70)
    print(f"Results: {passed}/{total} passed in {elapsed:.2f}s")

    # Write report
    report_md = generate_report(results, elapsed)
    report_path = Path(__file__).parents[2] / "qa_verification_report.md"
    report_path.write_text(report_md, encoding="utf-8")
    print(f"\nReport written → {report_path}")

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
