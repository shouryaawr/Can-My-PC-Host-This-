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
  Upload,
  X,
} from "lucide-react";

import DiffViewer from "./components/DiffViewer.jsx";
import Topology from "./components/Topology.jsx";
import TraceLog from "./components/TraceLog.jsx";

/* ─────────────────────────── constants ─────────────────────────── */

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
  { key: "silent_running", label: "Silent Running" },
  { key: "max_performance", label: "Max Performance" },
  { key: "background_dev", label: "Background Dev" },
];

const TAB_OPTIONS = [
  { key: "diff", label: "Diff Viewer", icon: GitCompareArrows },
  { key: "topology", label: "Node Topology", icon: Network },
  { key: "trace", label: "Rule Trace", icon: ScrollText },
];

const STATUS_CLASSES = {
  FULLY_SOLVED: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  DEGRADED_SAFE: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  UNSOLVABLE: "border-rose-400/30 bg-rose-400/10 text-rose-300",
  INVALID_MANIFEST: "border-rose-400/30 bg-rose-400/10 text-rose-300",
};

const STATUS_LABELS = {
  FULLY_SOLVED: "Optimal Allocation",
  DEGRADED_SAFE: "Degraded — Safe",
  UNSOLVABLE: "Unsolvable",
  INVALID_MANIFEST: "Invalid Manifest",
};

const DEFAULT_HARDWARE = {
  total_ram_mb: 8192,
  free_ram_mb: 6144,
  cpu_cores: 4,
  storage_type: "SSD",
};

/* ─────────────────────────── helpers ───────────────────────────── */

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

/* ─────────────────────────── small components ──────────────────── */

function MetricCard({ icon: Icon, label, value, detail, tone = "text-zinc-100" }) {
  return (
    <section className="rounded-lg border border-slate-800 bg-slate-950/70 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</span>
        <Icon className="h-4 w-4 text-zinc-500" aria-hidden="true" />
      </div>
      <div className={`mt-3 text-2xl font-semibold ${tone}`}>{value}</div>
      {detail ? <p className="mt-1 text-xs text-zinc-500">{detail}</p> : null}
    </section>
  );
}

function NumberField({ label, value, onChange, min = 0, step = 1 }) {
  return (
    <label className="block">
      <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</span>
      <input
        className="mt-1 w-full rounded-md border border-slate-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-emerald-400/60"
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
    <section className="flex min-h-[32rem] items-center justify-center rounded-xl border border-slate-800 bg-zinc-900/50 p-8">
      <div className="text-center">
        <Loader2 className="mx-auto h-10 w-10 animate-spin text-emerald-300" aria-hidden="true" />
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
    <section className="rounded-xl border border-slate-800 bg-zinc-900/70 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Cpu className="h-5 w-5 text-zinc-400" strokeWidth={1.5} aria-hidden="true" />
          <h2 className="text-sm font-semibold text-zinc-100">Host Hardware</h2>
          <span
            className={`rounded-full px-2 py-0.5 text-[0.68rem] font-medium ${
              hardwareSource === "system"
                ? "bg-emerald-400/10 text-emerald-300"
                : "bg-amber-400/10 text-amber-300"
            }`}
          >
            {hardwareSource === "system" ? "System" : "Custom"}
          </span>
          <div className="inline-flex rounded-md border border-slate-800 bg-zinc-950/80 p-0.5">
            {["MB", "GB"].map((unit) => (
              <button
                key={unit}
                type="button"
                onClick={() => setRamUnit(unit)}
                className={`rounded px-1.5 py-0.5 text-[0.68rem] font-medium transition ${
                  ramUnit === unit
                    ? "bg-slate-700 text-zinc-100"
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
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-surface-border bg-surface/70 text-zinc-500 transition hover:border-emerald-400/40 hover:bg-surface-raised hover:text-emerald-300"
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
            className="mt-1 w-full rounded-md border border-slate-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-emerald-400/60"
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

function OperationalProfileCard({ activeProfile, setActiveProfile }) {
  return (
    <section className="rounded-xl border border-slate-800 bg-zinc-900/70 p-4">
      <h2 className="text-sm font-semibold text-zinc-100">Operational Profile</h2>
      <div className="mt-3 grid gap-2">
        {PROFILE_OPTIONS.map((profile) => (
          <button
            key={profile.key}
            className={`rounded-md border px-3 py-2 text-left text-sm transition ${activeProfile === profile.key
                ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200"
                : "border-slate-800 bg-zinc-950 text-zinc-400 hover:border-slate-700"
              }`}
            type="button"
            onClick={() => setActiveProfile(profile.key)}
          >
            {profile.label}
          </button>
        ))}
      </div>
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
      <OperationalProfileCard activeProfile={activeProfile} setActiveProfile={setActiveProfile} />
    </div>
  );
}

/* ─────────────────────── Import / Load Modal ────────────────────── */

function ImportModal({ onClose, onLoad }) {
  const fileInputRef = useRef(null);

  function handleFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      onLoad(e.target.result || "");
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
      <div className="relative mx-4 w-full max-w-xl rounded-2xl border border-slate-700 bg-zinc-900 p-6 shadow-2xl">
        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-emerald-400" aria-hidden="true" />
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
          className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-slate-700 bg-zinc-950/50 px-6 py-8 transition hover:border-emerald-400/50 hover:bg-zinc-950"
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && fileInputRef.current?.click()}
        >
          <FileUp className="h-8 w-8 text-emerald-400/70" aria-hidden="true" />
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

/* ─────────────────────────── App ───────────────────────────────── */

export default function App() {
  const [yamlString, setYamlString] = useState("");
  const [activeProfile, setActiveProfile] = useState("silent_running");
  const [hardwareData, setHardwareData] = useState({ ...DEFAULT_HARDWARE });
  const [apiResponse, setApiResponse] = useState(null);
  const [activeTab, setActiveTab] = useState("diff");
  const [isLoading, setIsLoading] = useState(false);
  const [hardwareLoaded, setHardwareLoaded] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [analysisFailed, setAnalysisFailed] = useState(false);
  const [githubUrl, setGithubUrl] = useState("");
  const [fetchError, setFetchError] = useState(null);
  const [inputMode, setInputMode] = useState("github");
  const [isEditorExpanded, setIsEditorExpanded] = useState(false);
  const [hardwareSource, setHardwareSource] = useState("system");
  const [ramUnit, setRamUnit] = useState("MB");

  /* ── load live hardware on mount ── */
  const loadHardware = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/hardware");
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
      setHardwareLoaded(true);
      setHardwareSource("system");
    } catch {
      setHardwareLoaded(false);
    }
  }, []);

  useEffect(() => {
    loadHardware();
  }, [loadHardware]);

  /* ── derived ── */
  const statusClass = apiResponse
    ? STATUS_CLASSES[apiResponse.status] || STATUS_CLASSES.INVALID_MANIFEST
    : "border-slate-800 bg-slate-950 text-zinc-300";

  const serviceCount = apiResponse?.services?.length || 0;
  const totalReplicas = useMemo(
    () =>
      apiResponse?.services?.reduce(
        (total, service) => total + Number(service.replicas || 1),
        0,
      ) || 0,
    [apiResponse],
  );

  /* ── callbacks ── */
  const handleLoadYaml = useCallback((yaml) => {
    setYamlString(yaml);
    setApiResponse(null);
    setAnalysisFailed(false);
  }, []);

  const handleLoadBoilerplate = useCallback(() => {
    handleLoadYaml(BOILERPLATE_YAML);
  }, [handleLoadYaml]);

  async function handleGithubFetch(event) {
    event.preventDefault();
    setFetchError(null);
    setIsLoading(true);
    let handledError = false;

    try {
      const response = await fetch("/api/v1/fetch-manifest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo_url: githubUrl }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        const detail =
          typeof errorData.detail === "string"
            ? errorData.detail
            : "Could not fetch a Docker Compose manifest from that repository.";
        setFetchError(detail);
        handledError = true;
        throw new Error(detail);
      }

      const data = await response.json();
      setYamlString(data.yaml_string);
      setGithubUrl("");
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

      const response = await fetch("/api/v1/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          yaml_string: yamlString,
          selected_profile: activeProfile,
          host_hardware: hardwarePayload,
        }),
      });
      const data = await response.json();
      setApiResponse(data);

      // Diff-first: always open on diff tab after successful analysis
      const failed =
        data.status === "INVALID_MANIFEST" ||
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

  /* ── render ── */
  return (
    <>
      {showImport && (
        <ImportModal onClose={() => setShowImport(false)} onLoad={handleLoadYaml} />
      )}

      {isEditorExpanded && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <section className="flex h-[80vh] w-11/12 max-w-5xl flex-col overflow-hidden rounded-xl border border-surface-border bg-surface shadow-2xl">
            <header className="flex items-center justify-between gap-3 border-b border-surface-border px-5 py-4">
              <div className="flex items-center gap-2">
                <FileCode className="h-5 w-5 text-zinc-400" strokeWidth={1.5} aria-hidden="true" />
                <h2 className="text-base font-semibold text-zinc-100">Full Manifest Editor</h2>
              </div>
              <button
                type="button"
                onClick={() => setIsEditorExpanded(false)}
                className="inline-flex items-center gap-2 rounded-md border border-surface-border bg-surface-raised px-3 py-2 text-sm font-medium text-zinc-300 transition hover:border-accent/50 hover:text-zinc-100"
              >
                <X className="h-4 w-4" aria-hidden="true" />
                Close & Save
              </button>
            </header>
            <div className="min-h-0 flex-1 p-4">
              <textarea
                className="h-full w-full resize-none overflow-auto rounded-lg border border-surface-border bg-zinc-950 p-4 font-mono text-xs leading-5 text-zinc-200 outline-none transition placeholder:text-zinc-600 focus:border-accent focus:ring-1 focus:ring-accent/30"
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

          {/* ── Header ── */}
          <header className="mb-6 border-b border-slate-800 pb-5">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl">
                Can My PC Host This?
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
                Check it before you run it.
              </p>
            </div>
          </header>

          {/* ── Two-column layout ── */}
          <div className="grid gap-5 xl:grid-cols-12">

            {/* ── LEFT PANEL ── */}
            <aside className="space-y-4 xl:col-span-4">

              {/* YAML Workspace (dominant) */}
              <section className="rounded-xl border border-slate-700 bg-zinc-900/70 p-4">
                <div className="mb-4 flex w-full flex-row items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileCode className="h-5 w-5 text-zinc-400" strokeWidth={1.5} aria-hidden="true" />
                    <h2 className="whitespace-nowrap text-sm font-semibold text-zinc-100">Compose Manifest</h2>
                  </div>
                  <div
                    className="inline-flex rounded-lg border border-surface-border bg-surface p-0.5"
                    role="group"
                    aria-label="Compose manifest input mode"
                  >
                    <button
                      type="button"
                      onClick={() => setInputMode("paste")}
                      className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
                        inputMode === "paste"
                          ? "bg-accent text-zinc-950"
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
                          ? "bg-accent text-zinc-950"
                          : "text-zinc-400 hover:text-zinc-100"
                      }`}
                    >
                      GitHub URL
                    </button>
                  </div>
                </div>

                {inputMode === "github" ? (
                  <form
                    className="rounded-lg border border-surface-border bg-surface/70 p-3"
                    onSubmit={handleGithubFetch}
                  >
                  <label
                    htmlFor="github-url"
                    className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-zinc-500"
                  >
                    <Github className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                    Import from GitHub
                  </label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      id="github-url"
                      className="min-w-0 flex-1 rounded-md border border-surface-border bg-surface px-3 py-2 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-accent focus:ring-1 focus:ring-accent/30"
                      type="url"
                      placeholder="https://github.com/owner/repository"
                      value={githubUrl}
                      onChange={(event) => setGithubUrl(event.target.value)}
                      disabled={isLoading}
                    />
                    <button
                      type="submit"
                      disabled={isLoading || !githubUrl.trim()}
                      className="inline-flex items-center justify-center gap-2 rounded-md border border-accent/40 bg-accent px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:border-surface-border disabled:bg-surface-raised disabled:text-zinc-500"
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
                    <p className="mt-2 text-xs leading-5 text-rose-300">{fetchError}</p>
                  ) : null}
                  </form>
                ) : null}

                {inputMode === "paste" ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setShowImport(true)}
                      className="mb-3 flex items-center gap-1.5 rounded-md border border-slate-700 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-400 transition hover:border-emerald-400/40 hover:text-emerald-300"
                    >
                      <Upload className="h-3 w-3" aria-hidden="true" />
                      Import / Load YAML
                    </button>
                    <div className="relative block w-full">
                      <textarea
                        id="yaml-editor"
                        className="h-32 w-full resize-none overflow-auto rounded-lg border border-slate-800 bg-zinc-950 p-3 pr-12 font-mono text-xs leading-5 text-zinc-200 outline-none transition focus:border-emerald-400/60"
                        placeholder="Paste the contents of your compose.yaml or docker-compose.yml file here..."
                        spellCheck="false"
                        value={yamlString}
                        onChange={(event) => setYamlString(event.target.value)}
                      />
                      <button
                        type="button"
                        aria-label="Expand editor"
                        onClick={() => setIsEditorExpanded(true)}
                        className="absolute bottom-2 right-2 z-10 inline-flex h-8 w-8 items-center justify-center rounded-md border border-surface-border bg-surface/90 text-zinc-400 shadow-sm transition hover:border-accent/50 hover:bg-surface-raised hover:text-zinc-100"
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
                      className="text-amber-400 underline underline-offset-2 transition hover:text-amber-300"
                    >
                      Load a known-good boilerplate.
                    </button>
                  </p>
                )}

                {/* Primary CTA */}
                <button
                  id="analyze-btn"
                  className="mt-4 flex w-full items-center justify-center rounded-lg bg-emerald-400 px-4 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-300 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
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
                />
              ) : null}
            </aside>

            {/* ── RIGHT PANEL ── */}
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
                      tone="text-emerald-300"
                    />
                    <MetricCard
                      icon={HardDrive}
                      label="RAM Margin"
                      value={formatMetric(apiResponse.metrics.ram_margin_mb)}
                      detail={`${Math.round(apiResponse.metrics.cpu_saturation_pct || 0)}% CPU saturation`}
                      tone={
                        Number(apiResponse.metrics.ram_margin_mb || 0) >= 0
                          ? "text-emerald-300"
                          : "text-rose-300"
                      }
                    />
                  </div>


                  {/* Warnings */}
                  {apiResponse.warnings?.length ? (
                    <section className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-200">
                      {apiResponse.warnings.join(" ")}
                    </section>
                  ) : null}

                  {/* Tab bar */}
                  <div className="flex flex-wrap gap-2 rounded-xl border border-slate-800 bg-zinc-900/70 p-2">
                    {TAB_OPTIONS.map((tab) => {
                      const TabIcon = tab.icon;
                      return (
                        <button
                          key={tab.key}
                          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition ${activeTab === tab.key
                              ? "bg-emerald-400 text-zinc-950"
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
                  <section className="rounded-xl border border-slate-800 bg-zinc-900/70 p-4">
                    {activeTab === "diff" ? (
                      <DiffViewer
                        originalYaml={yamlString}
                        optimizedYaml={apiResponse.optimized_yaml_string}
                      />
                    ) : null}
                    {activeTab === "topology" ? (
                      <div className="overflow-x-auto">
                        <Topology services={apiResponse.services} />
                      </div>
                    ) : null}
                    {activeTab === "trace" ? (
                      <TraceLog trace={apiResponse.execution_trace} />
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
