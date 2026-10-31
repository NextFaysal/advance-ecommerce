import type { ReactNode } from "react";

export type TableColumn = {
  key: string;
  header: string;
  /**
   * Doc 35 wave 3: `"numeric"` right-aligns the column and applies
   * tabular numerals (`tnum`) to header and cells, so money and count
   * columns align on the digit. Omit (or `"left"`) for the historical
   * left-aligned behaviour — existing callers are untouched.
   */
  align?: "left" | "numeric";
};
export type TableRow = Record<string, ReactNode>;

/**
 * DataTable (Design System v4, doc 31 D3) — sticky header on the
 * surface-2 step, brand-soft row hover, and a `density` option
 * ("comfortable" default, "compact" for dense admin lists).
 * New in v4 (additive): `selectedIndex` marks one row with the
 * brand-soft selected state + aria-selected. API otherwise unchanged.
 *
 * Doc 35 wave 3 (additive): columns may declare `align: "numeric"`,
 * and the component now renders its own mobile card list under the
 * md breakpoint (label/value rows driven by the same columns/rows),
 * so screens no longer hand-roll a card fallback or ship a sideways-
 * scrolling table on phones. The desktop table is unchanged above md.
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
  const alignCls = (c: TableColumn) => (c.align === "numeric" ? "tnum text-right" : "");
  return (
    <>
      {/* Desktop / tablet — the table itself (unchanged above md). */}
      <div className="hidden overflow-x-auto rounded-2xl border border-border/60 bg-card shadow-xs md:block">
        <table className="w-full text-sm">
          {caption ? <caption className="p-4 pb-1 text-left font-display text-base font-semibold text-text-main">{caption}</caption> : null}
          <thead>
            <tr className="bg-surface-2/80 text-left">
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={`sticky top-0 z-10 bg-surface-2 px-4 py-3 text-xs font-semibold text-text-muted shadow-[0_1px_0_hsl(var(--border))] ${alignCls(c)}`}
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
                    <td key={c.key} className={`${cellPad} ${alignCls(c)}`}>
                      {row[c.key]}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Phone — built-in card rendering (doc 35 wave 3): one card per
          row, each column as a label/value pair; numeric values keep
          their tabular, right-aligned treatment. */}
      <div className="space-y-3 md:hidden">
        {caption ? <p className="font-display text-base font-semibold text-text-main">{caption}</p> : null}
        {rows.map((row, i) => {
          const selected = selectedIndex === i;
          return (
            <div
              key={i}
              aria-selected={selected || undefined}
              className={`rounded-2xl border border-border/60 p-4 shadow-xs ${
                selected ? "bg-brand-soft" : "bg-card"
              }`}
            >
              <dl>
                {columns.map((c) => (
                  <div key={c.key} className="flex items-baseline justify-between gap-4 py-1 first:pt-0 last:pb-0">
                    <dt className="shrink-0 text-xs font-semibold text-text-muted">{c.header}</dt>
                    <dd className={`min-w-0 text-right text-sm ${c.align === "numeric" ? "tnum" : ""}`}>{row[c.key]}</dd>
                  </div>
                ))}
              </dl>
            </div>
          );
        })}
      </div>
    </>
  );
}

/**
 * DataTableSkeleton (v4, additive) — the DataTable shell (same rounded
 * frame + sticky-header band) filled with shimmer bars, for list pages
 * that render DataTable once data lands. `SkeletonTable` in
 * skeleton.tsx remains the generic variant.
 *
 * Doc 35 wave 3: mirrors the real component's responsive split — the
 * table frame shows above md and card skeletons show under it.
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
    <>
      <div className="hidden overflow-hidden rounded-2xl border border-border/60 bg-card shadow-xs md:block" aria-hidden="true">
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
      <div className="space-y-3 md:hidden" aria-hidden="true">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="rounded-2xl border border-border/60 bg-card p-4 shadow-xs">
            {Array.from({ length: columns }).map((_, c) => (
              <div key={c} className="flex items-center justify-between gap-4 py-1.5 first:pt-0 last:pb-0">
                <span className="skeleton-shimmer block h-3 w-16 rounded-md" />
                <span className={`skeleton-shimmer block h-4 rounded-md ${c === 0 ? "w-24" : "w-16"}`} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
