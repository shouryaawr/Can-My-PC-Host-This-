import { useEffect, useMemo, useRef } from "react";

function getRowTone(row) {
  if (row.startsWith("[STAGE 1]") || row.startsWith("[STAGE 2]")) {
    return "text-cyan-300";
  }
  if (row.includes("[STAGE 3]")) {
    return "text-amber-300";
  }
  if (row.includes("[CGROUPS]")) {
    return "text-emerald-300";
  }
  return "text-zinc-300";
}

function formatStageThree(row) {
  const match = row.match(/^(\[STAGE 3\]\[iter=\d+\]\s+)(.*?:\s+)(.*? -> .*?)(\s+\|\s+.*)$/);
  if (!match) {
    return row;
  }

  const [, prefix, service, mutation, gap] = match;
  return (
    <>
      <span>{prefix}</span>
      <span className="text-zinc-200">{service}</span>
      <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-emerald-300">
        {mutation}
      </span>
      <span className="text-amber-200">{gap}</span>
    </>
  );
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
            <div key={`${index}-${row}`} className={getRowTone(row)}>
              <span className="select-none pr-3 text-zinc-700">{String(index + 1).padStart(2, "0")}</span>
              <span>{row.includes("[STAGE 3]") ? formatStageThree(row) : row}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
