import { TAB_OPTIONS } from "../constants.js";
import Diagnostics from "./Diagnostics.jsx";
import DiffViewer from "./DiffViewer.jsx";
import Topology from "./Topology.jsx";
import TraceLog from "./TraceLog.jsx";

export default function ResultsTabPanel({
  activeTab,
  setActiveTab,
  apiResponse,
  activeProfile,
  onDownload,
  sourceFilename,
}) {
  return (
    <>
      <div className="flex flex-wrap gap-2 rounded-xl border border-zinc-800 bg-zinc-900/70 p-2">
        {TAB_OPTIONS.map((tab) => {
          const TabIcon = tab.icon;
          return (
            <button
              key={tab.key}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition ${
                activeTab === tab.key
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
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
        {activeTab === "diff" ? (
          <DiffViewer
            originalYaml={apiResponse.baseline_yaml_string}
            optimizedYaml={apiResponse.optimized_yaml_string}
            onDownload={onDownload}
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
        {activeTab === "diagnostics" ? <Diagnostics response={apiResponse} /> : null}
      </section>
    </>
  );
}
