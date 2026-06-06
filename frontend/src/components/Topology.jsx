import { useState } from "react";
import { ChevronDown, Database, HardDrive, Layers, Network, Server, ShieldAlert } from "lucide-react";

// ---------------------------------------------------------------------------
// Static priority/metadata map for known backend mutation keys.
// Higher `priority` value = dominant when multiple mutations coexist.
// ---------------------------------------------------------------------------
const MUTATION_CONFIG = {
  WORKERS: {
    priority: 4,
    reason: "Reduced background worker count to protect host CPU headroom.",
    impact: "Lower continuous memory overhead; minor concurrency limit under maximum load.",
  },
  WEB_CONCURRENCY: {
    priority: 3,
    reason: "Web concurrency cap applied to prevent memory saturation under burst traffic.",
    impact: "Concurrent request ceiling reduced; graceful degradation preferred over OOM.",
  },
  maxmemory: {
    priority: 3,
    reason: "Cache memory ceiling enforced to prevent unbounded growth on the host.",
    impact: "Eviction policy activates at threshold; hot-key hit rate may decrease slightly.",
  },
  max_connections: {
    priority: 2,
    reason: "Maximum connection pool capped to limit per-process memory commitment.",
    impact: "Connection queue depth reduced; additional clients will be rejected at the cap.",
  },
};


const COLUMN_DEFINITIONS = [
  {
    title: "Ingress & Routing",
    tiers: ["frontend"],
  },
  {
    title: "Application Core",
    tiers: ["backend_hybrid", "backend_low_priority"],
  },
  {
    title: "Data & State",
    tiers: ["database", "cache"],
  },
];

const TIER_STYLES = {
  database: {
    icon: Database,
    badge: "border-zinc-600 bg-zinc-700/50 text-zinc-300",
    iconShell: "bg-zinc-700/50 text-zinc-400",
  },
  cache: {
    icon: HardDrive,
    badge: "border-zinc-600 bg-zinc-700/50 text-zinc-300",
    iconShell: "bg-zinc-700/50 text-zinc-400",
  },
  backend_hybrid: {
    icon: Layers,
    badge: "border-zinc-600 bg-zinc-700/50 text-zinc-300",
    iconShell: "bg-zinc-700/50 text-zinc-400",
  },
  backend_low_priority: {
    icon: Server,
    badge: "border-zinc-600 bg-zinc-700/50 text-zinc-300",
    iconShell: "bg-zinc-700/50 text-zinc-400",
  },
  frontend: {
    icon: Network,
    badge: "border-zinc-600 bg-zinc-700/50 text-zinc-300",
    iconShell: "bg-zinc-700/50 text-zinc-400",
  },
};

// ---------------------------------------------------------------------------
// Tier display name normalisation
// Declared at module scope — instantiated once at import time, never on render.
// Keys match the lowercase tier tokens emitted by the backend.
// Any unrecognised tier falls back to the raw token string.
// ---------------------------------------------------------------------------
const TIER_DISPLAY_MAP = {
  frontend:             "Frontend",
  backend_hybrid:       "Backend",
  backend_low_priority: "Backend",
  database:             "Database",
  cache:                "Cache",
};


function formatRam(value) {
  return `${Math.round(Number(value || 0))}MB`;
}

function getCompressionPercent(service) {
  const initial = Number(service.initial_ram_mb || 0);
  const final = Number(service.final_ram_mb || 0);
  if (initial <= 0) return 0;
  return Math.max(0, Math.min(100, (final / initial) * 100));
}

/**
 * Returns mutations sorted descending by priority weight.
 * Keys not present in MUTATION_CONFIG fall back to priority 0.
 */
function sortMutationsByPriority(variables_mutated = {}) {
  return Object.entries(variables_mutated).sort(([keyA], [keyB]) => {
    const pA = MUTATION_CONFIG[keyA]?.priority ?? 0;
    const pB = MUTATION_CONFIG[keyB]?.priority ?? 0;
    return pB - pA;
  });
}


function SubordinateAccordion({ mutations }) {
  const [open, setOpen] = useState(false);

  if (mutations.length === 0) return null;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800/60 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200"
        aria-expanded={open}
      >
        <span>{open ? "−" : "+"}{mutations.length} detail{mutations.length !== 1 ? "s" : ""}</span>
        <ChevronDown
          className={`h-3 w-3 shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {/* Smooth in-flow expansion — uses CSS max-height transition */}
      <div
        style={{
          maxHeight: open ? `${mutations.length * 80}px` : "0px",
          overflow: "hidden",
          transition: "max-height 0.28s ease",
        }}
      >
        <div className="mt-2 space-y-2">
          {mutations.map(([key, value]) => {
            const cfg = MUTATION_CONFIG[key];
            const fromVal = value != null && typeof value === "object" ? Math.round(Number(value.from)) : Math.round(Number(value));
            const toVal   = value != null && typeof value === "object" ? Math.round(Number(value.to))   : Math.round(Number(value));
            const hasDetail = value != null && typeof value === "object" && "from" in value && "to" in value;
            return (
              <div
                key={key}
                className="rounded-md border border-zinc-800 bg-zinc-950/60 px-2.5 py-2 space-y-1"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-zinc-300">
                    {hasDetail ? `${key}: ${fromVal} → ${toVal}` : `${key}: ${Math.round(Number(value))}`}
                  </span>
                </div>
                {cfg && (
                  <>
                    <p className="text-[10px] text-zinc-400 leading-snug">{cfg.reason}</p>
                    <p className="text-[10px] text-zinc-500 leading-snug italic">{cfg.impact}</p>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}


function ServiceCard({ service }) {
  const [expanded, setExpanded] = useState(false);

  const tierStyle = TIER_STYLES[service.tier] || TIER_STYLES.backend_low_priority;
  const TierIcon = tierStyle.icon;
  const initialRam = Number(service.initial_ram_mb || 0);
  const finalRam = Number(service.final_ram_mb || 0);
  const isMutated = Math.round(initialRam) !== Math.round(finalRam);
  const compressionPercent = getCompressionPercent(service);
  const barClass = isMutated ? "bg-zinc-500" : "bg-green-500";


  const rawMutations = service.variables_mutated ?? {};
  const hasMutations = Object.keys(rawMutations).length > 0;

  // Sort all mutations high → low priority
  const sortedMutations = hasMutations ? sortMutationsByPriority(rawMutations) : [];

  // Dominant = highest priority mutation (first after sort)
  const [dominantKey, dominantValue] = sortedMutations[0] ?? [];
  const dominantCfg = dominantKey ? (MUTATION_CONFIG[dominantKey] ?? null) : null;

  // Subordinate = everything except the dominant
  const subordinateMutations = sortedMutations.slice(1);


  const changeLabel = isMutated
    ? `${formatRam(initialRam)} → ${formatRam(finalRam)}`
    : `${formatRam(finalRam)} (Optimal)`;

  const dominantReason = dominantCfg?.reason ?? service.reason ?? "Configuration adjusted to match runtime resource constraints.";
  const dominantImpact = dominantCfg?.impact ?? service.impact ?? "No additional operational impact anticipated.";

  return (
    <article className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/80 shadow-sm shadow-black/20">
      <div className="space-y-4 p-3">

        <button
          type="button"
          className="flex w-full items-start gap-3 text-left"
          aria-expanded={expanded}
          onClick={() => setExpanded((prev) => !prev)}
          disabled={!hasMutations}
          style={!hasMutations ? { cursor: "default" } : undefined}
        >
          <div className={`rounded-md p-2 ${tierStyle.iconShell}`}>
            <TierIcon className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h4 className="truncate text-sm font-medium text-zinc-100">{service.name}</h4>
            </div>
            <span
              className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${tierStyle.badge}`}
            >
              {TIER_DISPLAY_MAP[service.tier] ?? service.tier}
            </span>
          </div>
          {/* Only show chevron when there are mutations to expand */}
          {hasMutations && (
            <ChevronDown
              className={`mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-600 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
              aria-hidden="true"
            />
          )}
        </button>


        <div>
          <div className="mb-2 flex items-center justify-between font-mono text-xs">
            <span className="text-zinc-500">memory</span>
            <span>
              {isMutated ? (
                <>
                  <span className="text-zinc-600 line-through">{formatRam(initialRam)}</span>
                  <span className="px-1 text-zinc-600">-&gt;</span>
                  <span className="text-zinc-300">{formatRam(finalRam)}</span>
                </>
              ) : (
                <span className="text-green-500">{formatRam(finalRam)}</span>
              )}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded bg-zinc-950">
            <div
              className={`h-full rounded ${barClass}`}
              style={{ width: `${compressionPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/*
        ── Rule 1: No mutations → suppress CHANGE / REASON / IMPACT entirely ──
        ── Rule 2: Mutations present → show dominant key details + subordinate accordion ──
      */}
      {hasMutations && expanded && (
        <div className="space-y-1.5 border-t border-zinc-800 px-3 py-2">
          {/* Primary / dominant mutation detail */}
          <div className="flex items-baseline gap-2">
            <span className="w-12 shrink-0 text-[10px] uppercase tracking-wide text-zinc-500">change</span>
            <span className="font-mono text-[11px] text-zinc-200">{changeLabel}</span>
          </div>

          {/* Dominant key badge */}
          <div className="flex items-baseline gap-2">
            <span className="w-12 shrink-0 text-[10px] uppercase tracking-wide text-zinc-500">key</span>
            <span className="font-mono text-[10px] text-zinc-300">
              {dominantKey !== undefined && dominantValue != null && typeof dominantValue === "object" && "from" in dominantValue
                ? `${dominantKey}: ${Math.round(Number(dominantValue.from))} → ${Math.round(Number(dominantValue.to))}`
                : dominantKey}
            </span>
          </div>

          <div className="flex items-baseline gap-2">
            <span className="w-12 shrink-0 text-[10px] uppercase tracking-wide text-zinc-500">reason</span>
            <span className="text-[11px] text-zinc-300">{dominantReason}</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="w-12 shrink-0 text-[10px] uppercase tracking-wide text-zinc-500">impact</span>
            <span className="text-[11px] text-zinc-400">{dominantImpact}</span>
          </div>

          {/* In-flow subordinate accordion for lower-priority mutations */}
          <SubordinateAccordion mutations={subordinateMutations} />
        </div>
      )}


      {service.cgroups_injected ? (
        <footer className="flex items-center gap-2 border-t border-zinc-700 bg-zinc-800/50 px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
          <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Hard CGroups Kernel Limit Active</span>
        </footer>
      ) : null}
    </article>
  );
}


export default function Topology({ services = [] }) {
  const serviceList = Array.isArray(services) ? services : [];

  if (serviceList.length === 0) {
    return (
      <section className="flex min-h-64 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/50 p-8 text-center">
        <div>
          <Network className="mx-auto h-8 w-8 text-zinc-500" aria-hidden="true" />
          <h3 className="mt-3 text-sm font-medium text-zinc-200">No Infrastructure Analyzed</h3>
          <p className="mt-1 text-sm text-zinc-500">Run an analysis to render service topology.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="relative min-w-[800px] rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="grid grid-cols-3 gap-4">
        {COLUMN_DEFINITIONS.map((column) => {
          const columnServices = serviceList.filter((service) => column.tiers.includes(service.tier));

          return (
            <div key={column.title} className="space-y-3">
              <div className="rounded-md border border-zinc-800 bg-zinc-950/70 px-3 py-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                  {column.title}
                </h3>
              </div>

              {columnServices.length > 0 ? (
                columnServices.map((service) => (
                  <ServiceCard key={`${service.name}-${service.tier}`} service={service} />
                ))
              ) : (
                <div className="rounded-lg border border-dashed border-zinc-700 bg-zinc-950/40 px-3 py-8 text-center text-xs text-zinc-600">
                  Empty layer
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
