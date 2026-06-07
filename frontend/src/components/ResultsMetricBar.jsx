import { Activity, Gauge, HardDrive, Server } from "lucide-react";
import { STATUS_LABELS } from "../constants.js";
import { formatMetric } from "../utils.js";
import MetricCard from "./MetricCard.jsx";

export default function ResultsMetricBar({
  apiResponse,
  hardwareData,
  serviceCount,
  totalReplicas,
  statusTone,
}) {
  const metrics = apiResponse?.metrics || {};
  const ramMarginMb = Number(metrics.ram_margin_mb || 0);
  const finalPredictedMb = Number(metrics.final_predicted_ram_mb || 0);
  const freeRamMb = Number(hardwareData?.free_ram_mb || 0);
  const isAtRisk = ramMarginMb < 64;
  const isCaution = !isAtRisk && ramMarginMb >= 64 && ramMarginMb <= 256;
  const toneClass = isAtRisk ? "text-red-500" : isCaution ? "text-amber-400" : "text-green-400";
  const barColor = isAtRisk ? "bg-red-500" : isCaution ? "bg-amber-400" : "bg-green-500";
  const stackExceeds = finalPredictedMb >= freeRamMb;
  const displayMargin = Math.max(0, Math.round(ramMarginMb));
  const freeRamRound = Math.round(freeRamMb);
  const subtextBase = `${displayMargin} MB of ${freeRamRound} MB free`;
  const subtext = stackExceeds ? `${subtextBase} (stack exceeds available headroom)` : subtextBase;
  const fillPct = freeRamMb > 0 ? Math.min(100, (finalPredictedMb / freeRamMb) * 100) : 0;

  return (
    <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
      <MetricCard
        icon={Activity}
        label="Status"
        value={STATUS_LABELS[apiResponse.status] ?? apiResponse.status}
        detail={`${serviceCount} services / ${totalReplicas} instances`}
        tone={statusTone}
      />
      <MetricCard
        icon={Gauge}
        label="Initial Footprint"
        value={formatMetric(metrics.initial_predicted_ram_mb)}
        detail="Predicted before mutation"
      />
      <MetricCard
        icon={Server}
        label="Final Footprint"
        value={formatMetric(metrics.final_predicted_ram_mb)}
        detail="Predicted after optimization"
      />
      <MetricCard
        icon={HardDrive}
        label="Post-Allocation Memory"
        value={formatMetric(ramMarginMb)}
        detail={subtext}
        tone={toneClass}
        track={
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
            <div
              className={`h-full rounded-full transition-all duration-500 ${barColor}`}
              style={{ width: `${fillPct}%` }}
              aria-hidden="true"
            />
          </div>
        }
      />
    </div>
  );
}
