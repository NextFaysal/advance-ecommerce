import { useId } from "react";

/**
 * ChartKit (Design System v4, doc 31 D3) — presentational inline-SVG
 * charts: AreaChart, BarChart, DonutChart, Sparkline. No chart library,
 * no dependencies; all colours ride the chart-1..5 CSS-var tokens, so
 * every chart flips with `.dark` automatically.
 *
 * Data contract: plain numbers (+ optional PRE-FORMATTED label strings).
 * Number formatting lives with the caller (locale/numerals aware), so
 * the kit itself is bn/en-agnostic. These are pure components — safe in
 * server and client trees (no hooks except useId for gradient ids).
 *
 * Sizing: charts stretch to their container width (viewBox + width
 * 100%); `height` sets the rendered height in px. Pass `ariaLabel` for
 * a role="img" description; without one the SVG is aria-hidden.
 */

export type ChartColorIndex = 1 | 2 | 3 | 4 | 5;

const CHART_VAR: Record<ChartColorIndex, string> = {
  1: "var(--c-chart-1)",
  2: "var(--c-chart-2)",
  3: "var(--c-chart-3)",
  4: "var(--c-chart-4)",
  5: "var(--c-chart-5)",
};

const CHART_CLASS: Record<ChartColorIndex, { stroke: string; fill: string }> = {
  1: { stroke: "stroke-chart-1", fill: "fill-chart-1" },
  2: { stroke: "stroke-chart-2", fill: "fill-chart-2" },
  3: { stroke: "stroke-chart-3", fill: "fill-chart-3" },
  4: { stroke: "stroke-chart-4", fill: "fill-chart-4" },
  5: { stroke: "stroke-chart-5", fill: "fill-chart-5" },
};

function chartIndex(i: number): ChartColorIndex {
  return ((i % 5) + 1) as ChartColorIndex;
}

function a11y(ariaLabel?: string): Record<string, string | boolean> {
  return ariaLabel ? { role: "img", "aria-label": ariaLabel } : { "aria-hidden": true };
}

/** Map values to [x, y] points inside a w×h box with padding. Flat or
 *  single-value series render as a level mid-height line. */
function toPoints(data: number[], w: number, h: number, padX: number, padY: number): Array<[number, number]> {
  if (data.length === 0) return [];
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min;
  const innerW = w - padX * 2;
  const innerH = h - padY * 2;
  return data.map((v, i) => {
    const x = data.length === 1 ? w / 2 : padX + (i / (data.length - 1)) * innerW;
    const y = range === 0 ? h / 2 : padY + (1 - (v - min) / range) * innerH;
    return [x, y];
  });
}

/** Polyline path with light Catmull-Rom smoothing (rounded line joins
 *  keep it safe for sharp series). */
function smoothPath(points: Array<[number, number]>): string {
  if (points.length < 2) return points.length === 1 ? `M ${points[0]![0]} ${points[0]![1]}` : "";
  let d = `M ${points[0]![0]} ${points[0]![1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[Math.min(points.length - 1, i + 2)]!;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2[0]} ${p2[1]}`;
  }
  return d;
}

/* ------------------------------------------------------------------ */
/* Sparkline — the StatCard slot filler                                */
/* ------------------------------------------------------------------ */

export function Sparkline({
  data,
  color = 1,
  height = 36,
  filled = true,
  strokeWidth = 2,
  ariaLabel,
  className = "",
}: {
  data: number[];
  color?: ChartColorIndex;
  height?: number;
  filled?: boolean;
  strokeWidth?: number;
  ariaLabel?: string;
  className?: string;
}) {
  const W = 120;
  const rawId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const gradientId = `spark-${rawId}`;
  const points = toPoints(data, W, height, strokeWidth, strokeWidth + 1);
  const line = smoothPath(points);
  const area = points.length > 1 ? `${line} L ${points[points.length - 1]![0]} ${height} L ${points[0]![0]} ${height} Z` : "";
  const cls = CHART_CLASS[color];
  return (
    <svg
      viewBox={`0 0 ${W} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      className={className}
      {...a11y(ariaLabel)}
    >
      {filled && area ? (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style={{ stopColor: `rgb(${CHART_VAR[color]})`, stopOpacity: 0.3 }} />
              <stop offset="100%" style={{ stopColor: `rgb(${CHART_VAR[color]})`, stopOpacity: 0.02 }} />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${gradientId})`} stroke="none" />
        </>
      ) : null}
      {line ? (
        <path
          d={line}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          className={cls.stroke}
        />
      ) : null}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* AreaChart — dashboard trend chart                                   */
/* ------------------------------------------------------------------ */

export function AreaChart({
  data,
  labels,
  color = 1,
  height = 180,
  showGrid = true,
  ariaLabel,
  className = "",
}: {
  data: number[];
  /** Pre-formatted axis labels (sparse is fine — they space evenly). */
  labels?: string[];
  color?: ChartColorIndex;
  height?: number;
  showGrid?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  const W = 640;
  const H = 200;
  const rawId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const gradientId = `area-${rawId}`;
  const points = toPoints(data, W, H, 4, 10);
  const line = smoothPath(points);
  const area = points.length > 1 ? `${line} L ${points[points.length - 1]![0]} ${H} L ${points[0]![0]} ${H} Z` : "";
  const last = points[points.length - 1];
  const cls = CHART_CLASS[color];
  return (
    <div className={className}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={height} preserveAspectRatio="none" {...a11y(ariaLabel)}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: `rgb(${CHART_VAR[color]})`, stopOpacity: 0.32 }} />
            <stop offset="100%" style={{ stopColor: `rgb(${CHART_VAR[color]})`, stopOpacity: 0.02 }} />
          </linearGradient>
        </defs>
        {showGrid
          ? [0.25, 0.5, 0.75, 1].map((f) => (
              <line
                key={f}
                x1="0"
                x2={W}
                y1={H * f}
                y2={H * f}
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
                className="stroke-border"
              />
            ))
          : null}
        {area ? <path d={area} fill={`url(#${gradientId})`} stroke="none" /> : null}
        {line ? (
          <path
            d={line}
            fill="none"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            className={cls.stroke}
          />
        ) : null}
        {last ? <circle cx={last[0]} cy={last[1]} r="4" className={`${cls.fill} stroke-surface`} strokeWidth="2" /> : null}
      </svg>
      {labels && labels.length > 0 ? (
        <div className="mt-2 flex justify-between gap-2" aria-hidden="true">
          {labels.map((l, i) => (
            <span key={i} className="text-caption text-text-subtle">
              {l}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* BarChart — categorical bars with rounded tops                       */
/* ------------------------------------------------------------------ */

export function BarChart({
  data,
  labels,
  color = 1,
  height = 180,
  ariaLabel,
  className = "",
}: {
  data: number[];
  labels?: string[];
  color?: ChartColorIndex;
  height?: number;
  ariaLabel?: string;
  className?: string;
}) {
  const W = 640;
  const H = 200;
  const max = Math.max(...data, 0);
  const slot = data.length > 0 ? W / data.length : W;
  const barW = Math.min(44, slot * 0.58);
  const cls = CHART_CLASS[color];
  return (
    <div className={className}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={height} preserveAspectRatio="none" {...a11y(ariaLabel)}>
        <line x1="0" x2={W} y1={H - 1} y2={H - 1} strokeWidth="1" vectorEffect="non-scaling-stroke" className="stroke-border" />
        {data.map((v, i) => {
          const h = max > 0 ? Math.max(2, (v / max) * (H - 12)) : 2;
          const x = i * slot + (slot - barW) / 2;
          return (
            <rect
              key={i}
              x={x}
              y={H - h}
              width={barW}
              height={h}
              rx={Math.min(6, barW / 2)}
              className={`${cls.fill} opacity-85`}
            />
          );
        })}
      </svg>
      {labels && labels.length > 0 ? (
        <div className="mt-2 flex" aria-hidden="true">
          {labels.map((l, i) => (
            <span key={i} className="flex-1 truncate text-center text-caption text-text-subtle">
              {l}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* DonutChart — share ring with legend                                 */
/* ------------------------------------------------------------------ */

export type DonutSlice = {
  label: string;
  value: number;
  /** Pre-formatted value for the legend (default: the raw number). */
  displayValue?: string;
};

export function DonutChart({
  data,
  size = 168,
  thickness = 24,
  centerLabel,
  centerSubLabel,
  ariaLabel,
  className = "",
}: {
  data: DonutSlice[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerSubLabel?: string;
  ariaLabel?: string;
  className?: string;
}) {
  const total = data.reduce((sum, d) => sum + Math.max(0, d.value), 0);
  const r = (size - thickness) / 2;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  let offset = 0;
  const segments = data.map((d, i) => {
    const frac = total > 0 ? Math.max(0, d.value) / total : 0;
    const seg = { slice: d, index: i, frac, dashOffset: -offset * circumference, dashLength: frac * circumference };
    offset += frac;
    return seg;
  });
  return (
    <div className={`flex flex-wrap items-center gap-5 ${className}`}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} {...a11y(ariaLabel)}>
          <circle cx={c} cy={c} r={r} fill="none" strokeWidth={thickness} className="stroke-surface-2" />
          {total > 0
            ? segments
                .filter((seg) => seg.frac > 0)
                .map((seg) => (
                  <circle
                    key={seg.index}
                    cx={c}
                    cy={c}
                    r={r}
                    fill="none"
                    strokeWidth={thickness}
                    strokeDasharray={`${Math.max(0, seg.dashLength - 2)} ${circumference}`}
                    strokeDashoffset={seg.dashOffset}
                    transform={`rotate(-90 ${c} ${c})`}
                    className={CHART_CLASS[chartIndex(seg.index)].stroke}
                  />
                ))
            : null}
        </svg>
        {centerLabel ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="tnum text-kpi leading-none text-text-main">{centerLabel}</span>
            {centerSubLabel ? <span className="mt-1 text-caption text-text-muted">{centerSubLabel}</span> : null}
          </div>
        ) : null}
      </div>
      <ul className="min-w-[140px] flex-1 space-y-2">
        {data.map((d, i) => (
          <li key={i} className="flex items-center gap-2 text-sm">
            <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-[4px] ${CHART_CLASS[chartIndex(i)].fill}`} />
            <span className="min-w-0 flex-1 truncate text-text-muted">{d.label}</span>
            <span className="tnum font-semibold text-text-main">{d.displayValue ?? String(d.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
