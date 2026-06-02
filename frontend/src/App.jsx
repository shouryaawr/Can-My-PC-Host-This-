import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Cpu,
  DatabaseZap,
  FileCode2,
  FileUp,
  Gauge,
  GitCompareArrows,
  HardDrive,
  Loader2,
  Network,
  Play,
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
  { key: "trace", label: "Rule Trace Logs", icon: ScrollText },
];

const STATUS_CLASSES = {
  FULLY_SOLVED: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  DEGRADED_SAFE: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  UNSOLVABLE: "border-rose-400/30 bg-rose-400/10 text-rose-300",
  INVALID_MANIFEST: "border-rose-400/30 bg-rose-400/10 text-rose-300",
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
  return `${Math.round(number).toLocaleString()}${suffix}`;
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

function EmptyDisplay() {
  return (
    <section className="flex min-h-[32rem] items-center justify-center rounded-xl border border-dashed border-slate-700 bg-zinc-900/30 p-8 text-center">
      <div className="max-w-sm">
        <DatabaseZap className="mx-auto h-12 w-12 text-emerald-400/60" aria-hidden="true" />
        <h2 className="mt-5 text-xl font-semibold text-zinc-100">Workspace Ready</h2>
        <p className="mt-3 text-sm leading-6 text-zinc-500">
          Paste or import your <span className="font-mono text-zinc-400">docker-compose.yml</span>{" "}
          in the editor on the left, then click <strong className="text-zinc-300">Analyze</strong>{" "}
          to run the optimizer.
        </p>
      </div>
    </section>
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

/* ─────────────────────── Import / Load Modal ────────────────────── */

function ImportModal({ onClose, onLoad }) {
  const [pasteValue, setPasteValue] = useState("");
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

  function handlePasteConfirm() {
    if (pasteValue.trim()) {
      onLoad(pasteValue);
      onClose();
    }
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

        {/* Divider */}
        <div className="my-4 flex items-center gap-3">
          <div className="h-px flex-1 bg-slate-800" />
          <span className="text-xs text-zinc-600">or paste directly</span>
          <div className="h-px flex-1 bg-slate-800" />
        </div>

        {/* Paste Area */}
        <textarea
          className="h-48 w-full rounded-lg border border-slate-800 bg-zinc-950 p-3 font-mono text-xs leading-5 text-zinc-200 outline-none transition focus:border-emerald-400/60"
          placeholder="Paste your docker-compose YAML here…"
          spellCheck="false"
          value={pasteValue}
          onChange={(e) => setPasteValue(e.target.value)}
        />

        {/* Confirm */}
        <button
          type="button"
          onClick={handlePasteConfirm}
          disabled={!pasteValue.trim()}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-400 px-4 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
        >
          <Upload className="h-4 w-4" aria-hidden="true" />
          Load Pasted YAML
        </button>
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

  /* ── load live hardware on mount ── */
  useEffect(() => {
    let isMounted = true;

    async function loadHardware() {
      try {
        const response = await fetch("/api/v1/hardware");
        if (!response.ok) throw new Error(`Hardware request failed with ${response.status}`);
        const data = await response.json();
        if (isMounted) {
          setHardwareData({
            ...data,
            total_ram_mb: Math.round(data.total_ram_mb),
            free_ram_mb: Math.round(data.free_ram_mb),
          });
          setHardwareLoaded(true);
        }
      } catch {
        if (isMounted) setHardwareLoaded(false);
      }
    }

    loadHardware();
    return () => { isMounted = false; };
  }, []);

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

  async function runAnalysis() {
    setIsLoading(true);
    setApiResponse(null);
    setAnalysisFailed(false);

    try {
      const response = await fetch("/api/v1/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          yaml_string: yamlString,
          selected_profile: activeProfile,
          host_hardware: hardwareData,
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

      <main className="app-shell-bg min-h-screen bg-zinc-950 px-4 py-6 text-zinc-100 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">

          {/* ── Header ── */}
          <header className="mb-6 flex flex-col gap-4 border-b border-slate-800 pb-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl">
                Can My PC Self-Host This?
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
                Deterministic resource budgeting for Docker Compose stacks before they hit bare metal.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 rounded-full border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-zinc-400">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${hardwareLoaded ? "animate-pulse bg-emerald-400" : "bg-zinc-600"
                    }`}
                />
                {hardwareLoaded ? "Live psutil hardware loaded" : "Manual hardware config"}
              </div>
            </div>
          </header>

          {/* ── Two-column layout ── */}
          <div className="grid gap-5 xl:grid-cols-12">

            {/* ── LEFT PANEL ── */}
            <aside className="space-y-4 xl:col-span-4">

              {/* YAML Workspace (dominant) */}
              <section className="rounded-xl border border-slate-700 bg-zinc-900/70 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileCode2 className="h-4 w-4 text-cyan-400" aria-hidden="true" />
                    <h2 className="text-sm font-semibold text-zinc-100">Compose Manifest</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowImport(true)}
                    className="flex items-center gap-1.5 rounded-md border border-slate-700 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-400 transition hover:border-emerald-400/40 hover:text-emerald-300"
                  >
                    <Upload className="h-3 w-3" aria-hidden="true" />
                    Import / Load YAML
                  </button>
                </div>

                <textarea
                  id="yaml-editor"
                  className="h-[28rem] w-full rounded-lg border border-slate-800 bg-zinc-950 p-3 font-mono text-xs leading-5 text-zinc-200 outline-none transition focus:border-emerald-400/60"
                  placeholder={`Paste your docker-compose.yml here, or use Import / Load YAML above…`}
                  spellCheck="false"
                  value={yamlString}
                  onChange={(event) => setYamlString(event.target.value)}
                />

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
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-400 px-4 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-300 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
                  type="button"
                  disabled={isLoading || !yamlString.trim()}
                  onClick={runAnalysis}
                >
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Play className="h-4 w-4" aria-hidden="true" />
                  )}
                  {isLoading ? "Analyzing…" : "Analyze"}
                </button>
              </section>

              {/* Host Hardware */}
              <section className="rounded-xl border border-slate-800 bg-zinc-900/70 p-4">
                <div className="mb-3 flex items-center gap-2">
                  <Cpu className="h-4 w-4 text-emerald-300" aria-hidden="true" />
                  <h2 className="text-sm font-semibold text-zinc-100">Host Hardware</h2>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                  <NumberField
                    label="Total RAM MB"
                    value={hardwareData.total_ram_mb}
                    onChange={(value) =>
                      setHardwareData((current) => ({ ...current, total_ram_mb: value }))
                    }
                  />
                  <NumberField
                    label="Free RAM MB"
                    value={hardwareData.free_ram_mb}
                    onChange={(value) =>
                      setHardwareData((current) => ({ ...current, free_ram_mb: value }))
                    }
                  />
                  <NumberField
                    label="CPU Cores"
                    min={1}
                    value={hardwareData.cpu_cores}
                    onChange={(value) =>
                      setHardwareData((current) => ({ ...current, cpu_cores: value }))
                    }
                  />
                  <label className="block">
                    <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                      Storage
                    </span>
                    <select
                      className="mt-1 w-full rounded-md border border-slate-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-emerald-400/60"
                      value={hardwareData.storage_type}
                      onChange={(event) =>
                        setHardwareData((current) => ({
                          ...current,
                          storage_type: event.target.value,
                        }))
                      }
                    >
                      <option value="SSD">SSD</option>
                      <option value="HDD">HDD</option>
                      <option value="UNKNOWN">UNKNOWN</option>
                    </select>
                  </label>
                </div>
              </section>

              {/* Operational Profile */}
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
            </aside>

            {/* ── RIGHT PANEL ── */}
            <section className="space-y-4 xl:col-span-8">
              {isLoading ? <LoadingDisplay /> : null}
              {!isLoading && !apiResponse ? <EmptyDisplay /> : null}

              {!isLoading && apiResponse ? (
                <>
                  {/* Metrics row */}
                  <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
                    <MetricCard
                      icon={Activity}
                      label="Status"
                      value={apiResponse.status}
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

                  {/* Status badge */}
                  <div className={`inline-flex rounded-full border px-3 py-1 text-xs ${statusClass}`}>
                    {apiResponse.status}
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
