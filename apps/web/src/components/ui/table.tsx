import type { ReactNode } from "react";

export type TableColumn = { key: string; header: string };
export type TableRow = Record<string, ReactNode>;

export function DataTable({ columns, rows, caption }: { columns: TableColumn[]; rows: TableRow[]; caption?: string }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full text-sm">
        {caption ? <caption className="p-3 text-left font-medium">{caption}</caption> : null}
        <thead>
          <tr className="border-b border-border bg-surface-2 text-left">
            {columns.map((c) => <th key={c.key} scope="col" className="px-4 py-3 text-xs font-medium text-text-muted">{c.header}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border last:border-0 hover:bg-surface-2">
              {columns.map((c) => <td key={c.key} className="px-4 py-3">{row[c.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {/* Mobile card fallback is handled by Step 6 screens; this table scrolls horizontally under 768px. */}
    </div>
  );
}
