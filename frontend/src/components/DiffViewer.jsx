import { FileCode2, Wand2 } from "lucide-react";
import { useMemo } from "react";

/* ─────────────────────────── diff logic ────────────────────────── */

/**
 * Very lightweight line-level diff.
 * Returns an array of { type: "same"|"removed"|"added", line: string }.
 */
function computeDiff(original = "", optimized = "") {
  const a = original.split("\n");
  const b = optimized.split("\n");

  // Build LCS table (patience-lite — good enough for YAML manifests)
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const result = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      result.unshift({ type: "same", line: a[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: "added", line: b[j - 1] });
      j--;
    } else {
      result.unshift({ type: "removed", line: a[i - 1] });
      i--;
    }
  }
  return result;
}

/* ─────────────────────────── components ────────────────────────── */

const LINE_STYLES = {
  same: {
    row: "hover:bg-slate-800/30",
    gutter: "text-zinc-700 select-none",
    sign: "",
    code: "text-zinc-400",
  },
  removed: {
    row: "bg-rose-500/10 hover:bg-rose-500/15",
    gutter: "text-rose-600 select-none",
    sign: "-",
    code: "text-rose-300",
  },
  added: {
    row: "bg-emerald-500/10 hover:bg-emerald-500/15",
    gutter: "text-emerald-600 select-none",
    sign: "+",
    code: "text-emerald-300",
  },
};

function DiffLine({ type, line, lineNo }) {
  const s = LINE_STYLES[type];
  return (
    <tr className={`transition ${s.row}`}>
      <td className={`w-8 select-none px-2 py-0 text-right text-[10px] leading-5 ${s.gutter}`}>
        {lineNo}
      </td>
      <td className={`w-4 select-none px-1 py-0 text-center text-[10px] leading-5 font-mono ${s.gutter}`}>
        {s.sign}
      </td>
      <td className={`py-0 pr-4 pl-1 font-mono text-[11px] leading-5 whitespace-pre-wrap break-all ${s.code}`}>
        {line}
      </td>
    </tr>
  );
}

function DiffStats({ hunks }) {
  const added = hunks.filter((h) => h.type === "added").length;
  const removed = hunks.filter((h) => h.type === "removed").length;
  return (
    <div className="flex items-center gap-3 text-xs">
      {added > 0 && (
        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-400">
          +{added} added
        </span>
      )}
      {removed > 0 && (
        <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-rose-400">
          -{removed} removed
        </span>
      )}
      {added === 0 && removed === 0 && (
        <span className="text-zinc-500">No changes — manifests are identical</span>
      )}
    </div>
  );
}

export default function DiffViewer({ originalYaml = "", optimizedYaml = "" }) {
  const hunks = useMemo(
    () => computeDiff(originalYaml, optimizedYaml),
    [originalYaml, optimizedYaml],
  );

  // Number lines independently per side
  let origLine = 0;
  let optLine = 0;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4 text-xs text-zinc-500">
          <span className="flex items-center gap-1.5">
            <FileCode2 className="h-3.5 w-3.5 text-cyan-400" />
            Original
          </span>
          <span className="text-zinc-700">→</span>
          <span className="flex items-center gap-1.5">
            <Wand2 className="h-3.5 w-3.5 text-emerald-400" />
            Optimized
          </span>
        </div>
        <DiffStats hunks={hunks} />
      </div>

      {/* Unified diff table */}
      <div className="overflow-auto rounded-lg border border-slate-800 bg-zinc-950">
        <table className="min-w-full border-collapse">
          <tbody>
            {hunks.map((hunk, idx) => {
              let lineNo;
              if (hunk.type === "removed") {
                origLine++;
                lineNo = origLine;
              } else if (hunk.type === "added") {
                optLine++;
                lineNo = optLine;
              } else {
                origLine++;
                optLine++;
                lineNo = origLine;
              }
              return (
                <DiffLine
                  key={idx}
                  type={hunk.type}
                  line={hunk.line}
                  lineNo={lineNo}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Side-by-side raw view (collapsed under diff) */}
      <details className="group rounded-lg border border-slate-800 bg-zinc-900/50">
        <summary className="cursor-pointer select-none px-4 py-2.5 text-xs text-zinc-500 transition hover:text-zinc-300">
          Side-by-side raw view
        </summary>
        <div className="grid gap-4 p-4 lg:grid-cols-2">
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-xs text-zinc-500">
              <FileCode2 className="h-3 w-3 text-cyan-400" />
              Original Manifest
            </div>
            <pre className="overflow-auto rounded border border-slate-800 bg-zinc-950 p-3 font-mono text-[11px] leading-5 text-zinc-300 whitespace-pre-wrap break-words">
              {originalYaml?.trim() || "No YAML available."}
            </pre>
          </div>
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-xs text-zinc-500">
              <Wand2 className="h-3 w-3 text-emerald-400" />
              Optimized Manifest
            </div>
            <pre className="overflow-auto rounded border border-slate-800 bg-zinc-950 p-3 font-mono text-[11px] leading-5 text-zinc-300 whitespace-pre-wrap break-words">
              {optimizedYaml?.trim() || "No YAML available."}
            </pre>
          </div>
        </div>
      </details>
    </div>
  );
}
