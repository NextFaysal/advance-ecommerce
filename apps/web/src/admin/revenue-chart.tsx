"use client";

// Revenue area chart + KPI sparklines for the admin dashboard home.
// Data comes from DashboardData.dailySeries (src/reports/dashboard.ts):
// REAL daily revenue/order counts bucketed from the same order-item
// rows and status filter as the period totals, so the chart always
// agrees with the KPI numbers beside it. This file is a client
// component ONLY for the hover crosshair — it receives plain
// serializable data props (arrays/numbers/strings) from the server
// page, never functions.
import { useRef, useState, type MouseEvent } from "react";
import { formatPoisha } from "@/components/ui/money";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, intlLocale, pick } from "@/i18n/locale";
import { ADMIN_STRINGS } from "@/admin/strings";
import type { DashboardDailyPoint } from "@/reports/dashboard";

const W = 720;
const H = 240;
const PAD_L = 10;
const PAD_R = 10;
const PAD_T = 16;
const PAD_B = 26;
const PLOT_W = W - PAD_L - PAD_R;
const PLOT_H = H - PAD_T - PAD_B;


function dayDate(yyyyMmDd: string): Date {
  // Dhaka calendar date — anchor at Dhaka midnight so Intl formats the
  // intended day regardless of the viewer's timezone.
  return new Date(`${yyyyMmDd}T00:00:00+06:00`);
}

/** Tick labels drop the ".00" poisha tail to stay compact. */
function tickLabel(poisha: number): string {
  return formatPoisha(poisha).replace(/\.00$/, "");
}

export function RevenueChart({ data }: { data: DashboardDailyPoint[] }) {
  const { locale } = useLocale();
  const s = pick(locale, ADMIN_STRINGS);
  const dayLabelFmt = new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", month: "short" });
  const fullDayFmt = new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", month: "long", year: "numeric" });
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const max = Math.max(0, ...data.map((d) => d.revenuePoisha));
  const hasSales = max > 0;
  const stepX = data.length > 1 ? PLOT_W / (data.length - 1) : PLOT_W;
  const x = (i: number) => PAD_L + i * stepX;
  const y = (v: number) => PAD_T + PLOT_H - (max > 0 ? (v / max) * PLOT_H : 0);
  const baseY = PAD_T + PLOT_H;

  const linePath = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d.revenuePoisha).toFixed(1)}`).join(" ");
  const areaPath = hasSales ? `${linePath} L${x(data.length - 1).toFixed(1)},${baseY} L${x(0).toFixed(1)},${baseY} Z` : "";
  const ticks = [0, 1 / 3, 2 / 3, 1];

  function onMove(e: MouseEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const vx = ((e.clientX - rect.left) / rect.width) * W;
    const idx = Math.round((vx - PAD_L) / stepX);
    setHover(Math.max(0, Math.min(data.length - 1, idx)));
  }

  const hoverPoint = hover !== null ? data[hover] : undefined;

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="block h-auto w-full text-text-subtle"
        role="img"
        aria-label={interpolate(s.chartAria, { max: hasSales ? formatPoisha(max) : s.chartZero })}
        onMouseMove={hasSales ? onMove : undefined}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="rev-area-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6366F1" stopOpacity="0.32" />
            <stop offset="60%" stopColor="#8B5CF6" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#EC4899" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Gridlines + y tick labels */}
        {ticks.map((f) => {
          const gy = PAD_T + PLOT_H - f * PLOT_H;
          return (
            <g key={f}>
              <line x1={PAD_L} x2={W - PAD_R} y1={gy} y2={gy} stroke="currentColor" strokeOpacity="0.18" strokeDasharray={f === 0 ? undefined : "3 4"} />
              <text x={PAD_L + 2} y={gy - 4} fontSize="10" fill="currentColor">
                {tickLabel(Math.round(max * f))}
              </text>
            </g>
          );
        })}

        {/* X day labels — every 7th day plus the last (today). */}
        {data.map((d, i) =>
          i % 7 === 0 || i === data.length - 1 ? (
            <text
              key={d.date}
              x={x(i)}
              y={H - 8}
              fontSize="10"
              fill="currentColor"
              textAnchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"}
            >
              {dayLabelFmt.format(dayDate(d.date))}
            </text>
          ) : null,
        )}

        {hasSales ? (
          <>
            <path d={areaPath} fill="url(#rev-area-gradient)" />
            <path d={linePath} fill="none" stroke="#4F46E5" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          </>
        ) : (
          <line x1={PAD_L} x2={W - PAD_R} y1={baseY} y2={baseY} stroke="#4F46E5" strokeWidth="2" strokeOpacity="0.4" />
        )}

        {/* Hover crosshair */}
        {hoverPoint && hover !== null ? (
          <g aria-hidden="true">
            <line x1={x(hover)} x2={x(hover)} y1={PAD_T} y2={baseY} stroke="#4F46E5" strokeOpacity="0.35" />
            <circle cx={x(hover)} cy={y(hoverPoint.revenuePoisha)} r="4.5" fill="#4F46E5" stroke="#fff" strokeWidth="2" />
          </g>
        ) : null}
      </svg>

      {hoverPoint && hover !== null ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-0 z-10 rounded-md bg-text-main px-2.5 py-1.5 text-caption leading-snug text-white shadow-pop"
          style={{
            left: `${(x(hover) / W) * 100}%`,
            transform: `translateX(${hover <= 2 ? "0%" : hover >= data.length - 3 ? "-100%" : "-50%"})`,
          }}
        >
          <p className="font-semibold">{fullDayFmt.format(dayDate(hoverPoint.date))}</p>
          <p className="font-mono tabular-nums">{interpolate(s.chartSales, { amount: formatPoisha(hoverPoint.revenuePoisha) })}</p>
          <p className="tabular-nums">{interpolate(s.chartOrders, { count: hoverPoint.orders })}</p>
        </div>
      ) : null}

      {!hasSales ? (
        <p className="py-2 text-center text-small text-text-muted">
          {s.chartEmpty}
        </p>
      ) : null}
    </div>
  );
}

/** Tiny trend line for KPI cards — plain number[] in, SVG out. */
export function Sparkline({
  values,
  stroke = "#6366F1",
  width = 104,
  height = 30,
}: {
  values: number[];
  stroke?: string;
  width?: number;
  height?: number;
}) {
  if (values.length === 0) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min;
  const stepX = values.length > 1 ? width / (values.length - 1) : width;
  const py = (v: number) => (span > 0 ? height - 3 - ((v - min) / span) * (height - 6) : height / 2);
  const points = values.map((v, i) => `${(i * stepX).toFixed(1)},${py(v).toFixed(1)}`);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${p}`).join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true" className="shrink-0">
      <path d={`${line} L${width},${height} L0,${height} Z`} fill={stroke} fillOpacity="0.12" stroke="none" />
      <path d={line} fill="none" stroke={stroke} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
