import type { ReactNode } from "react";
import { Card } from "./card";
import { Icon } from "./icon";

/**
 * StatCard (Design System v4, doc 31 D3) — KPI tile with icon chip, delta
 * chip and an optional `sparkline` slot (pass any chart node — e.g. the
 * chart kit's <Sparkline> — rendered under the value; nothing renders
 * when the slot is absent). `icon` accepts any ReactNode — pass
 * <Icon name="chart" size={22} /> for the standard look; plain strings
 * (v1 call sites) still render in the tile. The value renders at the
 * v4 `text-kpi` step with tabular numerals.
 */
export function StatCard({
  label,
  value,
  delta,
  deltaTone = "up",
  icon,
  accent = "bg-brand-soft text-brand-ink",
  sparkline,
}: {
  label: string;
  value: string;
  delta: string;
  deltaTone?: "up" | "down";
  icon: ReactNode;
  accent?: string;
  sparkline?: ReactNode;
}) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <span aria-hidden="true" className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-xl shadow-xs ${accent}`}>{icon}</span>
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold leading-none ring-1 ring-inset ring-black/5 dark:ring-white/10 ${deltaTone === "up" ? "bg-success-soft text-success-solid" : "bg-danger-soft text-danger"}`}>
          <Icon name={deltaTone === "up" ? "trend-up" : "trend-down"} size={13} />
          {delta}
        </span>
      </div>
      <p className="mt-4 text-xs font-medium text-text-muted">{label}</p>
      <p className="tnum mt-0.5 text-kpi text-text-main">{value}</p>
      {sparkline ? <div className="mt-3">{sparkline}</div> : null}
    </Card>
  );
}
