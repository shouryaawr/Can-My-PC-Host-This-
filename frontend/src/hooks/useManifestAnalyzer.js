import { useCallback, useState } from "react";
import { API_BASE_URL, DEFAULT_MANIFEST_PATH } from "../constants.js";
import { isFailedAnalysis, parseManifestOptions } from "../utils.js";

export function useManifestAnalyzer() {
  const [apiResponse, setApiResponse] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [analysisFailed, setAnalysisFailed] = useState(false);
  const [githubUrl, setGithubUrl] = useState("");
  const [fetchError, setFetchError] = useState(null);
  const [isFetching, setIsFetching] = useState(false);
  const [manifestPath, setManifestPath] = useState(DEFAULT_MANIFEST_PATH);
  const [show404Input, setShow404Input] = useState(false);
  const [availableManifests, setAvailableManifests] = useState([]);
  const [selectedBranch, setSelectedBranch] = useState("");

  const fetchManifest = useCallback(async () => {
    setFetchError(null);
    setShow404Input(false);
    setIsFetching(true);

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
        return { ok: false };
      }

      const data = await response.json();
      const manifests = parseManifestOptions(data.multiple_manifests);

      if (manifests.length > 0) {
        setAvailableManifests(manifests);
        setSelectedBranch(data.branch || "");
        setManifestPath(manifests[0]);
        return { ok: false };
      }

      const loadedPath = manifestPath;
      setGithubUrl("");
      setManifestPath(DEFAULT_MANIFEST_PATH);
      setShow404Input(false);
      setAvailableManifests([]);
      setSelectedBranch("");

      return {
        ok: true,
        yamlString: data.yaml_string || "",
        filename: loadedPath,
      };
    } catch (error) {
      setFetchError(error.message || "Could not fetch a Docker Compose manifest.");
      return { ok: false };
    } finally {
      setIsFetching(false);
    }
  }, [githubUrl, manifestPath]);

  const runAnalysis = useCallback(async ({ yamlString, activeProfile, hardwareData, customConfig }) => {
    setIsLoading(true);
    setApiResponse(null);
    setAnalysisFailed(false);

    try {
      const hardwarePayload = {
        ...hardwareData,
        total_ram_mb: Math.round(Number(hardwareData.total_ram_mb) || 0),
        free_ram_mb: Math.round(Number(hardwareData.free_ram_mb) || 0),
        cpu_cores: Math.round(Number(hardwareData.cpu_cores) || 0),
      };

      const requestBody = {
        yaml_string: yamlString,
        selected_profile: activeProfile,
        host_hardware: hardwarePayload,
        ...(activeProfile === "custom" ? { custom_profile_config: customConfig } : {}),
      };

      const response = await fetch(`${API_BASE_URL}/api/v1/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const data = await response.json();



      setApiResponse(data);
      const failed = isFailedAnalysis(data);
      setAnalysisFailed(failed);
      return { failed };
    } catch (error) {
      const fallback = {
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
        execution_trace: [`[Network] ${error.message}`],
      };
      setApiResponse(fallback);
      setAnalysisFailed(true);
      return { failed: true };
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
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
    selectedBranch,
    fetchManifest,
  };
}
