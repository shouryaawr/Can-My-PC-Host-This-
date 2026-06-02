import { useEffect, useMemo, useRef } from "react";

function getRowTone(row) {
  if (row.startsWith("[Manifest]") || row.startsWith("[Hardware]")) {
    return "border-slate-800 bg-slate-900/30 text-slate-400";
  }
  if (row.startsWith("[Baseline]")) {
    return "border-blue-500/20 bg-blue-500/5 text-blue-400";
  }
  if (row.startsWith("[Optimize]")) {
    return "border-emerald-500/20 bg-emerald-500/5 text-emerald-400";
  }
  if (row.startsWith("[Safety]") || row.startsWith("[Warning]")) {
    return "border-amber-500/20 bg-amber-500/5 text-amber-400";
  }
  return "border-slate-800 bg-zinc-950 text-zinc-300";
}

export default function TraceLog({ trace = [] }) {
  const scrollRef = useRef(null);
  const rows = useMemo(() => (Array.isArray(trace) ? trace : []), [trace]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [rows]);

  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded border border-slate-800 bg-zinc-950 shadow-lg shadow-black/20">
      <div className="flex items-center gap-2 border-b border-slate-800 px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
        <span className="ml-2 font-mono text-xs text-zinc-500">engine-trace</span>
      </div>
      <div
        ref={scrollRef}
        className="max-h-80 min-h-40 overflow-y-auto px-3 py-3 font-mono text-xs leading-5"
      >
        {rows.length === 0 ? (
          <div className="text-zinc-600">Awaiting optimization trace...</div>
        ) : (
          rows.map((row, index) => (
            <div
              key={`${index}-${row}`}
              className={`mb-1 flex gap-3 rounded border px-2 py-1.5 ${getRowTone(row)}`}
            >
              <span className="shrink-0 select-none text-zinc-700">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="min-w-0 break-words">{row}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
