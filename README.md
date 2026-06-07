# Can My PC Host This?

**Your hardware-aware Docker Compose optimization engine**

*Stop guessing if your system will crash. Know before you deploy.*

---

**Can My PC Host This?** is a self-contained full-stack application with a deterministic optimization engine. It runs locally, evaluates Docker Compose manifests against your host hardware, and emits a minimal patch set for resource limits and tunable service variables.

Before you run a heavy local stack, the app estimates RAM and CPU pressure, applies the selected operating profile, projects viable service settings, and shows the resulting manifest changes in an interactive dashboard.

Built for developers running local services beside an IDE, and for operators testing how much capacity a single machine can safely host.

> **Project Status**: Active development. The engine currently supports Docker Compose v3+ service analysis, replica-aware RAM and CPU budgeting, tier-based tuning, and Docker resource limits. Kubernetes and multi-node orchestration are planned.

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

The solver calculates predicted RAM and CPU utilization for every service in a manifest. It tunes service variables before falling back to hard Docker resource limits when the selected profile allows cgroup injection.

**Pydantic-Validated Configuration**

Host profiles, service tiers, resource floors, variable aliases, and image classification data are loaded from `backend/app/profiles.json` into a validated `ProfilesConfig` model. Unknown profile keys are rejected at load time.

**Hardware Auto-Detection & Manual Override**

The dashboard uses browser APIs such as `navigator.hardwareConcurrency` and `navigator.deviceMemory` to estimate CPU cores and system memory. You can override total RAM, free RAM, CPU cores, and storage type manually with decimal-MB input preserved through the frontend and backend payload.

The backend also exposes `/api/v1/hardware`, which reads server-side system telemetry with `psutil`.

**Tailored Operational Profiles**

- **Silent Running**: 70% RAM safety buffer, 80% CPU threshold. Best for background services while you keep working.
- **Background Dev**: 50% RAM safety buffer, 100% CPU threshold. Balanced for development machines sharing resources with other tools.
- **Max Performance**: 95% RAM safety buffer, 150% CPU threshold. Best for dedicated hosts.
- **Advanced / Custom**: Custom RAM safety buffer, CPU threshold multiplier, iteration cap, cgroup injection toggle, and floor strictness.

**GitHub Manifest Fetching**

Paste a public GitHub repository URL and the app can fetch common Compose filenames directly. The backend accepts GitHub repository URLs that match its strict `github.com/owner/repo` pattern. If the default path is not found, it can scan the repository tree and present matching manifest paths for selection.

**Port Conflict Detection**

The parser handles environment-variable placeholders before checking host port bindings, reducing false positives while still catching direct host-port conflicts.

**Service Tier Classification**

Services are classified into resource tiers such as `database`, `cache`, `backend_hybrid`, `backend_low_priority`, `frontend`, and `backend`. Classification uses explicit `compiler.tier` labels, image lookup rules, port exposure, service names, and service body tokens.

**`x-tuning` Extension Block**

Services can define an `x-tuning` block to override solver behavior:

- `ram_floor_mb`: sets a service-specific RAM floor
- `never_cgroup`: excludes the service from memory cgroup limits
- `target_variable`: overrides the solver-selected tuning variable
- `optimizable`: locks or unlocks service optimization when set to `false` or `true`

The parser also detects hardcoded memory flags in `command` or `entrypoint` and treats those services as fixed-memory workloads.

**Diagnostics and Visual Output**

- **Diff Viewer**: Side-by-side comparison of the original and optimized manifest.
- **Node Topology**: Service graph with dependency and resource-state indicators.
- **Rule Trace**: Step-by-step engine trace for classification, optimization, and safety decisions.
- **Diagnostics**: RAM margin, free RAM, cgroup activation, OOM risk, floor flags, and per-service safety state.

---

## Architecture

```text
backend/app/
|-- main.py

|-- parser.py
|-- solver.py
|-- patcher.py
|-- schemas.py
`-- profiles.json
```

### Pipeline

```text
POST /api/v1/analyze
        |
        v
parse_analysis_payload(payload, profiles)
        |
        v
solve_analysis(parsed)
        |
        v
build_response(result)
```

### Configuration Loading

`profiles.json` is loaded during FastAPI startup through the `lifespan` context and stored as `app.state.profiles`. `load_profiles_config()` is also cached with `@lru_cache(maxsize=1)` for direct test and engine usage.

### ProfilesConfig Model

```text
ProfilesConfig
|-- host_profiles: dict[str, HostProfileConfig]
|-- tiers: dict[str, TierProfileConfig]
|-- floors: dict[str, FloorProfileConfig]
`-- image_lookup_table: dict[str, str]
```

The profile, tier, and floor models use `extra="forbid"` so stale or misspelled configuration keys fail validation.

### API Response Shape

The analyzer returns:

- `optimized_yaml_string` and `baseline_yaml_string`

- `metrics` with predicted RAM, RAM margin, CPU saturation, and free RAM
- `services` and `topology` with per-service analysis data
- `post_allocation_memory`
- `diagnostics` with `cgroups_active`, `oom_risk_flag`, `headroom_mb`, and `free_ram_mb`
- `warnings`, `execution_trace`, and `trace_log`



---

## How It Works

1. **Ingest**: Paste YAML, upload a manifest, or fetch one from GitHub.
2. **Validate**: The backend validates hardware, profile config, Compose structure, ports, and supported orchestrator shape.
3. **Classify**: Each service is assigned a tier that determines RAM formula, CPU model, tunable variables, and minimum floors.
4. **Solve**: The solver computes a profile-adjusted RAM and CPU budget, tunes eligible variables, and applies cgroup limits when enabled and needed.
5. **Format**: The backend returns the optimized YAML string and analysis metrics.
6. **Inspect**: The frontend shows the diff, topology, rule trace, metrics, and diagnostics.

---

## Tech Stack

**Backend**

- **Python 3.11+** - runtime
- **FastAPI 0.115.12** - API framework
- **Pydantic 2.13.4** - API and configuration validation
- **ruamel.yaml 0.18.10** - YAML parsing and writing
- **psutil 6.1.1** - server-side hardware telemetry
- **uvicorn 0.34.3** - ASGI server

**Frontend**

- **React 18** - component UI
- **Vite 5** - development server and production build
- **Tailwind CSS 3** - styling
- **Lucide React** - icons

- **diff 9.0.0** - line diff generation

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

Activate the environment:

Windows:

```powershell
.\.venv\Scripts\activate
```

macOS / Linux:

```bash
source .venv/bin/activate
```

Install dependencies and run the API:

```bash
pip install -r requirements.txt
uvicorn app.main:app --reload
```

The backend starts on `http://localhost:8000`. API docs are available at `http://localhost:8000/docs`.

### 3. Frontend

Requires Node.js 18+. Open a new terminal from the project root.

```bash
cd frontend
npm install
npm run dev
```

The Vite dev server starts on `http://localhost:5173` and proxies `/api` requests to `http://localhost:8000`.

Production build:

```bash
npm run build
npm run preview
```

---

## Running Tests

The backend test suite covers parser validation, service classification, patch generation, solver math, cgroup behavior, diagnostics payloads, hardware input sanitization, and end-to-end engine integration.

Run from the `backend` directory:

```bash
cd backend
python -m pytest tests -v
```

The current backend suite contains 57 tests (see [backend/tests](backend/tests)). It runs without a live server because integration tests call `run_optimization_engine` directly.

---

## Roadmap

- **CLI Integration**: Expose the engine as a terminal tool before `docker compose up`.
- **Kubernetes Support**: Analyze Deployments, StatefulSets, and Pod resource requests.
- **Profile Persistence**: Save custom hardware and operational profiles.
- **Compose Watch Integration**: Re-analyze manifests as they change.
