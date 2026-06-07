import { diffLines } from "diff";
import { Check, Clipboard, Download, FileCode2, Wand2 } from "lucide-react";
import { useMemo, useState } from "react";

const ANNOTATION_VOCAB = [

  { pattern: /\bWORKERS\s*[:=]/, label: "CPU Floor",   hddOnly: false },
  { pattern: /\bWEB_CONCURRENCY\s*[:=]/, label: "CPU Floor",   hddOnly: false },

  { pattern: /\bmaxmemory\s*[:=]/,       label: "Cache Bound",  hddOnly: false },

  { pattern: /\bmax_connections\s*[:=]/, label: "Conn Pool",    hddOnly: false },

  { pattern: /\bWORKERS\s*[:=]/,            label: "I/O Dampened", hddOnly: true },
  { pattern: /\bWEB_CONCURRENCY\s*[:=]/,    label: "I/O Dampened", hddOnly: true },
  { pattern: /\bmaxmemory\s*[:=]/,          label: "I/O Dampened", hddOnly: true },
  { pattern: /\bmax_connections\s*[:=]/,    label: "I/O Dampened", hddOnly: true },
];

function resolveAnnotationBadge(line, isHddHost) {
  if (typeof line !== "string" || !line) return null;

  if (isHddHost) {

    for (const entry of ANNOTATION_VOCAB) {
      if (entry.hddOnly && entry.pattern.test(line)) return entry.label;
    }
  }

  for (const entry of ANNOTATION_VOCAB) {
    if (!entry.hddOnly && entry.pattern.test(line)) return entry.label;
  }

  return null;
}

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

function computeDiff(original = "", optimized = "") {
  const changes = diffLines(original, optimized, { newlineIsToken: false });
  const result = [];
  for (const change of changes) {
    const type = change.added ? "added" : change.removed ? "removed" : "same";

    const lines = change.value.replace(/\n$/, "").split("\n");
    for (const line of lines) {
      result.push({ type, line });
    }
  }
  return result;
}

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

  empty: {
    row: "",
    gutter: "text-zinc-800 select-none",
    sign: "",
    code: "text-transparent bg-zinc-900/20 select-none",
  },
};

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

    const blockRemoved = [];
    const blockAdded   = [];
    while (idx < hunks.length && hunks[idx].type !== "same") {
      if (hunks[idx].type === "removed") blockRemoved.push(hunks[idx]);
      else                               blockAdded.push(hunks[idx]);
      idx++;
    }

    const blockLen = Math.max(blockRemoved.length, blockAdded.length);
    for (let k = 0; k < blockLen; k++) {
      rows.push({
        kind:  "changed",
        left:  blockRemoved[k] ?? null,
        right: blockAdded[k]   ?? null,
      });
    }
  }

  return rows;
}

function SplitPaneRow({ hunk, lineNo, side, badge }) {
  if (!hunk) {

    return (
      <tr className="">
        <td className="w-8 select-none px-2 py-0 text-right text-[10px] leading-5 text-zinc-800">&#8203;</td>
        <td className="py-0 pr-4 pl-1 font-mono text-[11px] leading-5 whitespace-pre text-transparent bg-zinc-900/20 select-none">&#8203;</td>
      </tr>
    );
  }
  const s = LINE_STYLES[hunk.type];
  const bgClass = hunk.type === "removed" ? "bg-red-500/10" : hunk.type === "added" ? "bg-green-500/10" : "";

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

  let origLine = 0;
  let optLine  = 0;

  const splitRows = useMemo(() => buildSplitRows(hunks), [hunks]);

  return (
    <div className="space-y-3">      <div className="flex flex-wrap items-center justify-between gap-3">        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-300">
            <Wand2 className="h-3.5 w-3.5 text-zinc-500" />
            Optimized Manifest
          </div>
          <DiffStats hunks={hunks} />
        </div>        <div className="flex items-center gap-2">          <button
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
          </button>          {onDownload && (
            <button
              type="button"
              onClick={onDownload}
              title={sourceFilename ? `Download ${sourceFilename.replace(/\.ya?ml$/i, "")}.optimized.yml` : "Download optimized YAML"}
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-950/80 px-2.5 py-1 text-[0.68rem] font-medium text-zinc-400 transition hover:border-zinc-600 hover:text-zinc-200"
            >
              <Download className="h-3 w-3" />
              Download
            </button>
          )}          <div className="inline-flex rounded-md border border-zinc-700 bg-zinc-950/80 p-0.5">
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

      {diffViewMode === "split" && (() => {
        let leftNo  = 0;
        let rightNo = 0;

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
          <div className="rounded-lg border border-zinc-800 bg-zinc-950 overflow-hidden">            <div className="grid grid-cols-2 border-b border-zinc-800 bg-zinc-900/60">
              <div className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium text-zinc-500 border-r border-zinc-800">
                <FileCode2 className="h-3 w-3 text-zinc-500" />
                Original
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium text-zinc-500">
                <Wand2 className="h-3 w-3 text-zinc-500" />
                Optimized
              </div>
            </div>            <div className="grid grid-cols-2 w-full">              <div className="min-w-0 overflow-x-auto border-r border-zinc-800/60">
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
              </div>              <div className="min-w-0 overflow-x-auto">
                <table className="border-collapse">
                  <tbody>
                    {rightRows.map((r, idx) => {

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
