import { Database, HardDrive, Layers, Network, Server, ShieldAlert } from "lucide-react";

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
    badge: "border-blue-400/20 bg-blue-400/10 text-blue-300",
    iconShell: "bg-blue-400/10 text-blue-300",
  },
  cache: {
    icon: HardDrive,
    badge: "border-emerald-400/20 bg-emerald-400/10 text-emerald-300",
    iconShell: "bg-emerald-400/10 text-emerald-300",
  },
  backend_hybrid: {
    icon: Layers,
    badge: "border-violet-400/20 bg-violet-400/10 text-violet-300",
    iconShell: "bg-violet-400/10 text-violet-300",
  },
  backend_low_priority: {
    icon: Server,
    badge: "border-zinc-400/20 bg-zinc-400/10 text-zinc-300",
    iconShell: "bg-zinc-400/10 text-zinc-300",
  },
  frontend: {
    icon: Network,
    badge: "border-cyan-400/20 bg-cyan-400/10 text-cyan-300",
    iconShell: "bg-cyan-400/10 text-cyan-300",
  },
};

function formatRam(value) {
  return `${Math.round(Number(value || 0))}MB`;
}

function getCompressionPercent(service) {
  const initial = Number(service.initial_ram_mb || 0);
  const final = Number(service.final_ram_mb || 0);

  if (initial <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(100, (final / initial) * 100));
}

function ServiceCard({ service }) {
  const tierStyle = TIER_STYLES[service.tier] || TIER_STYLES.backend_low_priority;
  const TierIcon = tierStyle.icon;
  const initialRam = Number(service.initial_ram_mb || 0);
  const finalRam = Number(service.final_ram_mb || 0);
  const isMutated = Math.round(initialRam) !== Math.round(finalRam);
  const compressionPercent = getCompressionPercent(service);
  const barClass = service.cgroups_injected
    ? "bg-gradient-to-r from-amber-500 to-orange-300"
    : isMutated
      ? "bg-amber-400"
      : "bg-emerald-400";

  return (
    <article className="overflow-hidden rounded-lg border border-slate-800 bg-zinc-950/80 shadow-sm shadow-black/20">
      <div className="space-y-4 p-3">
        <header className="flex items-start gap-3">
          <div className={`rounded-md p-2 ${tierStyle.iconShell}`}>
            <TierIcon className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h4 className="truncate text-sm font-medium text-zinc-100">{service.name}</h4>
              <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">
                x{service.replicas || 1}
              </span>
            </div>
            <span
              className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${tierStyle.badge}`}
            >
              {service.tier}
            </span>
          </div>
        </header>

        <div>
          <div className="mb-2 flex items-center justify-between font-mono text-xs">
            <span className="text-zinc-500">memory</span>
            <span>
              {isMutated ? (
                <>
                  <span className="text-zinc-600 line-through">{formatRam(initialRam)}</span>
                  <span className="px-1 text-zinc-600">-&gt;</span>
                  <span className="text-amber-300">{formatRam(finalRam)}</span>
                </>
              ) : (
                <span className="text-emerald-300">{formatRam(finalRam)}</span>
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

      {service.cgroups_injected ? (
        <footer className="flex items-center gap-2 border-t border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-amber-300">
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
      <section className="flex min-h-64 items-center justify-center rounded-xl border border-slate-800 bg-zinc-900/50 p-8 text-center">
        <div>
          <Network className="mx-auto h-8 w-8 text-zinc-500" aria-hidden="true" />
          <h3 className="mt-3 text-sm font-medium text-zinc-200">No Infrastructure Analyzed</h3>
          <p className="mt-1 text-sm text-zinc-500">Run an analysis to render service topology.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="relative min-w-[800px] rounded-xl border border-slate-800 bg-zinc-900/50 p-4">
      <div className="grid grid-cols-3 gap-4">
        {COLUMN_DEFINITIONS.map((column) => {
          const columnServices = serviceList.filter((service) => column.tiers.includes(service.tier));

          return (
            <div key={column.title} className="space-y-3">
              <div className="rounded-md border border-slate-800 bg-slate-950/70 px-3 py-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                  {column.title}
                </h3>
              </div>

              {columnServices.length > 0 ? (
                columnServices.map((service) => (
                  <ServiceCard key={`${service.name}-${service.tier}`} service={service} />
                ))
              ) : (
                <div className="rounded-lg border border-dashed border-slate-800 bg-zinc-950/40 px-3 py-8 text-center text-xs text-zinc-600">
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
