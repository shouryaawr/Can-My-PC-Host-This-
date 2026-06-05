import { AlertTriangle, CheckCircle2, ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";

/* ─── zone classification ─── */

function classifyService(service) {
  if (service.cgroups_injected) return "critical";
  if (service.at_floor)         return "degraded";
  return "safe";
}

function deriveOverallRisk(services) {
  const zones = services.map(classifyService);
  if (zones.includes("critical")) return "critical";
  if (zones.includes("degraded")) return "degraded";
  return "safe";
}

/* ─── static lookup tables ─── */

const ZONE_META = {
  critical: {
    label: "Critical",
    badge:
      "border-rose-400/40 bg-rose-400/10 text-rose-300",
    dot: "bg-rose-400",
    Icon: ShieldX,
    iconClass: "text-rose-400",
    explanation:
      "Subject to hard kernel memory caps and potential CPU throttling. " +
      "The container will be OOM-killed if it exceeds its cgroup limit.",
  },
  degraded: {
    label: "Degraded",
    badge:
      "border-amber-400/40 bg-amber-400/10 text-amber-300",
    dot: "bg-amber-400",
    Icon: ShieldAlert,
    iconClass: "text-amber-400",
    explanation:
      "Running at its minimum tunable configuration with no remaining " +
      "optimisation headroom. Further load increases cannot be absorbed.",
  },
  safe: {
    label: "Safe",
    badge:
      "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
    dot: "bg-emerald-400",
    Icon: ShieldCheck,
    iconClass: "text-emerald-400",
    explanation:
      "Operating within budget with headroom remaining for the optimizer " +
      "to absorb additional load without cgroup intervention.",
  },
};

const OVERALL_META = {
  critical: {
    label: "Critical — Oversubscribed",
    className: "border-rose-400/40 bg-rose-400/10 text-rose-300",
    Icon: ShieldX,
  },
  degraded: {
    label: "Degraded — No Headroom",
    className: "border-amber-400/40 bg-amber-400/10 text-amber-300",
    Icon: ShieldAlert,
  },
  safe: {
    label: "Safe — Within Budget",
    className: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
    Icon: ShieldCheck,
  },
};

/* ─── sub-components ─── */

function OverallBadge({ risk }) {
  const { label, className, Icon } = OVERALL_META[risk];
  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-semibold ${className}`}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      Oversubscription Risk: {label}
    </div>
  );
}

function HeadroomBadge({ ramMarginMb }) {
  const mb = Number(ramMarginMb || 0);
  const isLow = mb < 256;
  return (
    <div
      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
        isLow
          ? "border-amber-400/30 bg-amber-400/8 text-amber-300"
          : "border-slate-700 bg-zinc-900/60 text-zinc-400"
      }`}
    >
      {isLow ? (
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" />
      ) : (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
      )}
      <span>
        <span className="font-medium text-zinc-200">
          {Math.round(mb).toLocaleString()} MB
        </span>{" "}
        RAM headroom remaining
        {isLow && (
          <span className="ml-1 text-amber-300/80">— below 256 MB threshold</span>
        )}
      </span>
    </div>
  );
}

function ServiceRow({ service }) {
  const zone = classifyService(service);
  const { label, badge, dot, Icon, iconClass, explanation } = ZONE_META[zone];

  return (
    <li className="rounded-lg border border-slate-800 bg-zinc-950/60 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        {/* Name + tier */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-zinc-100">{service.name}</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {service.tier}
            {service.replicas > 1 && (
              <span className="ml-1 text-zinc-600">× {service.replicas}</span>
            )}
          </p>
        </div>

        {/* Zone badge */}
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${badge}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden="true" />
          {label}
        </span>
      </div>

      {/* Explanation */}
      <div className="mt-2 flex items-start gap-2">
        <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${iconClass}`} aria-hidden="true" />
        <p className="text-xs leading-5 text-zinc-400">{explanation}</p>
      </div>

      {/* Mini stats */}
      <div className="mt-2 flex flex-wrap gap-3 text-[0.68rem] text-zinc-600">
        <span>
          Final RAM:{" "}
          <span className="font-mono text-zinc-400">
            {Math.round(service.final_ram_mb).toLocaleString()} MB
          </span>
        </span>
        {Object.keys(service.variables_mutated || {}).length > 0 && (
          <span>
            Mutations:{" "}
            <span className="font-mono text-zinc-400">
              {Object.keys(service.variables_mutated).join(", ")}
            </span>
          </span>
        )}
      </div>
    </li>
  );
}

/* ─── main component ─── */

export default function Diagnostics({ response }) {
  if (!response) return null;

  const services = response.services ?? [];
  const overallRisk = deriveOverallRisk(services);
  const ramMarginMb = response.metrics?.ram_margin_mb ?? 0;

  const criticalCount = services.filter((s) => classifyService(s) === "critical").length;
  const degradedCount = services.filter((s) => classifyService(s) === "degraded").length;
  const safeCount     = services.filter((s) => classifyService(s) === "safe").length;

  return (
    <div className="space-y-4">
      {/* ── Header: overall badge + headroom ── */}
      <div className="space-y-2">
        <OverallBadge risk={overallRisk} />
        <HeadroomBadge ramMarginMb={ramMarginMb} />
      </div>

      {/* ── Summary counters ── */}
      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        {[
          { count: criticalCount, label: "Critical", cls: "text-rose-300" },
          { count: degradedCount, label: "Degraded", cls: "text-amber-300" },
          { count: safeCount,     label: "Safe",     cls: "text-emerald-300" },
        ].map(({ count, label, cls }) => (
          <div
            key={label}
            className="rounded-lg border border-slate-800 bg-zinc-950/50 px-2 py-2"
          >
            <p className={`text-lg font-semibold ${cls}`}>{count}</p>
            <p className="text-zinc-500">{label}</p>
          </div>
        ))}
      </div>

      {/* ── Per-service breakdown ── */}
      {services.length > 0 ? (
        <ul className="space-y-2">
          {services.map((service) => (
            <ServiceRow key={service.name} service={service} />
          ))}
        </ul>
      ) : (
        <p className="py-6 text-center text-sm text-zinc-500">
          No service data available.
        </p>
      )}
    </div>
  );
}
