import { Check, Clipboard, Download, FileCode2, Wand2 } from "lucide-react";
import { useMemo, useState } from "react";

/* ─────────────────────────── annotation vocabulary ─────────────────────── */
/*
 * Private, self-contained label map.
 * This dictionary is intentionally NOT exported and must never be shared with
 * or imported by TraceLog.jsx — that component owns its own log-parsing and
 * stage-tinting engine completely independently.
 *
 * Matching strategy: each entry carries a `pattern` (RegExp) that is tested
 * against the raw line text. The first match wins.
 *
 * HDD-host variables are flagged separately via the `hddOnly` boolean so that
 * the caller can gate them behind the `isHddHost` runtime prop.
 */
const ANNOTATION_VOCAB = [
  // CPU scheduling / worker pool variables
  { pattern: /\bWORKERS\s*[:=]/, label: "CPU Floor",   hddOnly: false },
  { pattern: /\bWEB_CONCURRENCY\s*[:=]/, label: "CPU Floor",   hddOnly: false },
  // Cache ceiling
  { pattern: /\bmaxmemory\s*[:=]/,       label: "Cache Bound",  hddOnly: false },
  // Connection pool
  { pattern: /\bmax_connections\s*[:=]/, label: "Conn Pool",    hddOnly: false },
  // Any mutation under an active HDD host state
  { pattern: /\bWORKERS\s*[:=]/,            label: "I/O Dampened", hddOnly: true },
  { pattern: /\bWEB_CONCURRENCY\s*[:=]/,    label: "I/O Dampened", hddOnly: true },
  { pattern: /\bmaxmemory\s*[:=]/,          label: "I/O Dampened", hddOnly: true },
  { pattern: /\bmax_connections\s*[:=]/,    label: "I/O Dampened", hddOnly: true },
];

/**
 * resolveAnnotationBadge
 *
 * Scans `line` against ANNOTATION_VOCAB and returns the appropriate two-word
 * orientation label, or null if no mutation key is detected.
 *
 * When `isHddHost` is true, hddOnly entries take precedence so that all
 * matched mutation variables surface as [I/O Dampened].
 *
 * @param {string}  line       — raw line text from the diff hunk
 * @param {boolean} isHddHost  — whether the host storage tier is rotational HDD
 * @returns {string|null}
 */
function resolveAnnotationBadge(line, isHddHost) {
  if (typeof line !== "string" || !line) return null;

  if (isHddHost) {
    // HDD path: check hddOnly entries first
    for (const entry of ANNOTATION_VOCAB) {
      if (entry.hddOnly && entry.pattern.test(line)) return entry.label;
    }
  }

  // Standard path: only non-hddOnly entries
  for (const entry of ANNOTATION_VOCAB) {
    if (!entry.hddOnly && entry.pattern.test(line)) return entry.label;
  }

  return null;
}

/* ─────────────────────────── annotation badge UI ───────────────────────── */

/**
 * AnnotationBadge — compact, muted grey inline chip.
 * Rendered exclusively on added/optimized lines; never on removed lines.
 */
function AnnotationBadge({ label }) {
  if (!label) return null;
  return (
    <span
      className="ml-2 inline-flex shrink-0 items-center rounded border border-zinc-700 bg-zinc-800/70 px-1.5 py-0 font-mono text-[9px] font-medium uppercase tracking-wide text-zinc-500 select-none"
      aria-label={`Annotation: ${label}`}
    >
      {label}
    </span>
  );
}

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
    row: "hover:bg-zinc-800/30",
    gutter: "text-zinc-700 select-none",
    sign: "",
    code: "text-zinc-400",
  },
  removed: {
    row: "bg-red-500/10 hover:bg-red-500/15",
    gutter: "text-red-500 select-none",
    sign: "-",
    code: "text-red-500",
  },
  added: {
    row: "bg-green-500/10 hover:bg-green-500/15",
    gutter: "text-green-500 select-none",
    sign: "+",
    code: "text-green-500",
  },
  // Sentinel for empty spacer cells in split view
  empty: {
    row: "",
    gutter: "text-zinc-800 select-none",
    sign: "",
    code: "text-transparent bg-zinc-900/20 select-none",
  },
};

/**
 * DiffLine — unified view row.
 *
 * Badge placement rule: render badge only on `added` lines, positioned
 * immediately after the trailing characters of the line text.
 * Removed lines never carry badges.
 */
function DiffLine({ type, line, lineNo, badge }) {
  const s = LINE_STYLES[type];
  const showBadge = type === "added" && badge;
  return (
    <tr className={`transition ${s.row}`}>
      <td className={`w-8 select-none px-2 py-0 text-right text-[10px] leading-5 ${s.gutter}`}>
        {lineNo}
      </td>
      <td className={`w-4 select-none px-1 py-0 text-center text-[10px] leading-5 font-mono ${s.gutter}`}>
        {s.sign}
      </td>
      <td className={`py-0 pr-4 pl-1 font-mono text-[11px] leading-5 whitespace-pre-wrap break-all ${s.code}`}>
        <span>{line}</span>
        {showBadge && <AnnotationBadge label={badge} />}
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
        <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-green-500">
          +{added} added
        </span>
      )}
      {removed > 0 && (
        <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-red-500">
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

/**
 * SplitPaneRow — one row inside a split-view pane.
 *
 * Badge placement rules:
 *   • side === "right"  (Optimized pane) + hunk.type === "added"  → render badge
 *   • side === "left"   (Original pane)                            → NEVER render badge
 *   • hunk.type === "removed"                                      → NEVER render badge
 */
function SplitPaneRow({ hunk, lineNo, side, badge }) {
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
  const bgClass = hunk.type === "removed" ? "bg-red-500/10" : hunk.type === "added" ? "bg-green-500/10" : "";
  // Badge only on right pane + added lines
  const showBadge = side === "right" && hunk.type === "added" && badge;
  return (
    <tr className={`transition ${s.row}`}>
      <td className={`w-8 select-none px-2 py-0 text-right text-[10px] leading-5 ${s.gutter}`}>
        {lineNo}
      </td>
      <td className={`py-0 pr-4 pl-1 font-mono text-[11px] leading-5 whitespace-pre ${s.code} ${bgClass}`}>
        <span>{hunk.line}</span>
        {showBadge && <AnnotationBadge label={badge} />}
      </td>
    </tr>
  );
}

/* ── Main export ─────────────────────────────────────────────────── */

export default function DiffViewer({ originalYaml = "", optimizedYaml = "", onDownload, sourceFilename, isHddHost = false }) {
  const [diffViewMode, setDiffViewMode] = useState("unified");
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(optimizedYaml).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

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
            <Wand2 className="h-3.5 w-3.5 text-zinc-500" />
            Optimized Manifest
          </div>
          <DiffStats hunks={hunks} />
        </div>

        {/* Right: Copy button + Unified / Side-by-Side toggle */}
        <div className="flex items-center gap-2">
          {/* Copy manifest button */}
          <button
            type="button"
            onClick={handleCopy}
            className={`inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-950/80 px-2.5 py-1 text-[0.68rem] font-medium text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-200 ${
              copied ? "opacity-50" : "opacity-100"
            }`}
          >
            {copied
              ? <Check className="h-3 w-3 text-green-500" />
              : <Clipboard className="h-3 w-3" />}
            Copy manifest
          </button>

          {/* Download optimized YAML button */}
          {onDownload && (
            <button
              type="button"
              onClick={onDownload}
              title={sourceFilename ? `Download ${sourceFilename.replace(/\.ya?ml$/i, "")}.optimized.yml` : "Download optimized YAML"}
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-950/80 px-2.5 py-1 text-[0.68rem] font-medium text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-200"
            >
              <Download className="h-3 w-3" />
              Download
            </button>
          )}

          {/* Unified / Side-by-Side toggle */}
          <div className="inline-flex rounded-md border border-zinc-700 bg-zinc-950/80 p-0.5">
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
                    ? "bg-zinc-700 text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-200"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Unified diff table ── */}
      {diffViewMode === "unified" && (
        <div className="overflow-auto rounded-lg border border-zinc-800 bg-zinc-950">
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
                // Resolve badge: only for added lines — removed lines never carry badges
                const badge = hunk.type === "added"
                  ? resolveAnnotationBadge(hunk.line, isHddHost)
                  : null;
                return (
                  <DiffLine
                    key={idx}
                    type={hunk.type}
                    line={hunk.line}
                    lineNo={lineNo}
                    badge={badge}
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
          <div className="rounded-lg border border-zinc-800 bg-zinc-950 overflow-hidden">
            {/* Column headers */}
            <div className="grid grid-cols-2 border-b border-zinc-800 bg-zinc-900/60">
              <div className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium text-zinc-500 border-r border-zinc-800">
                <FileCode2 className="h-3 w-3 text-zinc-500" />
                Original
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium text-zinc-500">
                <Wand2 className="h-3 w-3 text-zinc-500" />
                Optimized
              </div>
            </div>

            {/* Two independent panes — each scrolls horizontally on its own */}
            <div className="grid grid-cols-2 w-full">
              {/* Left pane — Original. Badge prop intentionally withheld (always null). */}
              <div className="min-w-0 overflow-x-auto border-r border-zinc-800/60">
                <table className="border-collapse">
                  <tbody>
                    {leftRows.map((r, idx) => (
                      <SplitPaneRow
                        key={idx}
                        hunk={r.hunk}
                        lineNo={r.lineNo}
                        side="left"
                        badge={null}
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Right pane — Optimized. Badges rendered on added lines only. */}
              <div className="min-w-0 overflow-x-auto">
                <table className="border-collapse">
                  <tbody>
                    {rightRows.map((r, idx) => {
                      // Resolve badge only for added hunks in the right (Optimized) pane
                      const badge = r.hunk && r.hunk.type === "added"
                        ? resolveAnnotationBadge(r.hunk.line, isHddHost)
                        : null;
                      return (
                        <SplitPaneRow
                          key={idx}
                          hunk={r.hunk}
                          lineNo={r.lineNo}
                          side="right"
                          badge={badge}
                        />
                      );
                    })}
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
