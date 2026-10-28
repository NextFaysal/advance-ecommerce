import type { ReactNode } from "react";

export type TableColumn = { key: string; header: string };
export type TableRow = Record<string, ReactNode>;

/**
 * DataTable (Design System v4, doc 31 D3) — sticky header on the
 * surface-2 step, brand-soft row hover, and a `density` option
 * ("comfortable" default, "compact" for dense admin lists).
 * New in v4 (additive): `selectedIndex` marks one row with the
 * brand-soft selected state + aria-selected. API otherwise unchanged.
 */
export function DataTable({
  columns,
  rows,
  caption,
  density = "comfortable",
  selectedIndex,
}: {
  columns: TableColumn[];
  rows: TableRow[];
  caption?: string;
  density?: "comfortable" | "compact";
  selectedIndex?: number;
}) {
  const cellPad = density === "compact" ? "px-4 py-2" : "px-4 py-3";
  return (
    <div className="overflow-x-auto rounded-2xl border border-border/60 bg-card shadow-xs">
      <table className="w-full text-sm">
        {caption ? <caption className="p-4 pb-1 text-left font-display text-base font-semibold text-text-main">{caption}</caption> : null}
        <thead>
          <tr className="bg-surface-2/80 text-left">
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className="sticky top-0 z-10 bg-surface-2 px-4 py-3 text-xs font-semibold text-text-muted shadow-[0_1px_0_hsl(var(--border))]"
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const selected = selectedIndex === i;
            return (
              <tr
                key={i}
                aria-selected={selected || undefined}
                className={`border-t border-border/60 transition duration-fast ease-smooth last:border-b-0 ${
                  selected ? "bg-brand-soft" : "hover:bg-brand-soft/60"
                }`}
              >
                {columns.map((c) => (
                  <td key={c.key} className={cellPad}>
                    {row[c.key]}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {/* Mobile card fallback is handled by screens; this table scrolls horizontally under 768px. */}
    </div>
  );
}

/**
 * DataTableSkeleton (v4, additive) — the DataTable shell (same rounded
 * frame + sticky-header band) filled with shimmer bars, for list pages
 * that render DataTable once data lands. `SkeletonTable` in
 * skeleton.tsx remains the generic variant.
 */
export function DataTableSkeleton({
  columns = 4,
  rows = 5,
  density = "comfortable",
}: {
  columns?: number;
  rows?: number;
  density?: "comfortable" | "compact";
}) {
  const cellPad = density === "compact" ? "px-4 py-2" : "px-4 py-3";
  return (
    <div className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-xs" aria-hidden="true">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-surface-2/80 text-left">
            {Array.from({ length: columns }).map((_, i) => (
              <th key={i} scope="col" className="bg-surface-2 px-4 py-3">
                <span className="skeleton-shimmer block h-3 w-16 rounded-md" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r} className="border-t border-border/60">
              {Array.from({ length: columns }).map((_, c) => (
                <td key={c} className={cellPad}>
                  <span className={`skeleton-shimmer block h-4 rounded-md ${c === 0 ? "w-3/4" : "w-1/2"}`} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
