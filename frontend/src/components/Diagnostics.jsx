import { AlertTriangle, ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";

const SEVERITY = Object.freeze({
  AT_RISK: "AT_RISK",
  CAUTION: "CAUTION",
  SAFE:    "SAFE",
});

function computeSeverity(ramMarginMb, services) {
  const mb = Number(ramMarginMb || 0);
  const hasCgroups = services.some((s) => s.cgroups_injected);
  const hasAtFloor = services.some((s) => s.at_floor);

  if (mb < 64 || hasCgroups) return SEVERITY.AT_RISK;

  if (mb <= 256 || hasAtFloor) return SEVERITY.CAUTION;

  return SEVERITY.SAFE;
}

const SEVERITY_BADGE_META = {
  [SEVERITY.AT_RISK]: {
    label:   "At Risk",
    pill:    "border-red-500/40 bg-red-500/10 text-red-500",
    dot:     "bg-red-500",
  },
  [SEVERITY.CAUTION]: {
    label:   "Caution",
    pill:    "border-amber-500/40 bg-amber-500/10 text-amber-400",
    dot:     "bg-amber-400",
  },
  [SEVERITY.SAFE]: {
    label:   "Safe",
    pill:    "border-green-500/40 bg-green-500/10 text-green-500",
    dot:     "bg-green-500",
  },
};

function buildBannerCopy(severity, ramMarginMb, freeRamMb, services) {
  const mb = Math.max(0, Math.round(Number(ramMarginMb || 0)));
  const free = Math.round(Number(freeRamMb || 0));
  const hasCgroups = services.some((s) => s.cgroups_injected);

  if (severity === SEVERITY.CAUTION) {
    if (mb <= 256) {
      return `${mb} MB of ${free} MB free \u2014 below 256 MB threshold. Monitor stability under peak loads.`;
    }
    return `${mb} MB of ${free} MB free \u2014 running at minimum floor allocation. Monitor stability under peak loads.`;
  }
  if (severity === SEVERITY.AT_RISK) {
    if (mb < 64) {
      return `${mb} MB of ${free} MB free \u2014 critically below 64 MB threshold. Risk of OOM termination under load.`;
    }
    if (hasCgroups) {
      return `${mb} MB of ${free} MB free \u2014 hard kernel resource encapsulation is active through cgroups.`;
    }
  }
  return null;
}

const SEVERITY_BANNER_STYLE = {
  [SEVERITY.AT_RISK]: {
    className: "border-red-500/30 bg-red-500/8 text-red-400",
    iconClass: "text-red-500",
  },
  [SEVERITY.CAUTION]: {
    className: "border-amber-500/30 bg-amber-500/8 text-amber-300",
    iconClass: "text-amber-400",
  },
};

function classifyService(service) {
  if (service.cgroups_injected) return "critical";
  if (service.at_floor)         return "degraded";
  return "safe";
}

const ZONE_META = {
  critical: {
    label:       "Critical",
    badge:       "border-red-500/40 bg-red-500/10 text-red-500",
    dot:         "bg-red-500",
    Icon:        ShieldX,
    iconClass:   "text-red-500",
    explanation:
      "Subject to hard kernel memory caps and potential CPU throttling. " +
      "The container will be OOM-killed if it exceeds its cgroup limit.",
  },
  degraded: {
    label:       "Degraded",
    badge:       "border-zinc-600 bg-zinc-700/40 text-zinc-300",
    dot:         "bg-zinc-400",
    Icon:        ShieldAlert,
    iconClass:   "text-zinc-400",
    explanation:
      "Running at its minimum tunable configuration with no remaining " +
      "optimisation headroom. Further load increases cannot be absorbed.",
  },
  safe: {
    label:       "Safe",
    badge:       "border-green-500/40 bg-green-500/10 text-green-500",
    dot:         "bg-green-500",
    Icon:        ShieldCheck,
    iconClass:   "text-green-500",
    explanation:
      "Operating within budget with headroom remaining for the optimizer " +
      "to absorb additional load without cgroup intervention.",
  },
};

const MUTATION_DISPLAY_NAMES = {
  max_connections:  "Database Connections",
  WORKERS:          "Worker Threads",
  WEB_CONCURRENCY:  "Web Concurrency",
  maxmemory:        "Cache Memory Ceiling",
};

function generateServiceDescription(service) {
  const mutatedKeys = Object.keys(service.variables_mutated || {});

  const displayNames = mutatedKeys.map(
    (key) => MUTATION_DISPLAY_NAMES[key] ?? key,
  );

  if (displayNames.length === 0) {
    return "No changes applied. Allocation fits within budget at baseline.";
  }

  if (displayNames.length === 1) {
    return `${displayNames[0]} scaled down. Final allocation within budget.`;
  }

  let formattedList;
  if (displayNames.length === 2) {
    formattedList = `${displayNames[0]} and ${displayNames[1]}`;
  } else {
    const allButLast = displayNames.slice(0, -1).join(", ");
    const last       = displayNames[displayNames.length - 1];
    formattedList    = `${allButLast}, and ${last}`;
  }

  return `${formattedList} reduced to optimize host resource constraints.`;
}

function SeverityBadge({ severity }) {
  const { label, pill, dot } = SEVERITY_BADGE_META[severity];
  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-semibold ${pill}`}
    >
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${dot}`}
        aria-hidden="true"
      />
      Oversubscription Risk: {label}
    </div>
  );
}

function AdvisoryBanner({ severity, ramMarginMb, freeRamMb, services }) {
  const copy = buildBannerCopy(severity, ramMarginMb, freeRamMb, services);
  if (!copy) return null;

  const { className, iconClass } = SEVERITY_BANNER_STYLE[severity];
  return (
    <div className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-xs leading-5 ${className}`}>
      <AlertTriangle className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${iconClass}`} aria-hidden="true" />
      <span>{copy}</span>
    </div>
  );
}

function ServiceRow({ service }) {
  const zone = classifyService(service);
  const { label, badge, dot, Icon, iconClass } = ZONE_META[zone];

  return (
    <li className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-zinc-100">{service.name}</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {service.tier}
            {service.replicas > 1 && (
              <span className="ml-1 text-zinc-600">x {service.replicas}</span>
            )}
          </p>
        </div>        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${badge}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden="true" />
          {label}
        </span>
      </div>      <div className="mt-2 flex items-start gap-2">
        <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${iconClass}`} aria-hidden="true" />
        <p className="text-xs leading-5 text-zinc-400">{generateServiceDescription(service)}</p>
      </div>      <div className="mt-2 flex flex-wrap gap-3 text-[0.68rem] text-zinc-600">
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

export default function Diagnostics({ response }) {
  if (!response) return null;

  const services    = response.services ?? [];
  const ramMarginMb = response.metrics?.ram_margin_mb ?? 0;

  const severity = computeSeverity(ramMarginMb, services);

  const criticalCount = services.filter((s) => classifyService(s) === "critical").length;
  const degradedCount = services.filter((s) => classifyService(s) === "degraded").length;
  const safeCount     = services.filter((s) => classifyService(s) === "safe").length;

  return (
    <div className="space-y-4">

      <SeverityBadge severity={severity} />
      <AdvisoryBanner
        severity={severity}
        ramMarginMb={ramMarginMb}
        freeRamMb={response.metrics?.free_ram_mb ?? 0}
        services={services}
      />

      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        {[
          { count: criticalCount, label: "Critical", cls: "text-red-500"   },
          { count: degradedCount, label: "Degraded", cls: "text-zinc-300"  },
          { count: safeCount,     label: "Safe",     cls: "text-green-500" },
        ].map(({ count, label, cls }) => (
          <div
            key={label}
            className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-2 py-2"
          >
            <p className={`text-lg font-semibold ${cls}`}>{count}</p>
            <p className="text-zinc-500">{label}</p>
          </div>
        ))}
      </div>

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
