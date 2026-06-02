import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Cpu,
  DatabaseZap,
  FileCode2,
  Gauge,
  HardDrive,
  Loader2,
  Network,
  Play,
  ScrollText,
  Server,
} from "lucide-react";

import DiffViewer from "./components/DiffViewer.jsx";
import Topology from "./components/Topology.jsx";
import TraceLog from "./components/TraceLog.jsx";
import { DEMO_PRESETS } from "./presets.js";

const DEFAULT_PRESET_KEY = "PRESET_A_SOLVED";
const DEFAULT_HARDWARE = DEMO_PRESETS[DEFAULT_PRESET_KEY].hardware;

const PROFILE_OPTIONS = [
  { key: "silent_running", label: "Silent Running" },
  { key: "max_performance", label: "Max Performance" },
  { key: "background_dev", label: "Background Dev" },
];

const TAB_OPTIONS = [
  { key: "topology", label: "Topological Node Mapping", icon: Network },
  { key: "diff", label: "Lossless Diff Viewer", icon: FileCode2 },
  { key: "trace", label: "Rule Trace Logs Engine", icon: ScrollText },
];

const STATUS_CLASSES = {
  FULLY_SOLVED: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  DEGRADED_SAFE: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  UNSOLVABLE: "border-rose-400/30 bg-rose-400/10 text-rose-300",
  INVALID_MANIFEST: "border-rose-400/30 bg-rose-400/10 text-rose-300",
};

function formatMetric(value, suffix = "MB") {
  const number = Number(value || 0);
  return `${Math.round(number).toLocaleString()}${suffix}`;
}

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
    <section className="flex min-h-[28rem] items-center justify-center rounded-xl border border-dashed border-slate-800 bg-zinc-900/40 p-8 text-center">
      <div className="max-w-sm">
        <DatabaseZap className="mx-auto h-10 w-10 text-emerald-300" aria-hidden="true" />
        <h2 className="mt-4 text-lg font-semibold text-zinc-100">Analyzer Standing By</h2>
        <p className="mt-2 text-sm leading-6 text-zinc-500">
          Select a preset or edit the manifest, then run the analyzer to render topology,
          optimized YAML, and rule traces.
        </p>
      </div>
    </section>
  );
}

function LoadingDisplay() {
  return (
    <section className="flex min-h-[28rem] items-center justify-center rounded-xl border border-slate-800 bg-zinc-900/50 p-8">
      <div className="text-center">
        <Loader2 className="mx-auto h-10 w-10 animate-spin text-emerald-300" aria-hidden="true" />
        <p className="mt-4 text-sm font-medium text-zinc-300">Running deterministic optimizer...</p>
      </div>
    </section>
  );
}

export default function App() {
  const [selectedPresetKey, setSelectedPresetKey] = useState(DEFAULT_PRESET_KEY);
  const [yamlString, setYamlString] = useState(DEMO_PRESETS[DEFAULT_PRESET_KEY].yaml_string);
  const [activeProfile, setActiveProfile] = useState("silent_running");
  const [hardwareData, setHardwareData] = useState({ ...DEFAULT_HARDWARE });
  const [apiResponse, setApiResponse] = useState(null);
  const [activeTab, setActiveTab] = useState("topology");
  const [isLoading, setIsLoading] = useState(false);
  const [hardwareLoaded, setHardwareLoaded] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function loadHardware() {
      try {
        const response = await fetch("/api/v1/hardware");
        if (!response.ok) {
          throw new Error(`Hardware request failed with ${response.status}`);
        }
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
        if (isMounted) {
          setHardwareLoaded(false);
        }
      }
    }

    loadHardware();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const preset = DEMO_PRESETS[selectedPresetKey];
    if (!preset) {
      return;
    }

    setYamlString(preset.yaml_string);
    setHardwareData({ ...preset.hardware });
    setApiResponse(null);
    setActiveTab("topology");
  }, [selectedPresetKey]);

  const selectedPreset = DEMO_PRESETS[selectedPresetKey];
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

  async function runAnalysis() {
    setIsLoading(true);
    setApiResponse(null);

    try {
      const response = await fetch("/api/v1/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          yaml_string: yamlString,
          selected_profile: activeProfile,
          host_hardware: hardwareData,
        }),
      });
      const data = await response.json();
      setApiResponse(data);
      setActiveTab("topology");
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
      setActiveTab("trace");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="app-shell-bg min-h-screen bg-zinc-950 px-4 py-6 text-zinc-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex flex-col gap-4 border-b border-slate-800 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl">
              Can My PC Self-Host This?
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
              Deterministic resource budgeting for Docker Compose stacks before they hit bare metal.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-zinc-400">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                hardwareLoaded ? "animate-pulse bg-emerald-400" : "bg-zinc-600"
              }`}
            />
            {hardwareLoaded ? "Live psutil hardware loaded" : "Preset hardware simulation"}
          </div>
        </header>

        <div className="grid gap-5 xl:grid-cols-12">
          <aside className="space-y-4 xl:col-span-4">
            <section className="rounded-xl border border-slate-800 bg-zinc-900/70 p-4">
              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Demo Scenario
                </span>
                <select
                  className="mt-1 w-full rounded-md border border-slate-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-emerald-400/60"
                  value={selectedPresetKey}
                  onChange={(event) => setSelectedPresetKey(event.target.value)}
                >
                  {Object.entries(DEMO_PRESETS).map(([key, preset]) => (
                    <option key={key} value={key}>
                      {preset.name}
                    </option>
                  ))}
                </select>
              </label>
            </section>

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

            <section className="rounded-xl border border-slate-800 bg-zinc-900/70 p-4">
              <h2 className="text-sm font-semibold text-zinc-100">Operational Profile</h2>
              <div className="mt-3 grid gap-2">
                {PROFILE_OPTIONS.map((profile) => (
                  <button
                    key={profile.key}
                    className={`rounded-md border px-3 py-2 text-left text-sm transition ${
                      activeProfile === profile.key
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

            <section className="rounded-xl border border-slate-800 bg-zinc-900/70 p-4">
              <div className="mb-3 flex items-center gap-2">
                <FileCode2 className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                <h2 className="text-sm font-semibold text-zinc-100">Compose Manifest</h2>
              </div>
              <textarea
                className="h-80 w-full rounded-lg border border-slate-800 bg-zinc-950 p-3 font-mono text-xs leading-5 text-zinc-200 outline-none transition focus:border-emerald-400/60"
                spellCheck="false"
                value={yamlString}
                onChange={(event) => setYamlString(event.target.value)}
              />
              <button
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-400 px-4 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
                type="button"
                disabled={isLoading}
                onClick={runAnalysis}
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Play className="h-4 w-4" aria-hidden="true" />
                )}
                Run Analyzer
              </button>
            </section>
          </aside>

          <section className="space-y-4 xl:col-span-8">
            {isLoading ? <LoadingDisplay /> : null}
            {!isLoading && !apiResponse ? <EmptyDisplay /> : null}

            {!isLoading && apiResponse ? (
              <>
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

                <div className={`inline-flex rounded-full border px-3 py-1 text-xs ${statusClass}`}>
                  {apiResponse.status}
                </div>

                {apiResponse.warnings?.length ? (
                  <section className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-200">
                    {apiResponse.warnings.join(" ")}
                  </section>
                ) : null}

                <div className="flex flex-wrap gap-2 rounded-xl border border-slate-800 bg-zinc-900/70 p-2">
                  {TAB_OPTIONS.map((tab) => {
                    const TabIcon = tab.icon;
                    return (
                      <button
                        key={tab.key}
                        className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition ${
                          activeTab === tab.key
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

                <section className="rounded-xl border border-slate-800 bg-zinc-900/70 p-4">
                  {activeTab === "topology" ? (
                    <div className="overflow-x-auto">
                      <Topology services={apiResponse.services} />
                    </div>
                  ) : null}
                  {activeTab === "diff" ? (
                    <DiffViewer
                      originalYaml={yamlString}
                      optimizedYaml={apiResponse.optimized_yaml_string}
                    />
                  ) : null}
                  {activeTab === "trace" ? <TraceLog trace={apiResponse.execution_trace} /> : null}
                </section>
              </>
            ) : null}
          </section>
        </div>
      </div>
    </main>
  );
}
