import { Check } from "lucide-react";
import { PROFILE_OPTIONS } from "../constants.js";
import NumberField from "./NumberField.jsx";

function updateCustomConfig(setCustomConfig, field, value) {
  setCustomConfig((current) => ({ ...current, [field]: value }));
}

export default function OperationalProfileCard({
  activeProfile,
  setActiveProfile,
  customConfig,
  setCustomConfig,
}) {
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
            <div className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-64 -translate-x-1/2 rounded-lg border border-zinc-700 bg-zinc-800 p-3 text-xs text-zinc-400 opacity-0 transition-opacity duration-150 group-hover/tip:opacity-100">
              {profile.description}
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
      {activeProfile === "custom" ? (
        <div className="mt-4 space-y-4 rounded-lg border border-zinc-700 bg-zinc-800/40 p-3">
          <p className="text-[0.68rem] font-medium uppercase tracking-wide text-zinc-500">
            Custom Tuning Parameters
          </p>
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
                onChange={(event) =>
                  updateCustomConfig(setCustomConfig, "ram_safety_buffer", Number(event.target.value))
                }
                className="custom-slider w-full"
              />
            </div>
            <div className="mt-0.5 flex justify-between text-[0.65rem] text-zinc-600">
              <span>0.00</span>
              <span>1.00</span>
            </div>
          </label>
          <label className="block">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-400">CPU Threshold Multiplier</span>
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-xs text-zinc-300">
                {customConfig.cpu_threshold_multiplier.toFixed(1)}x
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
                onChange={(event) =>
                  updateCustomConfig(
                    setCustomConfig,
                    "cpu_threshold_multiplier",
                    Number(event.target.value),
                  )
                }
                className="custom-slider w-full"
              />
            </div>
            <div className="mt-0.5 flex justify-between text-[0.65rem] text-zinc-600">
              <span>0.5x</span>
              <span>2.0x</span>
            </div>
          </label>
          <div className="block">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-400">Max Loop Iterations</span>
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-xs text-zinc-300">
                {customConfig.max_iterations}
              </span>
            </div>
            <NumberField
              label="Iterations"
              min={1}
              value={customConfig.max_iterations}
              onChange={(value) =>
                updateCustomConfig(
                  setCustomConfig,
                  "max_iterations",
                  Math.min(100, Math.max(1, Number(value) || 1)),
                )
              }
            />
            <p className="mt-1 text-[0.65rem] leading-4 text-zinc-500">
              Higher values yield tighter optimization on complex manifests at the cost of
              processing time.
            </p>
          </div>
          <div className="block">
            <label htmlFor="custom-allow-cgroups" className="flex cursor-pointer items-start gap-3">
              <div className="relative mt-0.5 flex shrink-0 items-center justify-center">
                <input
                  id="custom-allow-cgroups"
                  type="checkbox"
                  checked={customConfig.allow_cgroups}
                  onChange={(event) =>
                    updateCustomConfig(setCustomConfig, "allow_cgroups", event.target.checked)
                  }
                  className="peer sr-only"
                />
                <div className="flex h-5 w-5 items-center justify-center rounded border border-slate-600 bg-slate-800 text-transparent transition-colors peer-checked:border-purple-600 peer-checked:bg-purple-600 peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-purple-500">
                  <Check className="h-3.5 w-3.5" aria-hidden="true" strokeWidth={3} />
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
          <label className="block">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-400">RAM Floor Strictness</span>
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-xs text-zinc-300">
                {customConfig.floor_strictness.toFixed(2)}x
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
                onChange={(event) =>
                  updateCustomConfig(setCustomConfig, "floor_strictness", Number(event.target.value))
                }
                className="custom-slider w-full"
              />
            </div>
            <div className="mt-0.5 flex justify-between text-[0.65rem] text-zinc-600">
              <span>0.50x</span>
              <span>1.50x</span>
            </div>
          </label>
        </div>
      ) : null}
    </section>
  );
}
