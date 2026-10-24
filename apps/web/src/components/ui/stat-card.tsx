import { Card } from "./card";

export function StatCard({
  label, value, delta, deltaTone = "up", icon, accent = "bg-brand-50 text-brand-600",
}: {
  label: string;
  value: string;
  delta: string;
  deltaTone?: "up" | "down";
  icon: string;
  accent?: string;
}) {
  return (
    <Card>
      <div className="flex items-start justify-between">
        <span aria-hidden="true" className={`flex h-12 w-12 items-center justify-center rounded-[14px] text-xl ${accent}`}>{icon}</span>
        <span className={`rounded-full px-2 py-1 text-xs font-medium ${deltaTone === "up" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
          {deltaTone === "up" ? "↑" : "↓"} {delta}
        </span>
      </div>
      <p className="mt-3 text-xs font-medium text-text-muted">{label}</p>
      <p className="font-mono text-2xl font-bold tabular-nums">{value}</p>
      <p aria-hidden="true" className="mt-2 text-xs text-text-subtle">▁▃▅▆▇ sparkline placeholder (chart in Step 6+)</p>
    </Card>
  );
}
