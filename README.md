# Can My PC Host This?

**Your Hardware-Aware Docker Compose Optimization Engine**

*Stop guessing if your system will crash. Know before you deploy.*

---

**Can My PC Host This?** is a fully self-contained, full-stack application with a custom deterministic optimization engine—no external AI APIs, no third-party cloud dependencies. It runs 100% locally to mathematically evaluate Docker Compose manifests against your specific host hardware and emit a minimal set of resource constraints that fit your exact operational profile.

Before you spin up a complex stack of microservices, this tool analyzes the full load, algebraically projects optimal variable values for each service tier, and generates a precise patch set that injects `deploy.resources` limits directly into your manifest.

Built for developers running heavy local stacks without freezing their IDE, and for sysadmins squeezing maximum efficiency from dedicated hosts.

> **Project Status**: Active Development. The engine currently supports Docker Compose v3+ memory and CPU limits with full replica scaling. Multi-node Swarm orchestration and Kubernetes support are planned.

---

## Table of Contents
- [Key Features](#key-features)
- [Architecture](#architecture)
- [How It Works](#how-it-works)
- [Tech Stack](#tech-stack)
- [Quick Start & Installation](#quick-start--installation)
- [Running Tests](#running-tests)
- [Roadmap](#roadmap)

---

## Key Features

**Deterministic Optimization Engine**
Say goodbye to OOM kills. The engine calculates predicted RAM and CPU utilization for every service and tier in your manifest, then injects strict `deploy.resources.limits` using mathematical models calibrated to your hardware. The solver operates algebraically—it projects the highest viable variable value that fits within your memory budget before falling back to hard cgroup limits.

**Pydantic-Validated Configuration**
All tier profiles, resource floors, variable aliases, and image classification data are loaded once at server startup via FastAPI's `lifespan` hook into a validated `ProfilesConfig` Pydantic model. Every field carries a strict type contract enforced at load time. No raw dictionary access occurs anywhere in the pipeline at runtime.

**Hardware Auto-Detection & Manual Override**
The dashboard uses available browser APIs (`navigator.hardwareConcurrency`, `navigator.deviceMemory`) to approximate your CPU core count and total system memory. For precise tuning, a manual override panel lets you input exact hardware specs or simulate a different machine. The backend also exposes a `/api/v1/hardware` endpoint that reads your actual system stats via `psutil` for server-side detection.

**Tailored Operational Profiles**
Choose a profile that matches your workload:
- **Silent Running**: 70% RAM safety buffer, 80% CPU cap. Best for background services while you work.
- **Background Dev**: 50% RAM buffer, 100% CPU cap. Balanced for development machines sharing resources with an IDE.
- **Max Performance**: 95% RAM buffer, 150% CPU cap. For dedicated hosts where the stack owns the machine.
- **Advanced / Custom**: Fully control the RAM safety buffer, CPU threshold multiplier, iteration cap, cgroup injection, and floor strictness.

**Frictionless GitHub Integration**
Fetch and analyze manifests from any public GitHub repository directly. If a compose file is buried in a monorepo, the engine falls back to the GitHub Tree API, recursively scans for all valid compose filenames, and surfaces a clean dropdown for selection when multiple manifests are found.

**Port Conflict Detection**
Pre-processing tokenizes environment variable placeholders (e.g., `${PORT}:8080`) before scanning, eliminating false positives while accurately mapping standard `host:container` port bindings and detecting wildcard-to-specific conflicts.

**Service Tier Classification**
Services are automatically classified into resource tiers (`database`, `cache`, `backend_hybrid`, `backend_low_priority`, `frontend`, `backend`) using a priority chain: explicit label override → image name lookup table → port exposure → name and body token scan. Each tier carries its own RAM formula, CPU scaling model, variable floor, and tunable variable set.

**`x-tuning` Extension Block**
Any service in your compose file can carry an `x-tuning` block to override solver behavior per-service:
- `ram_floor_mb`: sets a hard lower bound for memory allocation
- `never_cgroup`: excludes the service from cgroup injection
- `target_variable`: overrides the solver's auto-detected tuning variable
- `optimizable: false`: locks the service at its baseline footprint

**Interactive Visualizations**
- **Diff Viewer**: Syntax-highlighted side-by-side comparison of your original and optimized manifest.
- **Node Topology**: Dynamic visual graph of the service dependency graph and network topology.
- **Rule Trace**: Step-by-step diagnostic log of how the engine allocated memory and CPU, down to the megabyte per service.
- **Diagnostics**: Full metrics panel with RAM margin, CPU saturation percentage, and per-service floor flags.

---

## Architecture

```
backend/app/
├── main.py
├── engine.py
├── parser.py
├── solver.py
├── patcher.py
├── schemas.py
└── profiles.json
```

### Pipeline

```
POST /api/v1/analyze
        │
        ▼
parse_analysis_payload(payload, profiles)
        │
        ▼
solve_analysis(parsed)
        │
        ▼
build_response(result)
```

### Configuration Loading

`profiles.json` is read once at application startup inside the FastAPI `lifespan` context manager and stored as `app.state.profiles` — a fully validated `ProfilesConfig` instance. All downstream pipeline functions receive this object directly. No disk reads occur during request handling.

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.profiles = load_profiles_config()
    yield
```

`load_profiles_config()` is additionally decorated with `@lru_cache(maxsize=1)` so that any call outside the lifespan (e.g., directly in tests) also reads the file only once.

### ProfilesConfig Model

```
ProfilesConfig
├── host_profiles: dict[str, HostProfileConfig]
├── tiers: dict[str, TierProfileConfig]
├── floors: dict[str, FloorProfileConfig]
└── image_lookup_table: dict[str, str]
```

All four sub-models carry `extra="forbid"` to reject stale or unknown configuration keys at load time.

### Patch Application

The backend produces a `patches: List[PatchCoord]` array of typed operations (`op: "set" | "add" | "remove"`, `path: List[str]`, `value: Any`) describing only what changed. The frontend applies these coordinates against the original YAML string using the `yaml` package's `parseDocument` + `setIn` API. This preserves all original aliases, formatting, and inline comments in the Diff Viewer.

---

## How It Works

1. **Ingest**: Paste raw YAML or provide a GitHub repository URL. The backend handles deep monorepo path resolution automatically via the Tree API fallback.
2. **Classify**: Each service is assigned a resource tier based on its image, labels, port exposure, and name tokens. Tier assignment determines which RAM formula, CPU model, tunable variable, and floor constraints apply.
3. **Solve**: The algebraic solver projects the maximum viable value for each tier's primary variable (e.g., `max_connections` for databases, `WORKERS` for API servers, `maxmemory` for caches) that fits within the profile-adjusted RAM budget. Replica count is factored into all cost calculations.
4. **Patch**: The solver's mutations are encoded as a minimal `PatchCoord` list. The frontend overlays them client-side, producing a clean diff without touching untouched sections of the manifest.

---

## Tech Stack

**Backend**
- **Python 3.11+** — minimum required runtime
- **FastAPI 0.115** — ASGI framework with lifespan-managed startup
- **Pydantic v2** — strict schema validation for all configuration and API types
- **ruamel.yaml** — round-trip YAML parser that preserves comments and formatting
- **psutil** — system hardware telemetry for the `/api/v1/hardware` endpoint
- **uvicorn** — ASGI server

**Frontend**
- **React 18** + **Vite 5** — component-based UI with hot-module replacement
- **Tailwind CSS v3** — dark-mode-first styling
- **Lucide React** — icon library
- **yaml** (eemeli) — client-side YAML AST patching via `parseDocument` + `setIn`
- **diff** — line-diff computation for the Diff Viewer

---

## Quick Start & Installation

### 1. Clone the Repository

```bash
git clone https://github.com/shouryaawr/Can-My-PC-Host-This-.git
cd Can-My-PC-Host-This-
```

### 2. Backend

Requires Python 3.11+.

```bash
cd backend
python -m venv .venv
```

If `venv` creation hangs on Windows during `ensurepip`:

```powershell
py -3 -m venv .venv --without-pip
.\.venv\Scripts\activate
python -m ensurepip --upgrade
```

**Activate:**

Windows:
```powershell
.\.venv\Scripts\activate
```

macOS / Linux:
```bash
source .venv/bin/activate
```

**Install and run:**

```bash
pip install -r requirements.txt
uvicorn app.main:app --reload
```

The FastAPI server starts on `http://localhost:8000`. The interactive API docs are available at `http://localhost:8000/docs`.

### 3. Frontend

Requires Node.js 18+. Open a new terminal from the project root.

```bash
cd frontend
npm install
npm run dev
```

The Vite dev server starts on `http://localhost:5173` and proxies all `/api` requests to the backend automatically.

**Production build:**

```bash
npm run build
npm run preview
```

---

## Running Tests

The test suite covers the full optimization pipeline — RAM formulas, CPU scaling, floor enforcement, cgroup injection, algebraic projection, replica multipliers, and end-to-end engine integration — with 55 assertions.

```bash
cd backend
python -m pytest tests/ -v
```

All tests run without a live server. The `engine.py` integration tests call `run_optimization_engine` directly, which uses `ensure_profiles_config` to load `profiles.json` via the cached `load_profiles_config()` function.

---

## Roadmap

- **CLI Integration**: Expose the engine as a terminal tool (`cmy-host check`) that runs before `docker-compose up`.
- **Kubernetes Support**: Extend the solver to analyze Deployments, StatefulSets, and Pod resource requests.
- **Cloud Profile Sync**: Persist custom hardware profiles across devices.
- **Compose Watch Integration**: Live re-analysis as you edit your compose file.
