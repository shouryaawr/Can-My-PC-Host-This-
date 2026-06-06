# Can My PC Host This?

<div align="center">
  <p><strong>Your Hardware-Aware Docker Orchestration Engine</strong></p>
  <p><em>Stop guessing if your system will crash. Know before you deploy.</em></p>
</div>

---

**Can My PC Host This?** is a fully independent, **full-stack application** built from the ground up with a custom deterministic optimization engine—**no external AI APIs, no third-party cloud dependencies**. It runs 100% locally to mathematically evaluate Docker Compose manifests against your specific host hardware. 

Before you spin up a complex stack of microservices, this tool analyzes the load and automatically injects optimal `deploy.resources` limits directly into your `docker-compose.yml` to fit your exact operational needs.

Built for developers who want to run heavy local deployments without freezing their IDEs, and for sysadmins looking to squeeze maximum efficiency from dedicated hosts.

> **Project Status**: Active Development / Hackathon Scope. This engine currently supports Docker Compose v3+ memory limits and replicas. CPU reservation limits and multi-node swarm orchestration are planned for upcoming releases.

---

## Table of Contents
- [Key Features](#key-features)
- [How It Works](#how-it-works)
- [Tech Stack](#tech-stack)
- [Quick Start & Installation](#quick-start--installation)
- [Roadmap](#roadmap)

---

## Key Features

**Deterministic Optimization Engine**
Say goodbye to Out-Of-Memory (OOM) kills. The engine calculates predicted RAM and CPU utilization for every service in your manifest and injects strict constraints (`deploy.resources.limits`) based on mathematical models of your hardware capacity.

**Hardware Auto-Detection & Manual Override**
Since browsers restrict access to exact device specifications for security, the dashboard leverages available browser APIs to fetch the closest approximation of your logical CPU cores and total system memory. For precise tuning, we provide a manual edit button so you can easily override these estimates and input your exact hardware specs or simulate a different machine.

**Tailored Operational Profiles**
Not all workloads are created equal. Choose a profile that fits your exact use-case:
- **Silent Running**: Reserves up to 30% of RAM and caps CPU. Perfect for background services while you work.
- **Background Dev**: A balanced 50% allocation specifically for local dev environments.
- **Max Performance**: Uses up to 95% of your system resources. Run this when you have a dedicated server.
- **Advanced/Custom**: Fully customize safety buffers, CPU multipliers, loop iterations, and cgroups fallbacks.

**Frictionless Monorepo GitHub Integrations**
Directly fetch and analyze manifests from public GitHub repositories using our backend parsers. No copy-pasting required. If your compose file is buried deep inside a monorepo, the engine automatically falls back to the GitHub Tree API, recursively scanning nested directories and providing a clean dropdown selection if multiple manifests are discovered.

**Bulletproof Port Conflict Engine**
The backend incorporates a pre-processing tokenization layer that intelligently neuters environment variable syntaxes (like `${PORT}:8080`) before scanning, eliminating port conflict false positives while perfectly mapping standard `host:container` layouts.

**Interactive Visualizations**
- **Node Topology**: A dynamic visual graph mapping the architecture and network dependencies of your parsed manifest.
- **Diff Viewer**: A beautifully syntax-highlighted side-by-side comparison showing exactly what limits the engine injected into your original code.
- **Rule Trace Logs**: Complete transparency. Get a step-by-step diagnostic breakdown of how the engine allocated memory, down to the megabyte.

---

## How It Works

1. **Ingestion**: Paste your raw YAML or provide a repository URL. The engine handles deep monorepo pathing automatically.
2. **Simulation**: The FastAPI backend evaluates the structural topology, resolving replicas, base hardware weights, and mathematical capacity thresholds.
3. **AST JSON Patching**: Instead of brute-force rewriting the entire file (which causes massive diff bloat and YAML anchor expansion), the backend generates a lean AST JSON Patch Array of precise coordinates containing only the calculated modifications.
4. **Dynamic Overlay**: The frontend uses the `yaml` package to overlay these exact patches dynamically onto the raw payload. This completely preserves your file's aliases, formatting, and inline comments in the syntax-highlighted Diff Viewer.

---

## Tech Stack

**Frontend Frameworks & UI**
- **React 18** + **Vite**: Lightning-fast, modular UI components.
- **Tailwind CSS**: Sleek, dark-mode-first aesthetic.
- **Lucide React**: Clean, modern iconography.

**Backend & Data Processing**
- **Python** + **FastAPI**: High-performance API endpoints.
- **ruamel.yaml**: Lossless YAML parsing and emitting.
- **psutil**: Advanced system and hardware telemetry profiling.

---

## Quick Start & Installation

### 1. Clone the Repository
```bash
git clone https://github.com/shouryaawr/Can-My-PC-Host-This-.git
cd Can-My-PC-Host-This-
```

### 2. Launching the Analysis Backend
Ensure you have Python 3.10+ installed.

```bash
cd backend
python -m venv .venv

# Activate the virtual environment
# Windows:
.venv\Scripts\activate
# macOS/Linux:
source .venv/bin/activate

# Install core dependencies
pip install -r requirements.txt

# Boot the FastAPI server
uvicorn app.main:app --reload
```
> **Backend Port**: By default, the FastAPI server runs on `http://localhost:8000`.

### 3. Launching the Frontend

Ensure you have Node.js 18+ installed. Open a new terminal window.

```bash
cd frontend
npm install
```

**Option A: Run Locally in Development**
```bash
# Start the Vite development server with hot-reloading
npm run dev
```

**Option B: Build for Production**
```bash
# Build the optimized production bundle
npm run build

# Preview the live production dashboard
npm run preview
```
> **Success!** Access the live dashboard (usually at `http://localhost:5173`) and start optimizing your architectures.

---

## Roadmap
- **Cloud Synchronization**: Persist your custom hardware profiles securely across devices.
- **Kubernetes Support**: Extend the deterministic engine to analyze K8s Deployments, StatefulSets, and Pod specifications.
- **CLI Integration**: Expose the engine as a terminal tool so you can run `cmy-host check` before `docker-compose up`.

<div align="center">
  <p><i>Made for developers who demand a smooth, crash-free system.</i></p>
</div>
