import { FileCode2, Wand2 } from "lucide-react";
import { useMemo, useState } from "react";

/* ─────────────────────────── diff logic ────────────────────────── */

/**
 * Very lightweight line-level diff.
 * Returns an array of { type: "same"|"removed"|"added", line: string }.
 */
function computeDiff(original = "", optimized = "") {
  // Normalize line endings: strip \r to prevent CRLF ↔ LF false positives
  const a = original.replace(/\r/g, "").split("\n");
  const b = optimized.replace(/\r/g, "").split("\n");

  // Standard O(mn) LCS DP table
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

  // Traceback
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
  // Sentinel for empty spacer cells in split view
  empty: {
    row: "",
    gutter: "text-zinc-800 select-none",
    sign: "",
    code: "text-transparent bg-zinc-900/20 select-none",
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

/**
 * Converts a flat hunk array into side-by-side row descriptors.
 *
 * Strategy: walk hunks in sequence. Collect contiguous change blocks
 * (runs of removed/added with no "same" anchor between them), then zip
 * the removes and adds within that block. This ensures a removed line
 * on the left is only ever paired with an added line that appears in the
 * *same* contiguous change run — never with an add from a completely
 * different part of the file.
 *
 * Row shapes:
 *   { kind: "same",    line }          — unchanged line, shown in both panes
 *   { kind: "changed", left, right }   — left=removed hunk|null, right=added hunk|null
 */
function buildSplitRows(hunks) {
  const rows = [];

  let idx = 0;
  while (idx < hunks.length) {
    const hunk = hunks[idx];

    if (hunk.type === "same") {
      rows.push({ kind: "same", line: hunk.line });
      idx++;
      continue;
    }

    // Collect one contiguous block of removed + added lines
    const blockRemoved = [];
    const blockAdded   = [];
    while (idx < hunks.length && hunks[idx].type !== "same") {
      if (hunks[idx].type === "removed") blockRemoved.push(hunks[idx]);
      else                               blockAdded.push(hunks[idx]);
      idx++;
    }

    // Zip removes and adds within this block.
    // Any surplus lines on either side get an empty spacer on the other.
    const blockLen = Math.max(blockRemoved.length, blockAdded.length);
    for (let k = 0; k < blockLen; k++) {
      rows.push({
        kind:  "changed",
        left:  blockRemoved[k] ?? null,   // null → empty spacer in left pane
        right: blockAdded[k]   ?? null,   // null → empty spacer in right pane
      });
    }
  }

  return rows;
}

function SplitPaneRow({ hunk, lineNo, side }) {
  if (!hunk) {
    // Empty filler row — keeps row heights in sync via CSS
    return (
      <tr className="">
        <td className="w-8 select-none px-2 py-0 text-right text-[10px] leading-5 text-zinc-800">&#8203;</td>
        <td className="py-0 pr-4 pl-1 font-mono text-[11px] leading-5 whitespace-pre text-transparent bg-zinc-900/20 select-none">&#8203;</td>
      </tr>
    );
  }
  const s = LINE_STYLES[hunk.type];
  const bgClass = hunk.type === "removed" ? "bg-rose-500/10" : hunk.type === "added" ? "bg-emerald-500/10" : "";
  return (
    <tr className={`transition ${s.row}`}>
      <td className={`w-8 select-none px-2 py-0 text-right text-[10px] leading-5 ${s.gutter}`}>
        {lineNo}
      </td>
      <td className={`py-0 pr-4 pl-1 font-mono text-[11px] leading-5 whitespace-pre ${s.code} ${bgClass}`}>
        {hunk.line}
      </td>
    </tr>
  );
}

/* ── Main export ─────────────────────────────────────────────────── */

export default function DiffViewer({ originalYaml = "", optimizedYaml = "" }) {
  const [diffViewMode, setDiffViewMode] = useState("unified");

  const hunks = useMemo(
    () => computeDiff(originalYaml, optimizedYaml),
    [originalYaml, optimizedYaml],
  );

  // ── Unified view line counters ──
  let origLine = 0;
  let optLine  = 0;

  // ── Split view row builder ──
  const splitRows = useMemo(() => buildSplitRows(hunks), [hunks]);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Left: title + stats */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-300">
            <Wand2 className="h-3.5 w-3.5 text-emerald-400" />
            Optimized Manifest
          </div>
          <DiffStats hunks={hunks} />
        </div>

        {/* Right: Unified / Side-by-Side toggle */}
        <div className="inline-flex rounded-md border border-slate-700 bg-zinc-950/80 p-0.5">
          {[
            { key: "unified",  label: "Unified"      },
            { key: "split",    label: "Side-by-Side" },
          ].map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setDiffViewMode(key)}
              className={`rounded px-2.5 py-1 text-[0.68rem] font-medium transition ${
                diffViewMode === key
                  ? "bg-slate-700 text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Unified diff table ── */}
      {diffViewMode === "unified" && (
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
      )}

      {/* ── Side-by-Side split view ── */}
      {diffViewMode === "split" && (() => {
        let leftNo  = 0;
        let rightNo = 0;

        // Build per-pane row arrays from splitRows
        const leftRows  = [];
        const rightRows = [];

        for (const row of splitRows) {
          if (row.kind === "same") {
            leftNo++;
            rightNo++;
            leftRows.push({ hunk: { type: "same", line: row.line }, lineNo: leftNo });
            rightRows.push({ hunk: { type: "same", line: row.line }, lineNo: rightNo });
          } else {
            if (row.left)  leftNo++;
            if (row.right) rightNo++;
            leftRows.push({ hunk: row.left  ?? null, lineNo: row.left  ? leftNo  : null });
            rightRows.push({ hunk: row.right ?? null, lineNo: row.right ? rightNo : null });
          }
        }

        return (
          <div className="rounded-lg border border-slate-800 bg-zinc-950 overflow-hidden">
            {/* Column headers */}
            <div className="grid grid-cols-2 border-b border-slate-800 bg-zinc-900/60">
              <div className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium text-zinc-500 border-r border-slate-800">
                <FileCode2 className="h-3 w-3 text-cyan-400" />
                Original
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium text-zinc-500">
                <Wand2 className="h-3 w-3 text-emerald-400" />
                Optimized
              </div>
            </div>

            {/* Two independent panes — each scrolls horizontally on its own */}
            <div className="grid grid-cols-2 w-full">
              {/* Left pane — Original */}
              <div className="min-w-0 overflow-x-auto border-r border-slate-800/60">
                <table className="border-collapse">
                  <tbody>
                    {leftRows.map((r, idx) => (
                      <SplitPaneRow key={idx} hunk={r.hunk} lineNo={r.lineNo} side="left" />
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Right pane — Optimized */}
              <div className="min-w-0 overflow-x-auto">
                <table className="border-collapse">
                  <tbody>
                    {rightRows.map((r, idx) => (
                      <SplitPaneRow key={idx} hunk={r.hunk} lineNo={r.lineNo} side="right" />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
