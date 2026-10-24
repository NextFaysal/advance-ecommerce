import type { ReactNode } from "react";
import { Card } from "./card";
import { Icon } from "./icon";

/**
 * StatCard (Design System v2) — KPI tile with icon chip, delta chip and
 * an optional `sparkline` slot (pass any chart node; rendered under the
 * value, replacing the old text placeholder). `icon` now accepts any
 * ReactNode — pass <Icon name="chart" size={22} /> for the v2 look;
 * plain strings (v1 call sites) still render in the tile.
 */
export function StatCard({
  label,
  value,
  delta,
  deltaTone = "up",
  icon,
  accent = "bg-brand-50 text-brand-600",
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
    <Card className="transition motion-base hover:shadow-lift">
      <div className="flex items-start justify-between gap-3">
        <span aria-hidden="true" className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] text-xl shadow-sm ${accent}`}>{icon}</span>
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold leading-none ring-1 ring-inset ring-black/5 ${deltaTone === "up" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
          <Icon name={deltaTone === "up" ? "trend-up" : "trend-down"} size={13} />
          {delta}
        </span>
      </div>
      <p className="mt-4 text-xs font-medium text-text-muted">{label}</p>
      <p className="mt-0.5 font-mono text-[1.7rem] font-bold leading-9 tabular-nums text-text-main">{value}</p>
      {sparkline ? <div className="mt-3">{sparkline}</div> : null}
    </Card>
  );
}
