export const DEMO_PRESETS = Object.freeze({
  PRESET_A_SOLVED: Object.freeze({
    name: "Standard Solved Profile (4GB Intel NUC Stack)",
    hardware: Object.freeze({
      total_ram_mb: 4096,
      free_ram_mb: 3100,
      cpu_cores: 4,
      storage_type: "SSD",
    }),
    yaml_string: `version: "3.9"
services:
  frontend:
    image: nginx:alpine
    ports:
      - "8080:80"
    depends_on:
      - backend
  backend:
    image: node:20-alpine
    ports:
      - "3000:3000"
    environment:
      WORKERS: 2
    depends_on:
      - cache
  cache:
    image: redis:7-alpine
    environment:
      maxmemory: 128
`,
  }),
  PRESET_B_DEGRADED: Object.freeze({
    name: "Hard Cgroups Safe Profile (2GB Raspberry Pi Stack)",
    hardware: Object.freeze({
      total_ram_mb: 2048,
      free_ram_mb: 1100,
      cpu_cores: 4,
      storage_type: "HDD",
    }),
    yaml_string: `version: "3.9"
services:
  db:
    image: postgres:16
    environment:
      max_connections: 120
    deploy:
      replicas: 1
  api:
    image: python:3.12
    ports:
      - "8000:8000"
    environment:
      WORKERS: 12
    depends_on:
      - db
    deploy:
      replicas: 2
`,
  }),
  PRESET_C_UNSOLVABLE: Object.freeze({
    name: "Absolute Physical Hardware Limit Failure (512MB Thin Client)",
    hardware: Object.freeze({
      total_ram_mb: 512,
      free_ram_mb: 210,
      cpu_cores: 2,
      storage_type: "HDD",
    }),
    yaml_string: `version: "3.9"
services:
  gateway:
    image: traefik:v3
    ports:
      - "80:80"
    depends_on:
      - auth
      - api
  auth:
    image: keycloak:latest
    deploy:
      replicas: 2
    depends_on:
      - auth-db
  auth-db:
    image: postgres:16
    environment:
      max_connections: 80
  api:
    image: node:20
    ports:
      - "3000:3000"
    environment:
      WORKERS: 8
    deploy:
      replicas: 3
    depends_on:
      - app-db
      - cache
      - queue
  app-db:
    image: mysql:8
    environment:
      max_connections: 120
  cache:
    image: redis:7
    environment:
      maxmemory: 256
  queue:
    image: rabbitmq:3-management
  worker:
    image: celery:latest
    deploy:
      replicas: 4
    depends_on:
      - queue
      - app-db
  metrics:
    image: prometheus:latest
    depends_on:
      - api
  dashboard:
    image: grafana:latest
    ports:
      - "3001:3000"
    depends_on:
      - metrics
`,
  }),
  PRESET_D_INVALID: Object.freeze({
    name: "Malformed Manifest Verification (Circular Dependency Error)",
    hardware: Object.freeze({
      total_ram_mb: 4096,
      free_ram_mb: 2048,
      cpu_cores: 4,
      storage_type: "SSD",
    }),
    yaml_string: `version: "3.9"
services:
  alpha:
    image: nginx:alpine
    depends_on:
      - beta
  beta:
    image: redis:7-alpine
    depends_on:
      - alpha
`,
  }),
});
