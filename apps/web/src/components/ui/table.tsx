import type { ReactNode } from "react";

export type TableColumn = { key: string; header: string };
export type TableRow = Record<string, ReactNode>;

/**
 * DataTable (Design System v2) — sticky header, softer dividers, tinted
 * row hover and a `density` option ("comfortable" default, "compact"
 * for dense admin lists). API unchanged from v1.
 */
export function DataTable({
  columns,
  rows,
  caption,
  density = "comfortable",
}: {
  columns: TableColumn[];
  rows: TableRow[];
  caption?: string;
  density?: "comfortable" | "compact";
}) {
  const cellPad = density === "compact" ? "px-4 py-2" : "px-4 py-3";
  return (
    <div className="overflow-x-auto rounded-lg border border-border/70 bg-card shadow-card">
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
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-border/60 transition motion-fast last:border-b-0 hover:bg-brand-50/50">
              {columns.map((c) => (
                <td key={c.key} className={cellPad}>
                  {row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {/* Mobile card fallback is handled by screens; this table scrolls horizontally under 768px. */}
    </div>
  );
}
