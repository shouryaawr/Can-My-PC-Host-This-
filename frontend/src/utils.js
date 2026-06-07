export function formatMetric(value, suffix = "MB") {
  const number = Number(value || 0);
  return `${Math.round(number).toLocaleString()} ${suffix}`;
}

export function formatRamInputValue(value, unit) {
  const number = Number(value || 0);
  if (unit === "GB") {
    return Number((number / 1000).toFixed(1));
  }
  return Math.round(number);
}

export function parseRamInputValue(value, unit) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(unit === "GB" ? number * 1000 : number);
}

export function getStatusTone(statusClass) {
  return statusClass.split(" ").find((item) => item.startsWith("text-")) || "text-zinc-300";
}

export function getOptimizedFilename(sourceFilename) {
  const base = sourceFilename.replace(/\.ya?ml$/i, "");
  return `${base}.optimized.yml`;
}

export function isFailedAnalysis(data) {
  return (
    data.status === "INVALID_MANIFEST" ||
    data.status === "UNSUPPORTED_ORCHESTRATOR" ||
    !data.optimized_yaml_string
  );
}

export function parseManifestOptions(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
