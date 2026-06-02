"""Phase 2 — Backend QA Tests (offline, no server required)."""

import json
import time
from app.engine import run_optimization_engine
from app.schemas import AnalyzeRequest, HostHardware

DEFAULT_HW = HostHardware(
    total_ram_mb=8192,
    free_ram_mb=6144,
    cpu_cores=4,
    storage_type="SSD",
)

VALID_YAML = """\
version: "3.9"
services:
  frontend:
    image: nginx:alpine
    ports:
      - "8080:80"
  backend:
    image: node:20-alpine
    ports:
      - "3000:3000"
    environment:
      WORKERS: 4
  cache:
    image: redis:7-alpine
    environment:
      maxmemory: 128
"""

MIXED_SERVICE_YAML = """\
services:
  api:
    image: node:20
    ports:
      - "3000:3000"
    environment:
      WORKERS: 4
"""

INVALID_YAML = """\
this: is: [badly: formed yaml
  - missing
"""

MUTATION_YAML_A = """\
services:
  backend:
    image: node:20-alpine
    ports:
      - "3000:3000"
    environment:
      WORKERS: 8
      WEB_CONCURRENCY: 8
"""

MUTATION_YAML_B = """\
services:
  backend:
    image: node:20-alpine
    ports:
      - "3000:3000"
    environment:
      WORKERS: 2
      WEB_CONCURRENCY: 2
"""


def test_determinism():
    """Same input must produce identical output."""
    req = AnalyzeRequest(
        yaml_string=VALID_YAML,
        selected_profile="silent_running",
        host_hardware=DEFAULT_HW,
    )
    r1 = run_optimization_engine(req)
    r2 = run_optimization_engine(req)
    j1 = json.loads(r1.model_dump_json())
    j2 = json.loads(r2.model_dump_json())
    assert j1 == j2, "FAIL: non-deterministic output"
    print("  determinism: ✅")


def test_invalid_yaml():
    """Invalid YAML → INVALID_MANIFEST, empty topology, no crash."""
    req = AnalyzeRequest(
        yaml_string=INVALID_YAML,
        selected_profile="silent_running",
        host_hardware=DEFAULT_HW,
    )
    r = run_optimization_engine(req)
    assert r.status == "INVALID_MANIFEST", f"FAIL: got status={r.status}"
    assert len(r.topology) == 0, f"FAIL: topology not empty ({len(r.topology)})"
    assert len(r.services) == 0, f"FAIL: services not empty ({len(r.services)})"
    print("  invalid handling: ✅")


def test_mutation_sensitivity():
    """Config changes must affect output."""
    req_a = AnalyzeRequest(
        yaml_string=MUTATION_YAML_A,
        selected_profile="silent_running",
        host_hardware=DEFAULT_HW,
    )
    req_b = AnalyzeRequest(
        yaml_string=MUTATION_YAML_B,
        selected_profile="silent_running",
        host_hardware=DEFAULT_HW,
    )
    r_a = run_optimization_engine(req_a)
    r_b = run_optimization_engine(req_b)
    ja = json.loads(r_a.model_dump_json())
    jb = json.loads(r_b.model_dump_json())
    assert ja != jb, "FAIL: different configs produced identical output"
    print("  mutation sensitivity: ✅")


def test_mixed_service_classification():
    """Service with ports + WORKERS env must be backend_hybrid, NOT backend_low_priority."""
    req = AnalyzeRequest(
        yaml_string=MIXED_SERVICE_YAML,
        selected_profile="silent_running",
        host_hardware=DEFAULT_HW,
    )
    r = run_optimization_engine(req)
    api_service = next((s for s in r.services if s.name == "api"), None)
    assert api_service is not None, "FAIL: api service not found"
    assert api_service.tier == "backend_hybrid", (
        f"FAIL: api classified as {api_service.tier}, expected backend_hybrid"
    )
    print("  mixed-service classification: ✅")


def test_performance():
    """≥5 runs, average must be < 200ms."""
    req = AnalyzeRequest(
        yaml_string=VALID_YAML,
        selected_profile="silent_running",
        host_hardware=DEFAULT_HW,
    )
    times = []
    n = 5
    for _ in range(n):
        t0 = time.perf_counter()
        run_optimization_engine(req)
        t1 = time.perf_counter()
        times.append((t1 - t0) * 1000)
    avg = sum(times) / n
    mn = min(times)
    mx = max(times)
    status = "✅" if avg < 200 else "❌"
    print(f"  performance: {status} avg: {avg:.1f} ms (n={n}, min={mn:.1f} ms, max={mx:.1f} ms)")
    assert avg < 200, f"FAIL: avg {avg:.1f}ms >= 200ms"


if __name__ == "__main__":
    print("\n=== Phase 2: Backend QA ===\n")
    test_determinism()
    test_invalid_yaml()
    test_mutation_sensitivity()
    test_mixed_service_classification()
    test_performance()
    print("\n=== All Phase 2 tests passed ===\n")
