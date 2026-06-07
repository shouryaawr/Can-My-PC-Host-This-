import { useCallback, useMemo, useState } from "react";
import { FileCode, X } from "lucide-react";
import ConfigurationCards from "./components/ConfigurationCards.jsx";
import ImportModal from "./components/ImportModal.jsx";
import LoadingDisplay from "./components/LoadingDisplay.jsx";
import ManifestInputPanel from "./components/ManifestInputPanel.jsx";
import ResultsMetricBar from "./components/ResultsMetricBar.jsx";
import ResultsTabPanel from "./components/ResultsTabPanel.jsx";
import {
  BOILERPLATE_YAML,
  DEFAULT_CUSTOM_CONFIG,
  DEFAULT_SOURCE_FILENAME,
  STATUS_CLASSES,
} from "./constants.js";
import { useHardwareProfile } from "./hooks/useHardwareProfile.js";
import { useManifestAnalyzer } from "./hooks/useManifestAnalyzer.js";
import { getOptimizedFilename, getStatusTone } from "./utils.js";

export default function App() {
  const [yamlString, setYamlString] = useState("");
  const [activeProfile, setActiveProfile] = useState("silent_running");
  const [activeTab, setActiveTab] = useState("diff");
  const [showImport, setShowImport] = useState(false);
  const [inputMode, setInputMode] = useState("github");
  const [isEditorExpanded, setIsEditorExpanded] = useState(false);
  const [sourceFilename, setSourceFilename] = useState(DEFAULT_SOURCE_FILENAME);
  const [customConfig, setCustomConfig] = useState({ ...DEFAULT_CUSTOM_CONFIG });

  const {
    hardwareData,
    hardwareSource,
    ramUnit,
    setRamUnit,
    loadHardware,
    updateField,
  } = useHardwareProfile();

  const {
    apiResponse,
    isLoading,
    analysisFailed,
    runAnalysis,
    githubUrl,
    setGithubUrl,
    fetchError,
    isFetching,
    manifestPath,
    setManifestPath,
    show404Input,
    availableManifests,
    fetchManifest,
  } = useManifestAnalyzer();

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

  const handleLoadYamlFile = useCallback((yaml, filename) => {
    setYamlString(yaml);
    if (filename) setSourceFilename(filename);
  }, []);

  const handleLoadBoilerplate = useCallback(() => {
    setYamlString(BOILERPLATE_YAML);
    setSourceFilename(DEFAULT_SOURCE_FILENAME);
  }, []);

  const handleGithubFetch = useCallback(
    async (event) => {
      event.preventDefault();
      const result = await fetchManifest();
      if (!result.ok) return;
      setYamlString(result.yamlString);
      setSourceFilename(result.filename);
      setInputMode("paste");
    },
    [fetchManifest],
  );

  const handleRunAnalysis = useCallback(async () => {
    const { failed } = await runAnalysis({
      yamlString,
      activeProfile,
      hardwareData,
      customConfig,
    });
    setActiveTab(failed ? "trace" : "diff");
  }, [activeProfile, customConfig, hardwareData, runAnalysis, yamlString]);

  const handleDownload = useCallback(() => {
    const content = apiResponse?.optimized_yaml_string;
    if (!content) return;
    const blob = new Blob([content], { type: "text/yaml" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = getOptimizedFilename(sourceFilename);
    anchor.click();
    URL.revokeObjectURL(url);
  }, [apiResponse, sourceFilename]);

  return (
    <>
      {showImport ? (
        <ImportModal onClose={() => setShowImport(false)} onLoad={handleLoadYamlFile} />
      ) : null}
      {isEditorExpanded ? (
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
      ) : null}
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
              <ManifestInputPanel
                yamlString={yamlString}
                setYamlString={setYamlString}
                inputMode={inputMode}
                setInputMode={setInputMode}
                githubUrl={githubUrl}
                setGithubUrl={setGithubUrl}
                manifestPath={manifestPath}
                setManifestPath={setManifestPath}
                fetchError={fetchError}
                isFetching={isFetching}
                availableManifests={availableManifests}
                show404Input={show404Input}
                analysisFailed={analysisFailed}
                isLoading={isLoading}
                onGithubFetch={handleGithubFetch}
                onOpenImport={() => setShowImport(true)}
                onExpandEditor={() => setIsEditorExpanded(true)}
                onLoadBoilerplate={handleLoadBoilerplate}
                onRunAnalysis={handleRunAnalysis}
              />
              {apiResponse ? (
                <ConfigurationCards
                  hardwareData={hardwareData}
                  hardwareSource={hardwareSource}
                  ramUnit={ramUnit}
                  setRamUnit={setRamUnit}
                  updateField={updateField}
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
                  hardwareSource={hardwareSource}
                  ramUnit={ramUnit}
                  setRamUnit={setRamUnit}
                  updateField={updateField}
                  onRedetectHardware={loadHardware}
                  activeProfile={activeProfile}
                  setActiveProfile={setActiveProfile}
                  customConfig={customConfig}
                  setCustomConfig={setCustomConfig}
                />
              ) : null}
              {!isLoading && apiResponse ? (
                <>
                  <ResultsMetricBar
                    apiResponse={apiResponse}
                    hardwareData={hardwareData}
                    serviceCount={serviceCount}
                    totalReplicas={totalReplicas}
                    statusTone={getStatusTone(statusClass)}
                  />
                  {apiResponse.warnings?.length ? (
                    <section className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-3 text-sm text-zinc-300">
                      {apiResponse.warnings.join(" ")}
                    </section>
                  ) : null}
                  <ResultsTabPanel
                    activeTab={activeTab}
                    setActiveTab={setActiveTab}
                    apiResponse={apiResponse}
                    activeProfile={activeProfile}
                    onDownload={handleDownload}
                    sourceFilename={sourceFilename}
                  />
                </>
              ) : null}
            </section>
          </div>
        </div>
      </main>
    </>
  );
}
