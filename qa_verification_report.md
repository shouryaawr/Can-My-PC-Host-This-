# Can-My-PC-Host-This — QA Verification Report

**Generated:** 2026-06-06T08:47:17Z  
**Duration:** 0.22s  
**Total Scenarios:** 41  
**Passed:** 41  
**Failed:** 0  
**Pass Rate:** 100.0%

> [!NOTE]
> 🎉 All scenarios passed — 100% correctness verified.

---

## Executive Summary

| # | Scenario ID | Description | Result | Status | Failures |
|---|-------------|-------------|--------|--------|----------|
| 1 | `A-01-postgres-only-silent` | Single Postgres (database tier) on a low-RAM host with… | ✅ PASS | `FULLY_SOLVED` | 0 |
| 2 | `A-02-redis-cache-tier` | Single Redis (cache tier) — verifies image lookup table | ✅ PASS | `FULLY_SOLVED` | 0 |
| 3 | `A-03-nginx-frontend-tier` | Nginx frontend — verifies image lookup table maps to… | ✅ PASS | `FULLY_SOLVED` | 0 |
| 4 | `A-04-hybrid-ports-classifier` | Service with ports but no image match → backend_hybrid… | ✅ PASS | `FULLY_SOLVED` | 0 |
| 5 | `A-05-worker-keyword-classifier` | Service named with 'worker' keyword →… | ✅ PASS | `FULLY_SOLVED` | 0 |
| 6 | `A-06-explicit-tier-compiler-label` | Service uses x-compile.tier label → explicit tier… | ✅ PASS | `FULLY_SOLVED` | 0 |
| 7 | `B-01-database-ram-formula` | Validate database RAM formula: 128 + (max_connections… | ✅ PASS | `FULLY_SOLVED` | 0 |
| 8 | `B-02-backend-hybrid-ram-formula` | Validate backend_hybrid RAM: 64 + (workers*32) +… | ✅ PASS | `FULLY_SOLVED` | 0 |
| 9 | `B-03-cache-ram-formula` | Validate cache RAM formula: 16 + maxmemory | ✅ PASS | `FULLY_SOLVED` | 0 |
| 10 | `B-04-replicas-multiply-ram` | 3 replicas of backend_hybrid → RAM multiplied by… | ✅ PASS | `FULLY_SOLVED` | 0 |
| 11 | `C-01-silent-running-profile-math` | silent_running: ram_safety_buffer=0.70,… | ✅ PASS | `FULLY_SOLVED` | 0 |
| 12 | `C-02-max-performance-profile-math` | max_performance: ram_safety_buffer=0.95,… | ✅ PASS | `FULLY_SOLVED` | 0 |
| 13 | `C-03-custom-profile-override` | Custom profile with strict buffer=0.40 forces… | ✅ PASS | `DEGRADED_SAFE` | 0 |
| 14 | `C-04-custom-no-cgroups` | Custom profile with allow_cgroups=false on an over-… | ✅ PASS | `DEGRADED_SAFE` | 0 |
| 15 | `D-01-hdd-database-25pct-cushion` | HDD host with database tier → 25% RAM cushion applied,… | ✅ PASS | `FULLY_SOLVED` | 0 |
| 16 | `D-02-hdd-max-connections-ceil` | HDD host caps max_connections at 50 for DB RAM formula | ✅ PASS | `FULLY_SOLVED` | 0 |
| 17 | `D-03-hdd-maxmemory-ceil` | HDD host caps maxmemory at 50 for cache RAM formula | ✅ PASS | `FULLY_SOLVED` | 0 |
| 18 | `D-04-hdd-no-database-warning` | HDD host with no database tier → warning emitted | ✅ PASS | `FULLY_SOLVED` | 0 |
| 19 | `E-01-workers-scaled-down-ram` | Tiny RAM budget forces WORKERS reduction via… | ✅ PASS | `FULLY_SOLVED` | 0 |
| 20 | `E-02-max-connections-scaled-down` | Tight RAM budget forces max_connections reduction in DB | ✅ PASS | `DEGRADED_SAFE` | 0 |
| 21 | `E-03-maxmemory-scaled-down` | Cache maxmemory reduced under tight RAM | ✅ PASS | `FULLY_SOLVED` | 0 |
| 22 | `E-04-multi-service-stack-full-solve` | Full LAMP-style stack (db+cache+api+nginx) on generous… | ✅ PASS | `FULLY_SOLVED` | 0 |
| 23 | `E-05-cgroups-injected-on-overflow` | Overflowing stack that can only fit via cgroup… | ✅ PASS | `DEGRADED_SAFE` | 0 |
| 24 | `F-01-invalid-free-gt-total` | free_ram_mb > total_ram_mb → INVALID_MANIFEST… | ✅ PASS | `INVALID_MANIFEST` | 0 |
| 25 | `F-02-empty-yaml` | Empty YAML string → INVALID_MANIFEST | ✅ PASS | `INVALID_MANIFEST` | 0 |
| 26 | `F-03-no-services-in-yaml` | Valid YAML but no services block → INVALID_MANIFEST | ✅ PASS | `INVALID_MANIFEST` | 0 |
| 27 | `F-04-unsolvable-floors-exceed-ram` | Minimum floors exceed host RAM → UNSOLVABLE before… | ✅ PASS | `UNSOLVABLE` | 0 |
| 28 | `F-05-port-conflict-warning` | Two services binding same host port → warning emitted | ✅ PASS | `FULLY_SOLVED` | 0 |
| 29 | `F-06-64mb-narrow-margin-degraded` | Technically fits but margin < 64 MB → DEGRADED_SAFE… | ✅ PASS | `FULLY_SOLVED` | 0 |
| 30 | `F-07-malformed-yaml` | YAML with a syntax error → INVALID_MANIFEST | ✅ PASS | `INVALID_MANIFEST` | 0 |
| 31 | `G-01-xtuning-ram-floor-override` | x-tuning.ram_floor_mb overrides tier floor for… | ✅ PASS | `FULLY_SOLVED` | 0 |
| 32 | `G-02-xtuning-never-cgroup-respected` | x-tuning.never_cgroup=true → service excluded from… | ✅ PASS | `FULLY_SOLVED` | 0 |
| 33 | `H-01-multi-replica-db` | 3 DB replicas → floor = 128*3 = 384 MB minimum | ✅ PASS | `FULLY_SOLVED` | 0 |
| 34 | `H-02-full-microservices-stack` | Full microservices stack: Postgres + Redis + Traefik +… | ✅ PASS | `FULLY_SOLVED` | 0 |
| 35 | `H-03-custom-floor-strictness` | floor_strictness=0.5 allows more aggressive downscaling | ✅ PASS | `FULLY_SOLVED` | 0 |
| 36 | `I-01-custom-high-ram-buffer` | Custom profile: ram_safety_buffer=0.99 (nearly full… | ✅ PASS | `FULLY_SOLVED` | 0 |
| 37 | `I-02-custom-low-iterations-cap` | max_iterations=1 limits optimizer to single pass | ✅ PASS | `UNSOLVABLE` | 0 |
| 38 | `I-03-ssd-trace-confirms-storage` | SSD storage: trace must include SSD profile message | ✅ PASS | `FULLY_SOLVED` | 0 |
| 39 | `I-04-unknown-storage-type` | UNKNOWN storage_type treated as non-HDD (no HDD… | ✅ PASS | `FULLY_SOLVED` | 0 |
| 40 | `I-05-minio-backend-hybrid-lookup` | Minio image → backend_hybrid tier via… | ✅ PASS | `FULLY_SOLVED` | 0 |
| 41 | `I-06-elasticsearch-database-lookup` | Elasticsearch image → database tier via… | ✅ PASS | `FULLY_SOLVED` | 0 |

---

## ✅ Passed Scenarios

<details>
<summary><code>A-01-postgres-only-silent</code> — Single Postgres (database tier) on a low-RAM host with silent_running profile</summary>

**Status:** `FULLY_SOLVED` | **Metrics:** initial=878.0 MB, final=503.0 MB, margin=213.8 MB, cpu_sat=3.91%

| Name | Tier | Replicas | Initial RAM | Final RAM | Cgroups |
|------|------|----------|-------------|-----------|---------|
| db | database | 1 | 790.2 MB | 503.0 MB | False |

</details>

<details>
<summary><code>A-02-redis-cache-tier</code> — Single Redis (cache tier) — verifies image lookup table</summary>

**Status:** `FULLY_SOLVED` | **Metrics:** initial=272.0 MB, final=272.0 MB, margin=3619.2 MB, cpu_sat=0.83%

| Name | Tier | Replicas | Initial RAM | Final RAM | Cgroups |
|------|------|----------|-------------|-----------|---------|
| cache | cache | 1 | 272.0 MB | 272.0 MB | False |

</details>

<details>
<summary><code>A-03-nginx-frontend-tier</code> — Nginx frontend — verifies image lookup table maps to frontend tier</summary>

**Status:** `FULLY_SOLVED` | **Metrics:** initial=16.0 MB, final=16.0 MB, margin=2032.0 MB, cpu_sat=1.25%

| Name | Tier | Replicas | Initial RAM | Final RAM | Cgroups |
|------|------|----------|-------------|-----------|---------|
| proxy | frontend | 1 | 16.0 MB | 16.0 MB | False |

</details>

<details>
<summary><code>A-04-hybrid-ports-classifier</code> — Service with ports but no image match → backend_hybrid tier</summary>

**Status:** `FULLY_SOLVED` | **Metrics:** initial=384.0 MB, final=384.0 MB, margin=7398.4 MB, cpu_sat=3.33%

| Name | Tier | Replicas | Initial RAM | Final RAM | Cgroups |
|------|------|----------|-------------|-----------|---------|
| api | backend_hybrid | 1 | 384.0 MB | 384.0 MB | False |

</details>

<details>
<summary><code>A-05-worker-keyword-classifier</code> — Service named with 'worker' keyword → backend_low_priority</summary>

**Status:** `FULLY_SOLVED` | **Metrics:** initial=64.0 MB, final=64.0 MB, margin=1984.0 MB, cpu_sat=2.5%

| Name | Tier | Replicas | Initial RAM | Final RAM | Cgroups |
|------|------|----------|-------------|-----------|---------|
| celery_worker | backend_low_priority | 1 | 64.0 MB | 64.0 MB | False |

</details>

<details>
<summary><code>A-06-explicit-tier-compiler-label</code> — Service uses x-compile.tier label → explicit tier override</summary>

**Status:** `FULLY_SOLVED` | **Metrics:** initial=428.0 MB, final=428.0 MB, margin=1620.0 MB, cpu_sat=1.25%

| Name | Tier | Replicas | Initial RAM | Final RAM | Cgroups |
|------|------|----------|-------------|-----------|---------|
| mydb | database | 1 | 428.0 MB | 428.0 MB | False |

</details>

<details>
<summary><code>B-01-database-ram-formula</code> — Validate database RAM formula: 128 + (max_connections * 15)</summary>

**Status:** `FULLY_SOLVED` | **Metrics:** initial=1628.0 MB, final=1628.0 MB, margin=2263.2 MB, cpu_sat=4.17%

| Name | Tier | Replicas | Initial RAM | Final RAM | Cgroups |
|------|------|----------|-------------|-----------|---------|
| pg | database | 1 | 1628.0 MB | 1628.0 MB | False |

</details>

<details>
<summary><code>B-02-backend-hybrid-ram-formula</code> — Validate backend_hybrid RAM: 64 + (workers*32) + (web_concurrency*48)</summary>

**Status:** `FULLY_SOLVED` | **Metrics:** initial=384.0 MB, final=384.0 MB, margin=7398.4 MB, cpu_sat=1.67%

| Name | Tier | Replicas | Initial RAM | Final RAM | Cgroups |
|------|------|----------|-------------|-----------|---------|
| api | backend_hybrid | 1 | 384.0 MB | 384.0 MB | False |

</details>

<details>
<summary><code>B-03-cache-ram-formula</code> — Validate cache RAM formula: 16 + maxmemory</summary>

**Status:** `FULLY_SOLVED` | **Metrics:** initial=272.0 MB, final=272.0 MB, margin=3619.2 MB, cpu_sat=0.83%

| Name | Tier | Replicas | Initial RAM | Final RAM | Cgroups |
|------|------|----------|-------------|-----------|---------|
| redis | cache | 1 | 272.0 MB | 272.0 MB | False |

</details>

<details>
<summary><code>B-04-replicas-multiply-ram</code> — 3 replicas of backend_hybrid → RAM multiplied by replica count</summary>

**Status:** `FULLY_SOLVED` | **Metrics:** initial=672.0 MB, final=672.0 MB, margin=14892.8 MB, cpu_sat=1.25%

| Name | Tier | Replicas | Initial RAM | Final RAM | Cgroups |
|------|------|----------|-------------|-----------|---------|
| api | backend_hybrid | 3 | 672.0 MB | 672.0 MB | False |

</details>

<details>
<summary><code>C-01-silent-running-profile-math</code> — silent_running: ram_safety_buffer=0.70, cpu_threshold_multiplier=0.80</summary>

**Status:** `FULLY_SOLVED` | **Metrics:** initial=224.0 MB, final=224.0 MB, margin=2643.2 MB, cpu_sat=3.12%

| Name | Tier | Replicas | Initial RAM | Final RAM | Cgroups |
|------|------|----------|-------------|-----------|---------|
| api | backend_hybrid | 1 | 224.0 MB | 224.0 MB | False |

</details>

<details>
<summary><code>C-02-max-performance-profile-math</code> — max_performance: ram_safety_buffer=0.95, cpu_threshold_multiplier=1.50</summary>

**Status:** `FULLY_SOLVED` | **Metrics:** initial=224.0 MB, final=224.0 MB, margin=3667.2 MB, cpu_sat=1.67%

| Name | Tier | Replicas | Initial RAM | Final RAM | Cgroups |
|------|------|----------|-------------|-----------|---------|
| api | backend_hybrid | 1 | 224.0 MB | 224.0 MB | False |

</details>

<details>
<summary><code>C-03-custom-profile-override</code> — Custom profile with strict buffer=0.40 forces optimization on small host</summary>

**Status:** `DEGRADED_SAFE` | **Metrics:** initial=2284.0 MB, final=775.0 MB, margin=44.2 MB, cpu_sat=7.5%

| Name | Tier | Replicas | Initial RAM | Final RAM | Cgroups |
|------|------|----------|-------------|-----------|---------|
| api | backend_hybrid | 1 | 345.6 MB | 192.0 MB | False |
| cache | cache | 1 | 244.8 MB | 80.0 MB | False |
| db | database | 1 | 1465.2 MB | 503.0 MB | False |

</details>

<details>
<summary><code>C-04-custom-no-cgroups</code> — Custom profile with allow_cgroups=false on an over-capacity host → UNSOLVABLE</summary>

**Status:** `DEGRADED_SAFE` | **Metrics:** initial=4360.0 MB, final=442.0 MB, margin=18.8 MB, cpu_sat=5.17%

| Name | Tier | Replicas | Initial RAM | Final RAM | Cgroups |
|------|------|----------|-------------|-----------|---------|
| api | backend_hybrid | 1 | 633.6 MB | 192.0 MB | False |
| cache | cache | 1 | 475.2 MB | 32.0 MB | False |
| db | database | 1 | 2815.2 MB | 218.0 MB | False |

</details>

<details>
<summary><code>D-01-hdd-database-25pct-cushion</code> — HDD host with database tier → 25% RAM cushion applied, trace must mention it</summary>

**Status:** `FULLY_SOLVED` | **Metrics:** initial=428.0 MB, final=535.0 MB, margin=7247.4 MB, cpu_sat=0.83%

| Name | Tier | Replicas | Initial RAM | Final RAM | Cgroups |
|------|------|----------|-------------|-----------|---------|
| db | database | 1 | 535.0 MB | 535.0 MB | False |

</details>

<details>
<summary><code>D-02-hdd-max-connections-ceil</code> — HDD host caps max_connections at 50 for DB RAM formula</summary>

**Status:** `FULLY_SOLVED` | **Metrics:** initial=878.0 MB, final=1097.5 MB, margin=6684.9 MB, cpu_sat=8.33%

| Name | Tier | Replicas | Initial RAM | Final RAM | Cgroups |
|------|------|----------|-------------|-----------|---------|
| db | database | 1 | 1097.5 MB | 1097.5 MB | False |

</details>

<details>
<summary><code>D-03-hdd-maxmemory-ceil</code> — HDD host caps maxmemory at 50 for cache RAM formula</summary>

**Status:** `FULLY_SOLVED` | **Metrics:** initial=66.0 MB, final=66.0 MB, margin=7716.4 MB, cpu_sat=1.67%

| Name | Tier | Replicas | Initial RAM | Final RAM | Cgroups |
|------|------|----------|-------------|-----------|---------|
| redis | cache | 1 | 66.0 MB | 66.0 MB | False |

**Warnings:**
- HDD storage detected, but no database layer is running.

</details>

<details>
<summary><code>D-04-hdd-no-database-warning</code> — HDD host with no database tier → warning emitted</summary>

**Status:** `FULLY_SOLVED` | **Metrics:** initial=224.0 MB, final=224.0 MB, margin=3667.2 MB, cpu_sat=1.67%

| Name | Tier | Replicas | Initial RAM | Final RAM | Cgroups |
|------|------|----------|-------------|-----------|---------|
| api | backend_hybrid | 1 | 224.0 MB | 224.0 MB | False |

**Warnings:**
- HDD storage detected, but no database layer is running.

</details>

<details>
<summary><code>E-01-workers-scaled-down-ram</code> — Tiny RAM budget forces WORKERS reduction via optimization loop</summary>

**Status:** `FULLY_SOLVED` | **Metrics:** initial=704.0 MB, final=633.6 MB, margin=83.2 MB, cpu_sat=25.0%

| Name | Tier | Replicas | Initial RAM | Final RAM | Cgroups |
|------|------|----------|-------------|-----------|---------|
| api | backend_hybrid | 1 | 633.6 MB | 633.6 MB | False |

</details>

<details>
<summary><code>E-02-max-connections-scaled-down</code> — Tight RAM budget forces max_connections reduction in DB</summary>

**Status:** `DEGRADED_SAFE` | **Metrics:** initial=1628.0 MB, final=503.0 MB, margin=57.0 MB, cpu_sat=3.91%

| Name | Tier | Replicas | Initial RAM | Final RAM | Cgroups |
|------|------|----------|-------------|-----------|---------|
| db | database | 1 | 1465.2 MB | 503.0 MB | False |

</details>

<details>
<summary><code>E-03-maxmemory-scaled-down</code> — Cache maxmemory reduced under tight RAM</summary>

**Status:** `FULLY_SOLVED` | **Metrics:** initial=528.0 MB, final=272.0 MB, margin=78.0 MB, cpu_sat=3.12%

| Name | Tier | Replicas | Initial RAM | Final RAM | Cgroups |
|------|------|----------|-------------|-----------|---------|
| cache | cache | 1 | 475.2 MB | 272.0 MB | False |

</details>

<details>
<summary><code>E-04-multi-service-stack-full-solve</code> — Full LAMP-style stack (db+cache+api+nginx) on generous host → FULLY_SOLVED</summary>

**Status:** `FULLY_SOLVED` | **Metrics:** initial=1550.0 MB, final=1550.0 MB, margin=14014.8 MB, cpu_sat=3.54%

| Name | Tier | Replicas | Initial RAM | Final RAM | Cgroups |
|------|------|----------|-------------|-----------|---------|
| api | backend_hybrid | 1 | 384.0 MB | 384.0 MB | False |
| cache | cache | 1 | 272.0 MB | 272.0 MB | False |
| db | database | 1 | 878.0 MB | 878.0 MB | False |
| nginx | frontend | 1 | 16.0 MB | 16.0 MB | False |

</details>

<details>
<summary><code>E-05-cgroups-injected-on-overflow</code> — Overflowing stack that can only fit via cgroup injection → DEGRADED_SAFE</summary>

**Status:** `DEGRADED_SAFE` | **Metrics:** initial=2284.0 MB, final=743.0 MB, margin=17.0 MB, cpu_sat=4.79%

| Name | Tier | Replicas | Initial RAM | Final RAM | Cgroups |
|------|------|----------|-------------|-----------|---------|
| api | backend_hybrid | 1 | 345.6 MB | 192.0 MB | False |
| cache | cache | 1 | 244.8 MB | 48.0 MB | False |
| db | database | 1 | 1465.2 MB | 503.0 MB | False |

</details>

<details>
<summary><code>F-01-invalid-free-gt-total</code> — free_ram_mb > total_ram_mb → INVALID_MANIFEST immediately</summary>

**Status:** `INVALID_MANIFEST` | **Metrics:** initial=0.0 MB, final=0.0 MB, margin=0.0 MB, cpu_sat=0.0%

</details>

<details>
<summary><code>F-02-empty-yaml</code> — Empty YAML string → INVALID_MANIFEST</summary>

**Status:** `INVALID_MANIFEST` | **Metrics:** initial=0.0 MB, final=0.0 MB, margin=0.0 MB, cpu_sat=0.0%

</details>

<details>
<summary><code>F-03-no-services-in-yaml</code> — Valid YAML but no services block → INVALID_MANIFEST</summary>

**Status:** `INVALID_MANIFEST` | **Metrics:** initial=0.0 MB, final=0.0 MB, margin=0.0 MB, cpu_sat=0.0%

</details>

<details>
<summary><code>F-04-unsolvable-floors-exceed-ram</code> — Minimum floors exceed host RAM → UNSOLVABLE before optimization</summary>

**Status:** `UNSOLVABLE` | **Metrics:** initial=0.0 MB, final=0.0 MB, margin=0.0 MB, cpu_sat=0.0%

| Name | Tier | Replicas | Initial RAM | Final RAM | Cgroups |
|------|------|----------|-------------|-----------|---------|
| db | database | 1 | 0.0 MB | 0.0 MB | False |
| db2 | database | 1 | 0.0 MB | 0.0 MB | False |

</details>

<details>
<summary><code>F-05-port-conflict-warning</code> — Two services binding same host port → warning emitted</summary>

**Status:** `FULLY_SOLVED` | **Metrics:** initial=768.0 MB, final=768.0 MB, margin=7014.4 MB, cpu_sat=3.33%

| Name | Tier | Replicas | Initial RAM | Final RAM | Cgroups |
|------|------|----------|-------------|-----------|---------|
| api1 | backend_hybrid | 1 | 384.0 MB | 384.0 MB | False |
| api2 | backend_hybrid | 1 | 384.0 MB | 384.0 MB | False |

**Warnings:**
- [Ports] Host port conflict on 0.0.0.0:8080 between services 'api1' and 'api2'.

</details>

<details>
<summary><code>F-06-64mb-narrow-margin-degraded</code> — Technically fits but margin < 64 MB → DEGRADED_SAFE status</summary>

**Status:** `FULLY_SOLVED` | **Metrics:** initial=1300.0 MB, final=722.0 MB, margin=250.8 MB, cpu_sat=1.67%

| Name | Tier | Replicas | Initial RAM | Final RAM | Cgroups |
|------|------|----------|-------------|-----------|---------|
| cache | cache | 1 | 244.8 MB | 144.0 MB | False |
| db | database | 1 | 925.2 MB | 578.0 MB | False |

</details>

<details>
<summary><code>F-07-malformed-yaml</code> — YAML with a syntax error → INVALID_MANIFEST</summary>

**Status:** `INVALID_MANIFEST` | **Metrics:** initial=0.0 MB, final=0.0 MB, margin=0.0 MB, cpu_sat=0.0%

</details>

<details>
<summary><code>G-01-xtuning-ram-floor-override</code> — x-tuning.ram_floor_mb overrides tier floor for at_floor calculation</summary>

**Status:** `FULLY_SOLVED` | **Metrics:** initial=428.0 MB, final=428.0 MB, margin=3668.0 MB, cpu_sat=1.25%

| Name | Tier | Replicas | Initial RAM | Final RAM | Cgroups |
|------|------|----------|-------------|-----------|---------|
| db | database | 1 | 428.0 MB | 428.0 MB | False |

</details>

<details>
<summary><code>G-02-xtuning-never-cgroup-respected</code> — x-tuning.never_cgroup=true → service excluded from memory cgroup limits</summary>

**Status:** `FULLY_SOLVED` | **Metrics:** initial=1262.0 MB, final=596.0 MB, margin=164.0 MB, cpu_sat=5.17%

| Name | Tier | Replicas | Initial RAM | Final RAM | Cgroups |
|------|------|----------|-------------|-----------|---------|
| api | backend_hybrid | 1 | 345.6 MB | 288.0 MB | False |
| db | database | 1 | 790.2 MB | 308.0 MB | False |

</details>

<details>
<summary><code>H-01-multi-replica-db</code> — 3 DB replicas → floor = 128*3 = 384 MB minimum</summary>

**Status:** `FULLY_SOLVED` | **Metrics:** initial=1284.0 MB, final=1284.0 MB, margin=2607.2 MB, cpu_sat=1.25%

| Name | Tier | Replicas | Initial RAM | Final RAM | Cgroups |
|------|------|----------|-------------|-----------|---------|
| db | database | 3 | 1284.0 MB | 1284.0 MB | False |

</details>

<details>
<summary><code>H-02-full-microservices-stack</code> — Full microservices stack: Postgres + Redis + Traefik + API + Worker</summary>

**Status:** `FULLY_SOLVED` | **Metrics:** initial=1614.0 MB, final=1614.0 MB, margin=21733.2 MB, cpu_sat=4.38%

| Name | Tier | Replicas | Initial RAM | Final RAM | Cgroups |
|------|------|----------|-------------|-----------|---------|
| api | backend_hybrid | 1 | 384.0 MB | 384.0 MB | False |
| cache | cache | 1 | 272.0 MB | 272.0 MB | False |
| db | database | 1 | 878.0 MB | 878.0 MB | False |
| reverse_proxy | frontend | 1 | 16.0 MB | 16.0 MB | False |
| worker | backend_low_priority | 1 | 64.0 MB | 64.0 MB | False |

</details>

<details>
<summary><code>H-03-custom-floor-strictness</code> — floor_strictness=0.5 allows more aggressive downscaling</summary>

**Status:** `FULLY_SOLVED` | **Metrics:** initial=2012.0 MB, final=1198.0 MB, margin=152.0 MB, cpu_sat=6.88%

| Name | Tier | Replicas | Initial RAM | Final RAM | Cgroups |
|------|------|----------|-------------|-----------|---------|
| api | backend_hybrid | 1 | 345.6 MB | 320.0 MB | False |
| db | database | 1 | 1465.2 MB | 878.0 MB | False |

</details>

<details>
<summary><code>I-01-custom-high-ram-buffer</code> — Custom profile: ram_safety_buffer=0.99 (nearly full utilization)</summary>

**Status:** `FULLY_SOLVED` | **Metrics:** initial=224.0 MB, final=224.0 MB, margin=3831.04 MB, cpu_sat=2.5%

| Name | Tier | Replicas | Initial RAM | Final RAM | Cgroups |
|------|------|----------|-------------|-----------|---------|
| api | backend_hybrid | 1 | 224.0 MB | 224.0 MB | False |

</details>

<details>
<summary><code>I-02-custom-low-iterations-cap</code> — max_iterations=1 limits optimizer to single pass</summary>

**Status:** `UNSOLVABLE` | **Metrics:** initial=2012.0 MB, final=450.0 MB, margin=-0.0 MB, cpu_sat=15.28%

| Name | Tier | Replicas | Initial RAM | Final RAM | Cgroups |
|------|------|----------|-------------|-----------|---------|
| api | backend_hybrid | 1 | 345.6 MB | 120.2 MB | True |
| db | database | 1 | 1465.2 MB | 329.8 MB | True |

</details>

<details>
<summary><code>I-03-ssd-trace-confirms-storage</code> — SSD storage: trace must include SSD profile message</summary>

**Status:** `FULLY_SOLVED` | **Metrics:** initial=224.0 MB, final=224.0 MB, margin=3667.2 MB, cpu_sat=1.67%

| Name | Tier | Replicas | Initial RAM | Final RAM | Cgroups |
|------|------|----------|-------------|-----------|---------|
| api | backend_hybrid | 1 | 224.0 MB | 224.0 MB | False |

</details>

<details>
<summary><code>I-04-unknown-storage-type</code> — UNKNOWN storage_type treated as non-HDD (no HDD penalties)</summary>

**Status:** `FULLY_SOLVED` | **Metrics:** initial=3128.0 MB, final=3128.0 MB, margin=4654.4 MB, cpu_sat=8.33%

| Name | Tier | Replicas | Initial RAM | Final RAM | Cgroups |
|------|------|----------|-------------|-----------|---------|
| db | database | 1 | 3128.0 MB | 3128.0 MB | False |

</details>

<details>
<summary><code>I-05-minio-backend-hybrid-lookup</code> — Minio image → backend_hybrid tier via image_lookup_table</summary>

**Status:** `FULLY_SOLVED` | **Metrics:** initial=224.0 MB, final=224.0 MB, margin=15340.8 MB, cpu_sat=0.83%

| Name | Tier | Replicas | Initial RAM | Final RAM | Cgroups |
|------|------|----------|-------------|-----------|---------|
| s3 | backend_hybrid | 1 | 224.0 MB | 224.0 MB | False |

</details>

<details>
<summary><code>I-06-elasticsearch-database-lookup</code> — Elasticsearch image → database tier via image_lookup_table</summary>

**Status:** `FULLY_SOLVED` | **Metrics:** initial=578.0 MB, final=578.0 MB, margin=14986.8 MB, cpu_sat=0.62%

| Name | Tier | Replicas | Initial RAM | Final RAM | Cgroups |
|------|------|----------|-------------|-----------|---------|
| search | database | 1 | 578.0 MB | 578.0 MB | False |

</details>

---

## Business Logic Reference

The following formulas are verified by this QA suite:

### RAM Calculation Formulas

| Tier | Formula |
|------|---------|
| `database` | `(128 + max_connections × 15) × replicas` |
| `backend_hybrid` | `(64 + WORKERS×32 + WEB_CONCURRENCY×48) × replicas` |
| `cache` | `(16 + maxmemory) × replicas` |
| `frontend` | `16 × replicas` |
| `backend` | `64 × replicas` |
| `backend_low_priority` | `64 × replicas` |

### HDD Overrides

- `max_connections` capped at **50** for RAM formula when `storage_type=HDD`
- `maxmemory` capped at **50** when `storage_type=HDD`
- Database services with base RAM > 256 MB get a **+25% cushion** on HDD hosts

### Host Profiles

| Profile | `ram_safety_buffer` | `cpu_threshold_multiplier` |
|---------|---------------------|---------------------------|
| `silent_running` | 0.70 | 0.80 |
| `max_performance` | 0.95 | 1.50 |
| `background_dev` | 0.50 | 1.00 |
| `custom` | caller-specified | caller-specified |

### Metrics Formulas

```
effective_free_ram  = free_ram_mb × ram_safety_buffer
cpu_budget          = cpu_cores × cpu_threshold_multiplier
ram_margin_mb       = effective_free_ram − final_predicted_ram_mb
cpu_saturation_pct  = (total_cpu / cpu_budget) × 100
```

### Status Decision Tree

```
if floor_total > free_ram_mb                          → UNSOLVABLE (early)
else if optimization loop + cgroups resolve gap:
    if cgroups_used and gap <= 0                      → DEGRADED_SAFE
    elif gap > 0                                       → UNSOLVABLE
    elif ram_margin < 64 MB                           → DEGRADED_SAFE
    else                                               → FULLY_SOLVED
```