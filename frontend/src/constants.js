import { GitCompareArrows, Network, ScrollText, ShieldAlert } from "lucide-react";

const rawApiUrl = import.meta.env.VITE_API_URL || "";
const isLocal =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1";

export const API_BASE_URL =
  !isLocal && rawApiUrl.includes("localhost") ? "" : rawApiUrl.replace(/\/$/, "");

export const BOILERPLATE_YAML = `version: "3.9"
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
`;

export const PROFILE_OPTIONS = [
  {
    key: "silent_running",
    label: "Silent Running",
    description:
      "Reserves 30% of RAM and caps CPU at 80%. Best for running alongside other applications without impacting system responsiveness.",
  },
  {
    key: "max_performance",
    label: "Max Performance",
    description:
      "Uses up to 95% of RAM and allows 150% CPU utilization. Squeezes maximum capacity from the hardware on a dedicated host.",
  },
  {
    key: "background_dev",
    label: "Background Dev",
    description:
      "Uses up to 50% of RAM at 100% CPU. Balanced for development machines where the stack shares resources with your IDE and tools.",
  },
  {
    key: "custom",
    label: "Advanced / Custom",
    description:
      "Set your own RAM safety buffer and CPU threshold manually. Full control over the optimization boundaries.",
  },
];

export const TAB_OPTIONS = [
  { key: "diff", label: "Diff Viewer", icon: GitCompareArrows },
  { key: "topology", label: "Node Topology", icon: Network },
  { key: "trace", label: "Rule Trace", icon: ScrollText },
  { key: "diagnostics", label: "Diagnostics", icon: ShieldAlert },
];

export const STATUS_CLASSES = {
  FULLY_SOLVED: "border-green-500/30 bg-green-500/10 text-green-500",
  DEGRADED_SAFE: "border-zinc-600 bg-zinc-800/60 text-zinc-300",
  UNSOLVABLE: "border-red-500/30 bg-red-500/10 text-red-500",
  INVALID_MANIFEST: "border-red-500/30 bg-red-500/10 text-red-500",
  UNSUPPORTED_ORCHESTRATOR: "border-amber-500/30 bg-amber-500/10 text-amber-400",
};

export const STATUS_LABELS = {
  FULLY_SOLVED: "Optimal Allocation",
  DEGRADED_SAFE: "Degraded - Safe",
  UNSOLVABLE: "Unsolvable",
  INVALID_MANIFEST: "Invalid Manifest",
  UNSUPPORTED_ORCHESTRATOR: "Unsupported Orchestrator",
};

export const DEFAULT_HARDWARE = {
  total_ram_mb: 8192,
  free_ram_mb: 6144,
  cpu_cores: 4,
  storage_type: "SSD",
};

export const DEFAULT_CUSTOM_CONFIG = {
  ram_safety_buffer: 0.75,
  cpu_threshold_multiplier: 1.0,
  max_iterations: 50,
  allow_cgroups: true,
  floor_strictness: 1.0,
};

export const RAM_UNITS = ["MB", "GB"];
export const STORAGE_TYPES = ["SSD", "HDD", "UNKNOWN"];
export const DEFAULT_MANIFEST_PATH = "compose.yaml";
export const DEFAULT_SOURCE_FILENAME = "docker-compose.yml";
