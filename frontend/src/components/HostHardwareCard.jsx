import { Cpu, RotateCcw } from "lucide-react";
import { RAM_UNITS, STORAGE_TYPES } from "../constants.js";
import {
  formatRamInputValue,
  parseRamInputValue,
  sanitizeDecimalInput,
  sanitizeIntegerInput,
} from "../utils.js";

export default function HostHardwareCard({
  hardwareData,
  hardwareSource,
  ramUnit,
  setRamUnit,
  updateField,
  onRedetectHardware,
}) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
      <div className="mb-3 flex min-w-0 flex-row items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-row items-center gap-2 overflow-hidden">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Cpu className="h-5 w-5 shrink-0 text-zinc-400" strokeWidth={1.5} aria-hidden="true" />
            <h2 className="truncate text-sm font-semibold text-zinc-100">Host Hardware</h2>
          </div>
          <div className="flex shrink-0 flex-row items-center gap-1.5">
            <span className="shrink-0 rounded-full bg-zinc-700 px-2 py-0.5 text-[0.68rem] font-medium text-zinc-300">
              {hardwareSource === "system" ? "System" : "Custom"}
            </span>
            <div className="inline-flex shrink-0 rounded-md border border-zinc-700 bg-zinc-950/80 p-0.5">
              {RAM_UNITS.map((unit) => (
                <button
                  key={unit}
                  type="button"
                  onClick={() => setRamUnit(unit)}
                  className={`h-5 min-w-7 rounded px-1.5 text-[0.68rem] font-medium transition ${
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
        </div>
        <button
          type="button"
          title="Re-detect system hardware"
          onClick={onRedetectHardware}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-zinc-700 bg-zinc-900/70 text-zinc-500 transition hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-300"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            {`Total RAM ${ramUnit}`}
          </span>
          <input
            className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-zinc-500"
            type="text"
            inputMode="decimal"
            value={formatRamInputValue(hardwareData.total_ram_mb, ramUnit)}
            onChange={(event) => {
              const sanitized = sanitizeDecimalInput(event.target.value);
              updateField("total_ram_mb", parseRamInputValue(sanitized, ramUnit) || 0);
            }}
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            {`Free RAM ${ramUnit}`}
          </span>
          <input
            className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-zinc-500"
            type="text"
            inputMode="decimal"
            value={formatRamInputValue(hardwareData.free_ram_mb, ramUnit)}
            onChange={(event) => {
              const sanitized = sanitizeDecimalInput(event.target.value);
              updateField("free_ram_mb", parseRamInputValue(sanitized, ramUnit) || 0);
            }}
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            CPU Cores
          </span>
          <input
            className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-zinc-500"
            type="text"
            inputMode="numeric"
            value={hardwareData.cpu_cores}
            onChange={(event) => {
              const sanitized = sanitizeIntegerInput(event.target.value);
              updateField("cpu_cores", sanitized ? Number(sanitized) : 0);
            }}
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Storage
          </span>
          <select
            className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none transition focus:border-zinc-500"
            value={hardwareData.storage_type}
            onChange={(event) => updateField("storage_type", event.target.value)}
          >
            {STORAGE_TYPES.map((storageType) => (
              <option key={storageType} value={storageType}>
                {storageType}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}
