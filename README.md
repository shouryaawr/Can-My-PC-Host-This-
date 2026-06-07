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

The solver calculates predicted RAM and CPU utilization for every service in a manifest. It applies algebraic projection to tune service variables before falling back to hard cgroup-style Docker resource limits when the selected profile allows them.

**Pydantic-Validated Configuration**

Host profiles, service tiers, resource floors, variable aliases, and image classification data are loaded from `backend/app/profiles.json` into a validated `ProfilesConfig` model. Unknown profile keys are rejected at load time.

**Hardware Auto-Detection & Manual Override**
<<<<<<< HEAD

The frontend estimates CPU cores and system memory through browser APIs, then lets you override total RAM, free RAM, CPU cores, and storage type manually. The backend also exposes `/api/v1/hardware`, which reads server-side system telemetry with `psutil`.
=======
The dashboard uses available browser APIs (`navigator.hardwareConcurrency`, `navigator.deviceMemory`) to approximate your CPU core count and total system memory. For precise tuning, a manual override panel lets you input exact hardware specs or simulate a different machine with exact decimal-MB parsing fidelity. The backend also exposes a `/api/v1/hardware` endpoint that reads your actual system stats via `psutil` for server-side detection.
>>>>>>> 7157b1fda614c03f569e6b2ad878c022c479ba7e

**Tailored Operational Profiles**

<<<<<<< HEAD
- **Silent Running**: 70% RAM safety buffer, 80% CPU threshold. Best for background services while you keep working.
- **Background Dev**: 50% RAM safety buffer, 100% CPU threshold. Balanced for development machines sharing resources with other tools.
- **Max Performance**: 95% RAM safety buffer, 150% CPU threshold. Best for dedicated hosts.
- **Advanced / Custom**: Custom RAM safety buffer, CPU threshold multiplier, iteration cap, cgroup injection toggle, and floor strictness.

**GitHub Manifest Fetching**

Paste a public GitHub repository URL and the app can fetch common Compose filenames directly. If the default path is not found, it can scan the repository tree and present matching manifest paths for selection.
=======
**Frictionless GitHub Integration & SSRF Hardening**
Fetch and analyze manifests from any public GitHub repository directly. The fetching engine strictly parses incoming URLs using `urllib.parse.urlparse`, explicitly enforcing that the parsed hostname is exactly `github.com` to prevent SSRF vulnerabilities. If a compose file is buried in a monorepo, the engine falls back to the GitHub Tree API, recursively scans for all valid compose filenames, and surfaces a clean dropdown for selection when multiple manifests are found.
>>>>>>> 7157b1fda614c03f569e6b2ad878c022c479ba7e

**Port Conflict Detection**

The parser handles environment-variable placeholders before checking host port bindings, reducing false positives while still catching direct host-port conflicts.

**Service Tier Classification**

Services are classified into resource tiers such as `database`, `cache`, `backend_hybrid`, `backend_low_priority`, `frontend`, and `backend`. Classification uses explicit labels, image lookup rules, port exposure, names, and service body tokens.

**`x-tuning` Extension Block**

<<<<<<< HEAD
Services can define an `x-tuning` block to override solver behavior:

- `ram_floor_mb`: sets a service-specific RAM floor
- `never_cgroup`: excludes the service from cgroup injection
- `target_variable`: overrides the solver-selected tuning variable
- `optimizable: false`: locks the service at its baseline footprint
- `hardcoded_ram_mb`: overrides calculated RAM for that service

**Diagnostics and Visual Output**

- **Diff Viewer**: Side-by-side comparison of the original and optimized manifest.
- **Node Topology**: Service graph with dependency and resource-state indicators.
- **Rule Trace**: Step-by-step engine trace for classification, projection, and safety decisions.
- **Diagnostics**: RAM margin, free RAM, cgroup activation, OOM risk, floor flags, and per-service safety state.
=======
**Interactive Visualizations**
- **Diff Viewer**: Syntax-highlighted side-by-side comparison of your original and optimized manifest.
- **Node Topology**: Dynamic visual graph of the service dependency graph and network topology.
- **Rule Trace**: Step-by-Step diagnostic log of how the engine allocated memory and CPU, down to the megabyte per service.
- **Diagnostics**: Full metrics panel tracking exact user input metrics with dedicated, context-aware cgroup and OOM threshold validation blocks.
>>>>>>> 7157b1fda614c03f569e6b2ad878c022c479ba7e

---

## Architecture

<<<<<<< HEAD
```text
backend/app/
|-- main.py
|-- engine.py
|-- parser.py
|-- solver.py
|-- patcher.py
|-- schemas.py
`-- profiles.json
=======


```

backend/app/

├── main.py

├── engine.py

├── parser.py

├── solver.py

├── patcher.py

├── schemas.py

└── profiles.json

>>>>>>> 7157b1fda614c03f569e6b2ad878c022c479ba7e
```



### Pipeline

<<<<<<< HEAD
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
=======


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

>>>>>>> 7157b1fda614c03f569e6b2ad878c022c479ba7e
build_response(result)

```



### Configuration Loading

<<<<<<< HEAD
`profiles.json` is loaded during FastAPI startup through the `lifespan` context and stored as `app.state.profiles`. `load_profiles_config()` is also cached with `@lru_cache(maxsize=1)` for direct test and engine usage.
=======


`profiles.json` is read once at application startup inside the FastAPI `lifespan` context manager and stored as `app.state.profiles` — a fully validated `ProfilesConfig` instance. All downstream pipeline functions receive this object directly. No disk reads occur during request handling.



```python

@asynccontextmanager

async def lifespan(app: FastAPI):

app.state.profiles = load_profiles_config()

yield

```



`load_profiles_config()` is additionally decorated with `@lru_cache(maxsize=1)` so that any call outside the lifespan (e.g., directly in tests) also reads the file only once.
>>>>>>> 7157b1fda614c03f569e6b2ad878c022c479ba7e



### ProfilesConfig Model

<<<<<<< HEAD
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
- `patches` with typed `PatchCoord` operations
- `metrics` with predicted RAM, RAM margin, CPU saturation, and free RAM
- `services` and `topology` with per-service analysis data
- `post_allocation_memory`
- `diagnostics` with `cgroups_active`, `oom_risk_flag`, `headroom_mb`, and `free_ram_mb`
- `warnings`, `execution_trace`, and `trace_log`
=======


```

ProfilesConfig

├── host_profiles: dict[str, HostProfileConfig]

├── tiers: dict[str, TierProfileConfig]

├── floors: dict[str, FloorProfileConfig]

└── image_lookup_table: dict[str, str]

```



All four sub-models carry `extra="forbid"` to reject stale or unknown configuration keys at load time.
>>>>>>> 7157b1fda614c03f569e6b2ad878c022c479ba7e



### Patch Application

<<<<<<< HEAD
The backend emits `PatchCoord` operations with `op`, `path`, and `value`. The frontend applies those operations to the original YAML document with the `yaml` package, then renders the result in the Diff Viewer.
=======


The backend produces a `patches: List[PatchCoord]` array of typed operations (`op: "set" | "add" | "remove"`, `path: List[str]`, `value: Any`) describing only what changed. The frontend applies these coordinates against the original YAML string using the `yaml` package's `parseDocument` + `setIn` API. This preserves all original aliases, formatting, and inline comments in the Diff Viewer.
>>>>>>> 7157b1fda614c03f569e6b2ad878c022c479ba7e



---



## How It Works

<<<<<<< HEAD
1. **Ingest**: Paste YAML, upload a manifest, or fetch one from GitHub.
2. **Validate**: The backend validates hardware, profile config, Compose structure, ports, and supported orchestrator shape.
3. **Classify**: Each service is assigned a tier that determines RAM formula, CPU model, tunable variables, and minimum floors.
4. **Solve**: The solver computes a profile-adjusted RAM and CPU budget, tunes eligible variables, and applies cgroup limits when enabled and needed.
5. **Patch**: The backend returns a minimal set of patch coordinates.
6. **Inspect**: The frontend shows the diff, topology, rule trace, metrics, and diagnostics.
=======


1. **Ingest**: Paste raw YAML or provide a GitHub repository URL. The backend handles deep monorepo path resolution automatically via the Tree API fallback.

2. **Classify**: Each service is assigned a resource tier based on its image, labels, port exposure, and name tokens. Tier assignment determines which RAM formula, CPU model, tunable variable, and floor constraints apply.

3. **Solve**: The algebraic solver projects the maximum viable value for each tier's primary variable (e.g., `max_connections` for databases, `WORKERS` for API servers, `maxmemory` for caches) that fits within the profile-adjusted RAM budget. Replica count is factored into all cost calculations.

4. **Patch**: The solver's mutations are encoded as a minimal `PatchCoord` list. The frontend overlays them client-side, producing a clean diff without touching untouched sections of the manifest.
>>>>>>> 7157b1fda614c03f569e6b2ad878c022c479ba7e



---



## Tech Stack



**Backend**

<<<<<<< HEAD
- **Python 3.11+** - runtime
- **FastAPI 0.115.12** - API framework
- **Pydantic 2.13.4** - API and configuration validation
- **ruamel.yaml 0.18.10** - YAML parsing and writing
- **psutil 6.1.1** - server-side hardware telemetry
- **uvicorn 0.34.3** - ASGI server
=======
- **Python 3.11+** — minimum required runtime

- **FastAPI 0.115** — ASGI framework with lifespan-managed startup

- **Pydantic v2** — strict schema validation for all configuration and API types

- **ruamel.yaml** — round-trip YAML parser that preserves comments and formatting

- **psutil** — system hardware telemetry for the `/api/v1/hardware` endpoint

- **uvicorn** — ASGI server
>>>>>>> 7157b1fda614c03f569e6b2ad878c022c479ba7e



**Frontend**

<<<<<<< HEAD
- **React 18** - component UI
- **Vite 5** - development server and production build
- **Tailwind CSS 3** - styling
- **Lucide React** - icons
- **yaml 2.9.0** - client-side YAML document patching
- **diff 9.0.0** - line diff generation
=======
- **React 18** + **Vite 5** — component-based UI with hot-module replacement

- **Tailwind CSS v3** — dark-mode-first styling

- **Lucide React** — icon library

- **yaml** (eemeli) — client-side YAML AST patching via `parseDocument` + `setIn`

- **diff** — line-diff computation for the Diff Viewer
>>>>>>> 7157b1fda614c03f569e6b2ad878c022c479ba7e



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

<<<<<<< HEAD
Activate the environment:
=======


If `venv` creation hangs on Windows during `ensurepip`:



```powershell

py -3 -m venv .venv --without-pip

.\.venv\Scripts\activate

python -m ensurepip --upgrade

```



**Activate:**
>>>>>>> 7157b1fda614c03f569e6b2ad878c022c479ba7e



Windows:

```powershell

.\.venv\Scripts\activate

```



macOS / Linux:

```bash

source .venv/bin/activate

```

<<<<<<< HEAD
Install dependencies and run the API:
=======


**Install and run:**
>>>>>>> 7157b1fda614c03f569e6b2ad878c022c479ba7e



```bash

pip install -r requirements.txt

uvicorn app.main:app --reload

```

<<<<<<< HEAD
The backend starts on `http://localhost:8000`. API docs are available at `http://localhost:8000/docs`.
=======


The FastAPI server starts on `http://localhost:8000`. The interactive API docs are available at `http://localhost:8000/docs`.
>>>>>>> 7157b1fda614c03f569e6b2ad878c022c479ba7e



### 3. Frontend



Requires Node.js 18+. Open a new terminal from the project root.



```bash

cd frontend

npm install

npm run dev

```

<<<<<<< HEAD
The Vite dev server starts on `http://localhost:5173` and proxies `/api` requests to `http://localhost:8000`.

Production build:
=======


The Vite dev server starts on `http://localhost:5173` and proxies all `/api` requests to the backend automatically.



**Production build:**
>>>>>>> 7157b1fda614c03f569e6b2ad878c022c479ba7e



```bash

npm run build

npm run preview

```



---



## Running Tests

<<<<<<< HEAD
The backend test suite covers parser validation, service classification, patch generation, solver math, cgroup behavior, diagnostics payloads, hardware input sanitization, and end-to-end engine integration.

Run from the `backend` directory:
=======


The test suite covers the full optimization pipeline — RAM formulas, CPU scaling, floor enforcement, cgroup injection, algebraic projection, replica multipliers, and end-to-end engine integration — with 55 assertions.
>>>>>>> 7157b1fda614c03f569e6b2ad878c022c479ba7e



```bash

cd backend
<<<<<<< HEAD
python -m pytest tests -v
```

The current backend suite contains 58 tests. It runs without a live server because integration tests call `run_optimization_engine` directly.
=======

python -m pytest tests/ -v

```



All tests run without a live server. The `engine.py` integration tests call `run_optimization_engine` directly, which uses `ensure_profiles_config` to load `profiles.json` via the cached `load_profiles_config()` function.
>>>>>>> 7157b1fda614c03f569e6b2ad878c022c479ba7e



---



## Roadmap

<<<<<<< HEAD
- **CLI Integration**: Expose the engine as a terminal tool before `docker compose up`.
- **Kubernetes Support**: Analyze Deployments, StatefulSets, and Pod resource requests.
- **Profile Persistence**: Save custom hardware and operational profiles.
- **Compose Watch Integration**: Re-analyze manifests as they change.
=======


- **CLI Integration**: Expose the engine as a terminal tool (`cmy-host check`) that runs before `docker-compose up`.

- **Kubernetes Support**: Extend the solver to analyze Deployments, StatefulSets, and Pod resource requests.

- **Cloud Profile Sync**: Persist custom hardware profiles across devices.

- **Compose Watch Integration**: Live re-analysis as you edit your compose file.
>>>>>>> 7157b1fda614c03f569e6b2ad878c022c479ba7e
