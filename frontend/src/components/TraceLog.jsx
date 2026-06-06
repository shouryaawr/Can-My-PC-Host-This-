import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ClipboardList } from "lucide-react";


function formatProfileLabel(raw) {
  const str = typeof raw === "string" && raw.trim() ? raw : "default";
  return str
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}


const PREFIX_MAP = [
  { from: /^\[Manifest\]/,   to: "[MANIFEST]"     },
  { from: /^\[Hardware\]/,   to: "[HARDWARE]"     },
  { from: /^\[Baseline\]/,   to: "[BASELINE]"     },
  { from: /^\[Optimize\]/,   to: "[OPTIMIZATION]" },
  { from: /^\[Safety\]/,     to: "[SAFETY]"       },
  { from: /^\[Warning\]/,    to: "[WARNING]"      },
  { from: /^\[STAGE \d+\]/,  to: null             }, // already canonical — leave as-is
];

function normalizePrefix(row) {
  if (typeof row !== "string") return String(row);
  for (const { from, to } of PREFIX_MAP) {
    if (from.test(row)) {
      // null means the token is already canonical; return unchanged
      if (to === null) return row;
      return row.replace(from, to);
    }
  }
  // Unknown / unmapped prefix — return raw line without distortion
  return row;
}

function getRowTone(row) {
  // All rows use uniform zinc styling — no accent color distinctions
  return "border-zinc-700 bg-zinc-800/30 text-zinc-400";
}

export default function TraceLog({ trace = [], activeProfile }) {
  const scrollRef = useRef(null);
  const [copied, setCopied] = useState(false);

  const rows = useMemo(() => {
    const profileLabel = formatProfileLabel(activeProfile);
    const contextLine = `[CONTEXT] Active Profile: ${profileLabel}`;
    const raw = Array.isArray(trace) ? trace : [];
    return [contextLine, ...raw.map(normalizePrefix)];
  }, [trace, activeProfile]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [rows]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(rows.join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [rows]);

  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded border border-zinc-800 bg-zinc-950 shadow-lg shadow-black/20">
      <div className="flex w-full flex-row items-center justify-between border-b border-zinc-800 px-3 py-2">
        <span className="font-mono text-xs text-zinc-500">engine-trace / runtime</span>
        <div className="flex items-center gap-3">
          <span className="text-xs text-zinc-500">{rows.length} events</span>
          <button
            type="button"
            onClick={handleCopy}
            aria-label="Copy log output"
            className={`inline-flex items-center gap-1.5 rounded px-2 py-1 text-[11px] font-medium transition hover:bg-zinc-800 hover:text-zinc-200 ${
              copied ? "opacity-50 text-zinc-400" : "text-zinc-500"
            }`}
          >
            {copied ? (
              <Check className="h-3 w-3 text-green-500" aria-hidden="true" />
            ) : (
              <ClipboardList className="h-3 w-3" aria-hidden="true" />
            )}
            Copy logs
          </button>
        </div>
      </div>
      <div
        ref={scrollRef}
        className="max-h-80 min-h-40 overflow-y-auto px-3 py-3 font-mono text-xs leading-5"
      >
        {rows.length === 0 ? (
          <div className="text-zinc-600">No trace output available.</div>
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
