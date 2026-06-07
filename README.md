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
The dashboard uses available browser APIs (`navigator.hardwareConcurrency`, `navigator.deviceMemory`) to approximate your CPU core count and total system memory. For precise tuning, a manual override panel lets you input exact hardware specs or simulate a different machine with exact decimal-MB parsing fidelity. The backend also exposes a `/api/v1/hardware` endpoint that reads your actual system stats via `psutil` for server-side detection.

**Tailored Operational Profiles**
Choose a profile that matches your workload:
- **Silent Running**: 70% RAM safety buffer, 80% CPU cap. Best for background services while you work.
- **Background Dev**: 50% RAM buffer, 100% CPU cap. Balanced for development machines sharing resources with an IDE.
- **Max Performance**: 95% RAM buffer, 150% CPU cap. For dedicated hosts where the stack owns the machine.
- **Advanced / Custom**: Fully control the RAM safety buffer, CPU threshold multiplier, iteration cap, cgroup injection, and floor strictness.

**Frictionless GitHub Integration & SSRF Hardening**
Fetch and analyze manifests from any public GitHub repository directly. The fetching engine strictly parses incoming URLs using `urllib.parse.urlparse`, explicitly enforcing that the parsed hostname is exactly `github.com` to prevent SSRF vulnerabilities. If a compose file is buried in a monorepo, the engine falls back to the GitHub Tree API, recursively scans for all valid compose filenames, and surfaces a clean dropdown for selection when multiple manifests are found.

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
- **Rule Trace**: Step-by-Step diagnostic log of how the engine allocated memory and CPU, down to the megabyte per service.
- **Diagnostics**: Full metrics panel tracking exact user input metrics with dedicated, context-aware cgroup and OOM threshold validation blocks.

---

## Architecture
