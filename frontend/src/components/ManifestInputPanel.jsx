import { FileCode, Github, Loader2, Maximize2, Upload } from "lucide-react";

export default function ManifestInputPanel({
  yamlString,
  setYamlString,
  inputMode,
  setInputMode,
  githubUrl,
  setGithubUrl,
  manifestPath,
  setManifestPath,
  fetchError,
  isFetching,
  availableManifests,
  show404Input,
  analysisFailed,
  isLoading,
  onGithubFetch,
  onOpenImport,
  onExpandEditor,
  onLoadBoilerplate,
  onRunAnalysis,
}) {
  return (
    <section className="rounded-xl border border-zinc-700 bg-zinc-900/70 p-4">
      <div className="mb-4 flex w-full flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <FileCode className="h-5 w-5 text-zinc-400" strokeWidth={1.5} aria-hidden="true" />
          <h2 className="whitespace-nowrap text-sm font-semibold text-zinc-100">
            Compose Manifest
          </h2>
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
        <form className="rounded-lg border border-zinc-700 bg-zinc-800/70 p-3" onSubmit={onGithubFetch}>
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
              placeholder={`https:${"/".repeat(2)}github.com/owner/repository`}
              value={githubUrl}
              onChange={(event) => setGithubUrl(event.target.value)}
              disabled={isFetching}
            />
            <button
              type="submit"
              disabled={isFetching || !githubUrl.trim()}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-zinc-600 bg-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-100 transition hover:bg-zinc-600 disabled:cursor-not-allowed disabled:border-zinc-700 disabled:bg-zinc-800 disabled:text-zinc-500"
            >
              {isFetching ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Github className="h-4 w-4" aria-hidden="true" />
              )}
              Fetch
            </button>
          </div>
          {fetchError ? <p className="mt-2 text-xs leading-5 text-red-500">{fetchError}</p> : null}
          {availableManifests.length > 0 ? (
            <div className="mt-3 rounded-lg border border-zinc-700 bg-zinc-900/50 p-3">
              <label htmlFor="manifest-select" className="mb-1.5 block text-xs font-medium text-zinc-300">
                Multiple manifests found. Please select one:
              </label>
              <select
                id="manifest-select"
                className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-zinc-500 focus:ring-1 focus:ring-zinc-500/20"
                value={manifestPath}
                onChange={(event) => setManifestPath(event.target.value)}
                disabled={isFetching}
              >
                {availableManifests.map((path) => (
                  <option key={path} value={path}>
                    {path}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={isFetching}
                className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-md border border-zinc-600 bg-zinc-700 px-3 py-2 text-xs font-semibold text-zinc-100 transition hover:bg-zinc-600"
              >
                {isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
                Load Selected Manifest
              </button>
            </div>
          ) : null}
          {show404Input ? (
            <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
              <label htmlFor="custom-manifest-path" className="mb-1.5 block text-xs font-medium text-amber-400">
                Could not find a compose file at the repository root. Please specify the custom file path (e.g.,{" "}
                <span className="font-mono text-amber-300">deployments/docker/compose.yml</span>):
              </label>
              <input
                id="custom-manifest-path"
                type="text"
                className="w-full rounded-md border border-amber-500/40 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-amber-400 focus:ring-1 focus:ring-amber-400/20"
                placeholder="path/to/compose.yml"
                value={manifestPath}
                onChange={(event) => setManifestPath(event.target.value)}
                disabled={isFetching}
              />
              <button
                type="submit"
                disabled={isFetching || !manifestPath.trim()}
                className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/20 px-3 py-2 text-xs font-semibold text-amber-300 transition hover:bg-amber-500/30 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
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
            onClick={onOpenImport}
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
              onClick={onExpandEditor}
              className="absolute bottom-2 right-2 z-10 inline-flex h-8 w-8 items-center justify-center rounded-md border border-zinc-700 bg-zinc-900/90 text-zinc-400 shadow-sm transition hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100"
            >
              <Maximize2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </>
      ) : null}
      {analysisFailed ? (
        <p className="mt-2 text-xs text-zinc-600">
          Invalid format?{" "}
          <button
            type="button"
            onClick={onLoadBoilerplate}
            className="text-zinc-400 underline underline-offset-2 transition hover:text-zinc-200"
          >
            Load a known-good boilerplate.
          </button>
        </p>
      ) : null}
      <button
        id="analyze-btn"
        className="mt-4 flex w-full items-center justify-center rounded-lg bg-zinc-700 px-4 py-3 text-sm font-semibold text-zinc-100 transition hover:bg-zinc-600 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
        type="button"
        disabled={isLoading || !yamlString.trim()}
        onClick={onRunAnalysis}
      >
        Analyze
      </button>
    </section>
  );
}
