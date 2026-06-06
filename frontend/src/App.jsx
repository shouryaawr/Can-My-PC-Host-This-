import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Cpu,
  FileCode,
  FileUp,
  Gauge,
  GitCompareArrows,
  Github,
  HardDrive,
  Loader2,
  Maximize2,
  Network,
  RotateCcw,
  ScrollText,
  Server,
  ShieldAlert,
  Upload,
  X,
} from "lucide-react";

import Diagnostics from "./components/Diagnostics.jsx";
import DiffViewer from "./components/DiffViewer.jsx";
import Topology from "./components/Topology.jsx";
import TraceLog from "./components/TraceLog.jsx";



const BOILERPLATE_YAML = `version: "3.9"
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

const PROFILE_OPTIONS = [
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
      "Uses up to 95% of RAM and allows 150% CPU utilization. Squeezes maximum capacity from the hardware \u2014 run this on a dedicated host.",
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

const TAB_OPTIONS = [
  { key: "diff",        label: "Diff Viewer",   icon: GitCompareArrows },
  { key: "topology",   label: "Node Topology",  icon: Network },
  { key: "trace",      label: "Rule Trace",     icon: ScrollText },
  { key: "diagnostics",label: "Diagnostics",    icon: ShieldAlert },
];

const STATUS_CLASSES = {
  FULLY_SOLVED: "border-green-500/30 bg-green-500/10 text-green-500",
  DEGRADED_SAFE: "border-zinc-600 bg-zinc-800/60 text-zinc-300",
  UNSOLVABLE: "border-red-500/30 bg-red-500/10 text-red-500",
  INVALID_MANIFEST: "border-red-500/30 bg-red-500/10 text-red-500",
  UNSUPPORTED_ORCHESTRATOR: "border-amber-500/30 bg-amber-500/10 text-amber-400",
};

const STATUS_LABELS = {
  FULLY_SOLVED: "Optimal Allocation",
  DEGRADED_SAFE: "Degraded — Safe",
  UNSOLVABLE: "Unsolvable",
  INVALID_MANIFEST: "Invalid Manifest",
  UNSUPPORTED_ORCHESTRATOR: "Unsupported Orchestrator",
};

const DEFAULT_HARDWARE = {
  total_ram_mb: 8192,
  free_ram_mb: 6144,
  cpu_cores: 4,
  storage_type: "SSD",
};



function formatMetric(value, suffix = "MB") {
  const number = Number(value || 0);
  return `${Math.round(number).toLocaleString()} ${suffix}`;
}

function formatRamInputValue(value, unit) {
  const number = Number(value || 0);
  if (unit === "GB") {
    return Number((number / 1000).toFixed(1));
  }
  return Math.round(number);
}

function parseRamInputValue(value, unit) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(unit === "GB" ? number * 1000 : number);
}



function MetricCard({ icon: Icon, label, value, detail, tone = "text-zinc-100", track }) {
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</span>
        <Icon className="h-4 w-4 text-zinc-500" aria-hidden="true" />
      </div>
      <div className={`mt-3 text-2xl font-semibold ${tone}`}>{value}</div>
      {detail ? <p className="mt-1 text-xs text-zinc-500">{detail}</p> : null}
      {track ?? null}
    </section>
  );
}

function NumberField({ label, value, onChange, min = 0, step = 1 }) {
  return (
    <label className="block">
      <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</span>
      <input
        className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-zinc-500"
        type="number"
        min={min}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function LoadingDisplay() {
  return (
    <section className="flex min-h-[32rem] items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/50 p-8">
      <div className="text-center">
        <Loader2 className="mx-auto h-10 w-10 animate-spin text-zinc-400" aria-hidden="true" />
        <p className="mt-4 text-sm font-medium text-zinc-300">Running deterministic optimizer…</p>
      </div>
    </section>
  );
}

function HostHardwareCard({
  hardwareData,
  setHardwareData,
  hardwareSource,
  setHardwareSource,
  ramUnit,
  setRamUnit,
  onRedetectHardware,
}) {
  function updateHardwareField(field, value) {
    setHardwareSource("custom");
    setHardwareData((current) => ({ ...current, [field]: value }));
  }

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Cpu className="h-5 w-5 text-zinc-400" strokeWidth={1.5} aria-hidden="true" />
          <h2 className="text-sm font-semibold text-zinc-100">Host Hardware</h2>
          <span
            className="rounded-full bg-zinc-700 px-2 py-0.5 text-[0.68rem] font-medium text-zinc-300"
          >
            {hardwareSource === "system" ? "System" : "Custom"}
          </span>
          <div className="inline-flex rounded-md border border-zinc-700 bg-zinc-950/80 p-0.5">
            {["MB", "GB"].map((unit) => (
              <button
                key={unit}
                type="button"
                onClick={() => setRamUnit(unit)}
                className={`rounded px-1.5 py-0.5 text-[0.68rem] font-medium transition ${
                  ramUnit === unit
                    ? "bg-zinc-700 text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-200"
                }`}
              >
                {unit}
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          title="Re-detect system hardware"
          onClick={onRedetectHardware}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-zinc-700 bg-zinc-900/70 text-zinc-500 transition hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-300"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
        <NumberField
          label={`Total RAM ${ramUnit}`}
          step={ramUnit === "GB" ? 0.1 : 1}
          value={formatRamInputValue(hardwareData.total_ram_mb, ramUnit)}
          onChange={(value) =>
            updateHardwareField("total_ram_mb", parseRamInputValue(value, ramUnit))
          }
        />
        <NumberField
          label={`Free RAM ${ramUnit}`}
          step={ramUnit === "GB" ? 0.1 : 1}
          value={formatRamInputValue(hardwareData.free_ram_mb, ramUnit)}
          onChange={(value) =>
            updateHardwareField("free_ram_mb", parseRamInputValue(value, ramUnit))
          }
        />
        <NumberField
          label="CPU Cores"
          min={1}
          value={hardwareData.cpu_cores}
          onChange={(value) =>
            updateHardwareField("cpu_cores", value)
          }
        />
        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Storage
          </span>
          <select
            className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-zinc-500"
            value={hardwareData.storage_type}
            onChange={(event) => updateHardwareField("storage_type", event.target.value)}
          >
            <option value="SSD">SSD</option>
            <option value="HDD">HDD</option>
            <option value="UNKNOWN">UNKNOWN</option>
          </select>
        </label>
      </div>
    </section>
  );
}

function OperationalProfileCard({ activeProfile, setActiveProfile, customConfig, setCustomConfig }) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
      <h2 className="text-sm font-semibold text-zinc-100">Operational Profile</h2>
      <div className="mt-3 grid gap-2">
        {PROFILE_OPTIONS.map((profile) => (
          <div key={profile.key} className="group/tip relative">
            <button
              className={`w-full rounded-md border px-3 py-2 text-left text-sm transition ${
                activeProfile === profile.key
                  ? "border-zinc-400 bg-zinc-600 text-zinc-100"
                  : "border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-600"
              }`}
              type="button"
              onClick={() => setActiveProfile(profile.key)}
            >
              {profile.label}
            </button>
            {/* Tooltip */}
            <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-64 -translate-x-1/2 rounded-lg border border-zinc-700 bg-zinc-800 p-3 text-xs text-zinc-400 opacity-0 transition-opacity duration-150 group-hover/tip:opacity-100">
              {profile.description}
              {/* Downward caret */}
              <div
                className="absolute left-1/2 top-full -translate-x-1/2"
                style={{
                  width: 0,
                  height: 0,
                  borderLeft: "6px solid transparent",
                  borderRight: "6px solid transparent",
                  borderTop: "6px solid #3f3f46",
                }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Custom sliders — revealed only when custom is active */}
      {activeProfile === "custom" && (
        <div className="mt-4 space-y-4 rounded-lg border border-zinc-700 bg-zinc-800/40 p-3">
          <p className="text-[0.68rem] font-medium uppercase tracking-wide text-zinc-500">
            Custom Tuning Parameters
          </p>

          {/* RAM Safety Buffer */}
          <label className="block">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-400">RAM Safety Buffer</span>
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-xs text-zinc-300">
                {customConfig.ram_safety_buffer.toFixed(2)}
              </span>
            </div>
            <div className="relative flex items-center">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-zinc-500"
                style={{
                  width: `${((customConfig.ram_safety_buffer - 0.0) / (1.0 - 0.0)) * 100}%`,
                }}
              />
              <input
                id="custom-ram-safety-buffer"
                type="range"
                min={0.0}
                max={1.0}
                step={0.05}
                value={customConfig.ram_safety_buffer}
                onChange={(e) =>
                  setCustomConfig((c) => ({ ...c, ram_safety_buffer: Number(e.target.value) }))
                }
                className="custom-slider w-full"
              />
            </div>
            <div className="mt-0.5 flex justify-between text-[0.65rem] text-zinc-600">
              <span>0.00</span><span>1.00</span>
            </div>
          </label>

          {/* CPU Threshold Multiplier */}
          <label className="block">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-400">CPU Threshold Multiplier</span>
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-xs text-zinc-300">
                {customConfig.cpu_threshold_multiplier.toFixed(1)}×
              </span>
            </div>
            <div className="relative flex items-center">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-zinc-500"
                style={{
                  width: `${((customConfig.cpu_threshold_multiplier - 0.5) / (2.0 - 0.5)) * 100}%`,
                }}
              />
              <input
                id="custom-cpu-threshold-multiplier"
                type="range"
                min={0.5}
                max={2.0}
                step={0.1}
                value={customConfig.cpu_threshold_multiplier}
                onChange={(e) =>
                  setCustomConfig((c) => ({ ...c, cpu_threshold_multiplier: Number(e.target.value) }))
                }
                className="custom-slider w-full"
              />
            </div>
            <div className="mt-0.5 flex justify-between text-[0.65rem] text-zinc-600">
              <span>0.5×</span><span>2.0×</span>
            </div>
          </label>

          {/* Max Loop Iterations */}
          <div className="block">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-400">Max Loop Iterations</span>
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-xs text-zinc-300">
                {customConfig.max_iterations}
              </span>
            </div>
            <input
              id="custom-max-iterations"
              type="number"
              min={1}
              max={100}
              value={customConfig.max_iterations}
              onChange={(e) =>
                setCustomConfig((c) => ({
                  ...c,
                  max_iterations: Math.min(100, Math.max(1, Number(e.target.value) || 1)),
                }))
              }
              className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 outline-none transition focus:border-zinc-500"
            />
            <p className="mt-1 text-[0.65rem] leading-4 text-zinc-500">
              Higher values yield tighter optimization on complex manifests at the cost of
              processing time.
            </p>
          </div>

          {/* Allow Cgroups Fallback */}
          <div className="block">
            <label
              htmlFor="custom-allow-cgroups"
              className="flex cursor-pointer items-start gap-3"
            >
              <div className="relative mt-0.5 flex shrink-0 items-center justify-center">
                <input
                  id="custom-allow-cgroups"
                  type="checkbox"
                  checked={customConfig.allow_cgroups}
                  onChange={(e) =>
                    setCustomConfig((c) => ({ ...c, allow_cgroups: e.target.checked }))
                  }
                  className="peer sr-only"
                />
                <div className="flex h-5 w-5 items-center justify-center rounded border border-slate-600 bg-slate-800 text-transparent transition-colors peer-checked:border-purple-600 peer-checked:bg-purple-600 peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-purple-500">
                  <svg
                    aria-hidden="true"
                    className="pointer-events-none h-3.5 w-3.5"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                  >
                    <path d="M6.5 11.5 3 8l1.4-1.4 2.1 2.1 5-5L13 5l-6.5 6.5z" />
                  </svg>
                </div>
              </div>
              <div>
                <span className="text-xs font-medium text-zinc-400">Allow Cgroups Fallback</span>
                <p className="mt-0.5 text-[0.65rem] leading-4 text-zinc-500">
                  When disabled, the engine returns{" "}
                  <span className="font-mono text-zinc-300">UNSOLVABLE</span>{" "}
                  instead of applying hard kernel memory limits when soft tuning cannot fit the
                  stack.
                </p>
              </div>
            </label>
          </div>

          {/* RAM Floor Strictness */}
          <label className="block">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-400">RAM Floor Strictness</span>
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-xs text-zinc-300">
                {customConfig.floor_strictness.toFixed(2)}×
              </span>
            </div>
            <div className="relative flex items-center">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-zinc-500"
                style={{
                  width: `${((customConfig.floor_strictness - 0.5) / (1.5 - 0.5)) * 100}%`,
                }}
              />
              <input
                id="custom-floor-strictness"
                type="range"
                min={0.5}
                max={1.5}
                step={0.05}
                value={customConfig.floor_strictness}
                onChange={(e) =>
                  setCustomConfig((c) => ({ ...c, floor_strictness: Number(e.target.value) }))
                }
                className="custom-slider w-full"
              />
            </div>
            <div className="mt-0.5 flex justify-between text-[0.65rem] text-zinc-600">
              <span>0.50×</span><span>1.50×</span>
            </div>
          </label>
        </div>
      )}
    </section>
  );
}

function ConfigurationCards({
  hardwareData,
  setHardwareData,
  hardwareSource,
  setHardwareSource,
  ramUnit,
  setRamUnit,
  onRedetectHardware,
  activeProfile,
  setActiveProfile,
  customConfig,
  setCustomConfig,
}) {
  return (
    <div className="space-y-4 transition-all duration-300 ease-out">
      <HostHardwareCard
        hardwareData={hardwareData}
        setHardwareData={setHardwareData}
        hardwareSource={hardwareSource}
        setHardwareSource={setHardwareSource}
        ramUnit={ramUnit}
        setRamUnit={setRamUnit}
        onRedetectHardware={onRedetectHardware}
      />
      <OperationalProfileCard
        activeProfile={activeProfile}
        setActiveProfile={setActiveProfile}
        customConfig={customConfig}
        setCustomConfig={setCustomConfig}
      />
    </div>
  );
}



function ImportModal({ onClose, onLoad }) {
  const fileInputRef = useRef(null);

  function handleFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      onLoad(e.target.result || "", file.name);
      onClose();
    };
    reader.readAsText(file);
  }

  // Close on Escape
  useEffect(() => {
    function handleKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="relative mx-4 w-full max-w-xl rounded-2xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl">
        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-zinc-400" aria-hidden="true" />
            <h2 className="text-base font-semibold text-zinc-100">Import / Load YAML</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-100"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* File Upload */}
        <div
          className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-zinc-700 bg-zinc-950/50 px-6 py-8 transition hover:border-zinc-600 hover:bg-zinc-950"
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && fileInputRef.current?.click()}
        >
          <FileUp className="h-8 w-8 text-zinc-500" aria-hidden="true" />
          <div className="text-center">
            <p className="text-sm font-medium text-zinc-200">Click to upload a file</p>
            <p className="mt-1 text-xs text-zinc-500">
              <span className="font-mono">docker-compose.yml</span> or any YAML manifest
            </p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".yml,.yaml,.txt"
            className="hidden"
            onChange={handleFile}
          />
        </div>
      </div>
    </div>
  );
}



export default function App() {
  const [yamlString, setYamlString] = useState("");
  const [activeProfile, setActiveProfile] = useState("silent_running");
  const [hardwareData, setHardwareData] = useState({ ...DEFAULT_HARDWARE });
  const [apiResponse, setApiResponse] = useState(null);
  const [activeTab, setActiveTab] = useState("diff");
  const [isLoading, setIsLoading] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [analysisFailed, setAnalysisFailed] = useState(false);
  const [githubUrl, setGithubUrl] = useState("");
  const [fetchError, setFetchError] = useState(null);
  const [inputMode, setInputMode] = useState("github");
  const [isEditorExpanded, setIsEditorExpanded] = useState(false);
  const [hardwareSource, setHardwareSource] = useState("system");
  const [ramUnit, setRamUnit] = useState("MB");
  const [sourceFilename, setSourceFilename] = useState("docker-compose.yml");
  const [manifestPath, setManifestPath] = useState("compose.yaml");
  const [show404Input, setShow404Input] = useState(false);
  const [customConfig, setCustomConfig] = useState({
    ram_safety_buffer: 0.75,
    cpu_threshold_multiplier: 1.0,
    max_iterations: 50,
    allow_cgroups: true,
    floor_strictness: 1.0,
  });


  const loadHardware = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/hardware`);
      if (!response.ok) throw new Error(`Hardware request failed with ${response.status}`);
      const data = await response.json();
      // Ingestion interceptor: convert binary MB → decimal GB (÷1024, 1dp) → decimal MB (×1000)
      const totalGb = Number((data.total_ram_mb / 1024).toFixed(1));
      const freeGb  = Number((data.free_ram_mb  / 1024).toFixed(1));
      setHardwareData({
        ...data,
        total_ram_mb: Math.round(totalGb * 1000),
        free_ram_mb:  Math.round(freeGb  * 1000),
      });
      setHardwareSource("system");
    } catch {
      // silently fail hardware detection
    }
  }, []);

  useEffect(() => {
    loadHardware();
  }, [loadHardware]);


  const statusClass = apiResponse
    ? STATUS_CLASSES[apiResponse.status] || STATUS_CLASSES.INVALID_MANIFEST
    : "border-zinc-700 bg-zinc-900 text-zinc-300";

  const serviceCount = apiResponse?.services?.length || 0;
  const totalReplicas = useMemo(
    () =>
      apiResponse?.services?.reduce(
        (total, service) => total + Number(service.replicas || 1),
        0,
      ) || 0,
    [apiResponse],
  );


  const handleLoadYaml = useCallback((yaml) => {
    setYamlString(yaml);
    setApiResponse(null);
    setAnalysisFailed(false);
  }, []);

  const handleLoadYamlFile = useCallback((yaml, filename) => {
    setYamlString(yaml);
    setApiResponse(null);
    setAnalysisFailed(false);
    if (filename) setSourceFilename(filename);
  }, []);

  const handleLoadBoilerplate = useCallback(() => {
    handleLoadYaml(BOILERPLATE_YAML);
  }, [handleLoadYaml]);

  async function handleGithubFetch(event) {
    event.preventDefault();
    setFetchError(null);
    setShow404Input(false);
    setIsLoading(true);
    let handledError = false;

    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/fetch-manifest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo_url: githubUrl, manifest_path: manifestPath }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        const detail =
          typeof errorData.detail === "string"
            ? errorData.detail
            : "Could not fetch a Docker Compose manifest from that repository.";
        setFetchError(detail);
        if (response.status === 404) {
          setShow404Input(true);
        }
        handledError = true;
        throw new Error(detail);
      }

      const data = await response.json();
      setYamlString(data.yaml_string);
      setSourceFilename(manifestPath);
      setGithubUrl("");
      setManifestPath("compose.yaml");
      setShow404Input(false);
      setInputMode("paste");
      setApiResponse(null);
      setAnalysisFailed(false);
    } catch (error) {
      if (!handledError) {
        setFetchError(error.message || "Could not fetch a Docker Compose manifest.");
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function runAnalysis() {
    setIsLoading(true);
    setApiResponse(null);
    setAnalysisFailed(false);

    try {
      // Submission serializer: re-encode decimal-MB state → binary MB integers for the backend
      const hardwarePayload = {
        ...hardwareData,
        total_ram_mb: Math.round((hardwareData.total_ram_mb / 1000) * 1024),
        free_ram_mb:  Math.round((hardwareData.free_ram_mb  / 1000) * 1024),
      };

      const requestBody = {
        yaml_string: yamlString,
        selected_profile: activeProfile,
        host_hardware: hardwarePayload,
        ...(activeProfile === "custom"
          ? {
              custom_profile_config: {
                ram_safety_buffer: customConfig.ram_safety_buffer,
                cpu_threshold_multiplier: customConfig.cpu_threshold_multiplier,
                max_iterations: customConfig.max_iterations,
                allow_cgroups: customConfig.allow_cgroups,
                floor_strictness: customConfig.floor_strictness,
              },
            }
          : {}),
      };

      const response = await fetch(`${API_BASE_URL}/api/v1/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      const data = await response.json();
      setApiResponse(data);

      // Diff-first: always open on diff tab after successful analysis
      const failed =
        data.status === "INVALID_MANIFEST" ||
        data.status === "UNSUPPORTED_ORCHESTRATOR" ||
        !data.optimized_yaml_string;
      setAnalysisFailed(failed);
      setActiveTab(failed ? "trace" : "diff");
    } catch (error) {
      setApiResponse({
        status: "INVALID_MANIFEST",
        optimized_yaml_string: yamlString,
        metrics: {
          initial_predicted_ram_mb: 0,
          final_predicted_ram_mb: 0,
          ram_margin_mb: 0,
          cpu_saturation_pct: 0,
        },
        services: [],
        warnings: ["Backend request failed. Confirm the FastAPI server is running."],
        execution_trace: [`[STAGE 1] Network error: ${error.message}`],
      });
      setAnalysisFailed(true);
      setActiveTab("trace");
    } finally {
      setIsLoading(false);
    }
  }

  function handleDownload() {
    const content = apiResponse?.optimized_yaml_string;
    if (!content) return;
    const base = sourceFilename.replace(/\.ya?ml$/i, "");
    const exportName = `${base}.optimized.yml`;
    const blob = new Blob([content], { type: "text/yaml" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = exportName;
    anchor.click();
    URL.revokeObjectURL(url);
  }


  return (
    <>
      {showImport && (
        <ImportModal onClose={() => setShowImport(false)} onLoad={handleLoadYamlFile} />
      )}

      {isEditorExpanded && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <section className="flex h-[80vh] w-11/12 max-w-5xl flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
            <header className="flex items-center justify-between gap-3 border-b border-zinc-700 px-5 py-4">
              <div className="flex items-center gap-2">
                <FileCode className="h-5 w-5 text-zinc-400" strokeWidth={1.5} aria-hidden="true" />
                <h2 className="text-base font-semibold text-zinc-100">Full Manifest Editor</h2>
              </div>
              <button
                type="button"
                onClick={() => setIsEditorExpanded(false)}
                className="inline-flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm font-medium text-zinc-300 transition hover:border-zinc-600 hover:text-zinc-100"
              >
                <X className="h-4 w-4" aria-hidden="true" />
                Close & Save
              </button>
            </header>
            <div className="min-h-0 flex-1 p-4">
              <textarea
                className="h-full w-full resize-none overflow-auto rounded-lg border border-zinc-700 bg-zinc-950 p-4 font-mono text-xs leading-5 text-zinc-200 outline-none transition placeholder:text-zinc-600 focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500/30"
                placeholder="Paste your docker-compose.yml here..."
                spellCheck="false"
                value={yamlString}
                onChange={(event) => setYamlString(event.target.value)}
              />
            </div>
          </section>
        </div>
      )}

      <main className="app-shell-bg min-h-screen bg-zinc-950 px-4 py-6 text-zinc-100 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">


          <header className="mb-6 border-b border-zinc-800 pb-5">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl">
                Can My PC Host This?
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
                Check it before you run it.
              </p>
            </div>
          </header>


          <div className="grid gap-5 xl:grid-cols-12">


            <aside className="space-y-4 xl:col-span-4">

              {/* YAML Workspace (dominant) */}
              <section className="rounded-xl border border-zinc-700 bg-zinc-900/70 p-4">
                <div className="mb-4 flex w-full flex-row items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileCode className="h-5 w-5 text-zinc-400" strokeWidth={1.5} aria-hidden="true" />
                    <h2 className="whitespace-nowrap text-sm font-semibold text-zinc-100">Compose Manifest</h2>
                  </div>
                  <div
                    className="inline-flex rounded-lg border border-zinc-700 bg-zinc-800 p-0.5"
                    role="group"
                    aria-label="Compose manifest input mode"
                  >
                    <button
                      type="button"
                      onClick={() => setInputMode("paste")}
                      className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
                        inputMode === "paste"
                          ? "bg-zinc-600 text-zinc-100"
                          : "text-zinc-400 hover:text-zinc-100"
                      }`}
                    >
                      Manual Paste
                    </button>
                    <button
                      type="button"
                      onClick={() => setInputMode("github")}
                      className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
                        inputMode === "github"
                          ? "bg-zinc-600 text-zinc-100"
                          : "text-zinc-400 hover:text-zinc-100"
                      }`}
                    >
                      GitHub URL
                    </button>
                  </div>
                </div>

                {inputMode === "github" ? (
                  <form
                    className="rounded-lg border border-zinc-700 bg-zinc-800/70 p-3"
                    onSubmit={handleGithubFetch}
                  >
                  <label
                    htmlFor="github-url"
                    className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-zinc-500"
                  >
                    <Github className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
                    Import from GitHub
                  </label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      id="github-url"
                      className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500/20"
                      type="url"
                      placeholder="https://github.com/owner/repository"
                      value={githubUrl}
                      onChange={(event) => setGithubUrl(event.target.value)}
                      disabled={isLoading}
                    />
                    <button
                      type="submit"
                      disabled={isLoading || !githubUrl.trim()}
                      className="inline-flex items-center justify-center gap-2 rounded-md border border-zinc-600 bg-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-100 transition hover:bg-zinc-600 disabled:cursor-not-allowed disabled:border-zinc-700 disabled:bg-zinc-800 disabled:text-zinc-500"
                    >
                      {isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Github className="h-4 w-4" aria-hidden="true" />
                      )}
                      Fetch
                    </button>
                  </div>
                  {fetchError ? (
                    <p className="mt-2 text-xs leading-5 text-red-500">{fetchError}</p>
                  ) : null}
                  {show404Input ? (
                    <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                      <label
                        htmlFor="custom-manifest-path"
                        className="mb-1.5 block text-xs font-medium text-amber-400"
                      >
                        Could not find a compose file at the repository root. Please specify the
                        custom file path (e.g.,{" "}
                        <span className="font-mono text-amber-300">deployments/docker/compose.yml</span>
                        ):
                      </label>
                      <input
                        id="custom-manifest-path"
                        type="text"
                        className="w-full rounded-md border border-amber-500/40 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-amber-400 focus:ring-1 focus:ring-amber-400/20"
                        placeholder="path/to/compose.yml"
                        value={manifestPath}
                        onChange={(e) => setManifestPath(e.target.value)}
                        disabled={isLoading}
                      />
                      <button
                        type="submit"
                        disabled={isLoading || !manifestPath.trim()}
                        className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/20 px-3 py-2 text-xs font-semibold text-amber-300 transition hover:bg-amber-500/30 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isLoading ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        ) : null}
                        Retry with Custom Path
                      </button>
                    </div>
                  ) : null}
                  </form>
                ) : null}

                {inputMode === "paste" ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setShowImport(true)}
                      className="mb-3 flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-200"
                    >
                      <Upload className="h-3 w-3" aria-hidden="true" />
                      Import / Load YAML
                    </button>
                    <div className="relative block w-full">
                      <textarea
                        id="yaml-editor"
                        className="h-32 w-full resize-none overflow-auto rounded-lg border border-zinc-700 bg-zinc-800 p-3 pr-12 font-mono text-xs leading-5 text-zinc-200 outline-none transition focus:border-zinc-500"
                        placeholder="Paste the contents of your compose.yaml or docker-compose.yml file here..."
                        spellCheck="false"
                        value={yamlString}
                        onChange={(event) => setYamlString(event.target.value)}
                      />
                      <button
                        type="button"
                        aria-label="Expand editor"
                        onClick={() => setIsEditorExpanded(true)}
                        className="absolute bottom-2 right-2 z-10 inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-700 bg-zinc-900/90 text-zinc-400 shadow-sm transition hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100"
                      >
                        <Maximize2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </>
                ) : null}

                {/* Contextual helper — only on failure */}
                {analysisFailed && (
                  <p className="mt-2 text-xs text-zinc-600">
                    Invalid format?{" "}
                    <button
                      type="button"
                      onClick={handleLoadBoilerplate}
                      className="text-zinc-400 underline underline-offset-2 transition hover:text-zinc-200"
                    >
                      Load a known-good boilerplate.
                    </button>
                  </p>
                )}

                {/* Primary CTA */}
                <button
                  id="analyze-btn"
                  className="mt-4 flex w-full items-center justify-center rounded-lg bg-zinc-700 px-4 py-3 text-sm font-semibold text-zinc-100 transition hover:bg-zinc-600 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
                  type="button"
                  disabled={isLoading || !yamlString.trim()}
                  onClick={runAnalysis}
                >
                  Analyze
                </button>
              </section>

              {apiResponse ? (
                <ConfigurationCards
                  hardwareData={hardwareData}
                  setHardwareData={setHardwareData}
                  hardwareSource={hardwareSource}
                  setHardwareSource={setHardwareSource}
                  ramUnit={ramUnit}
                  setRamUnit={setRamUnit}
                  onRedetectHardware={loadHardware}
                  activeProfile={activeProfile}
                  setActiveProfile={setActiveProfile}
                  customConfig={customConfig}
                  setCustomConfig={setCustomConfig}
                />
              ) : null}
            </aside>


            <section className="space-y-4 xl:col-span-8">
              {isLoading ? <LoadingDisplay /> : null}
              {!isLoading && !apiResponse ? (
                <ConfigurationCards
                  hardwareData={hardwareData}
                  setHardwareData={setHardwareData}
                  hardwareSource={hardwareSource}
                  setHardwareSource={setHardwareSource}
                  ramUnit={ramUnit}
                  setRamUnit={setRamUnit}
                  onRedetectHardware={loadHardware}
                  activeProfile={activeProfile}
                  setActiveProfile={setActiveProfile}
                  customConfig={customConfig}
                  setCustomConfig={setCustomConfig}
                />
              ) : null}

              {!isLoading && apiResponse ? (
                <>
                  {/* Metrics row */}
                  <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
                    <MetricCard
                      icon={Activity}
                      label="Status"
                      value={STATUS_LABELS[apiResponse.status] ?? apiResponse.status}
                      detail={`${serviceCount} services / ${totalReplicas} instances`}
                      tone={statusClass.split(" ").find((item) => item.startsWith("text-"))}
                    />
                    <MetricCard
                      icon={Gauge}
                      label="Initial Footprint"
                      value={formatMetric(apiResponse.metrics.initial_predicted_ram_mb)}
                      detail="Predicted before mutation"
                    />
                    <MetricCard
                      icon={Server}
                      label="Final Footprint"
                      value={formatMetric(apiResponse.metrics.final_predicted_ram_mb)}
                      detail="Predicted after optimization"
                    />
                    {(() => {
                      // ── Inline severity engine for Post-Allocation Memory card ──
                      // Boundary expressions are character-for-character identical to
                      // computeSeverity() in Diagnostics.jsx to prevent layout divergence.
                      const ramMarginMb      = Number(apiResponse.metrics.ram_margin_mb      || 0);
                      const finalPredictedMb = Number(apiResponse.metrics.final_predicted_ram_mb || 0);
                      const freeRamMb        = Number(hardwareData.free_ram_mb || 0);

                      // Severity color derivation
                      const isAtRisk  = ramMarginMb < 64;
                      const isCaution = !isAtRisk && ramMarginMb >= 64 && ramMarginMb <= 256;
                      const toneClass = isAtRisk  ? "text-red-500"
                                      : isCaution ? "text-amber-400"
                                      :             "text-green-400";
                      const barColor  = isAtRisk  ? "bg-red-500"
                                      : isCaution ? "bg-amber-400"
                                      :             "bg-green-500";

                      // Dynamic subtext with deficit clamping
                      const stackExceeds  = finalPredictedMb >= freeRamMb;
                      const displayMargin = Math.max(0, Math.round(ramMarginMb));
                      const freeRamRound  = Math.round(freeRamMb);
                      const subtextBase   = `${displayMargin} MB of ${freeRamRound} MB free`;
                      const subtext       = stackExceeds
                        ? `${subtextBase} (stack exceeds available headroom)`
                        : subtextBase;

                      // Defensive fill-percentage with zero-guard + 100% cap
                      const fillPct = freeRamMb > 0
                        ? Math.min(100, (finalPredictedMb / freeRamMb) * 100)
                        : 0;

                      return (
                        <MetricCard
                          icon={HardDrive}
                          label="Post-Allocation Memory"
                          value={formatMetric(ramMarginMb)}
                          detail={subtext}
                          tone={toneClass}
                          track={
                            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                              <div
                                className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                                style={{ width: `${fillPct}%` }}
                                aria-hidden="true"
                              />
                            </div>
                          }
                        />
                      );
                    })()}
                  </div>


                  {/* Warnings */}
                  {apiResponse.warnings?.length ? (
                    <section className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3 text-sm text-zinc-300">
                      {apiResponse.warnings.join(" ")}
                    </section>
                  ) : null}

                  {/* Tab bar */}
                  <div className="flex flex-wrap gap-2 rounded-xl border border-zinc-800 bg-zinc-900/70 p-2">
                    {TAB_OPTIONS.map((tab) => {
                      const TabIcon = tab.icon;
                      return (
                        <button
                          key={tab.key}
                          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition ${activeTab === tab.key
                              ? "bg-zinc-600 text-zinc-100"
                              : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                            }`}
                          type="button"
                          onClick={() => setActiveTab(tab.key)}
                        >
                          <TabIcon className="h-4 w-4" aria-hidden="true" />
                          {tab.label}
                        </button>
                      );
                    })}
                  </div>

                  {/* Tab content */}
                  <section className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
                    {activeTab === "diff" ? (
                      <DiffViewer
                        originalYaml={apiResponse.baseline_yaml_string}
                        optimizedYaml={apiResponse.optimized_yaml_string}
                        onDownload={handleDownload}
                        sourceFilename={sourceFilename}
                      />
                    ) : null}
                    {activeTab === "topology" ? (
                      <div className="overflow-x-auto">
                        <Topology services={apiResponse.services} />
                      </div>
                    ) : null}
                    {activeTab === "trace" ? (
                      <TraceLog trace={apiResponse.execution_trace} activeProfile={activeProfile} />
                    ) : null}
                    {activeTab === "diagnostics" ? (
                      <Diagnostics response={apiResponse} />
                    ) : null}
                  </section>
                </>
              ) : null}
            </section>
          </div>
        </div>
      </main>
    </>
  );
}
