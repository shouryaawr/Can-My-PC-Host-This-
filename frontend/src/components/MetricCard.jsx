export default function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  tone = "text-zinc-100",
  track,
}) {
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</span>
        {Icon ? <Icon className="h-4 w-4 text-zinc-500" aria-hidden="true" /> : null}
      </div>
      <div className={`mt-3 text-2xl font-semibold ${tone}`}>{value}</div>
      {detail ? <p className="mt-1 text-xs text-zinc-500">{detail}</p> : null}
      {track ?? null}
    </section>
  );
}
