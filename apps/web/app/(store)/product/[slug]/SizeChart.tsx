"use client";

/**
 * Per-product size chart (Wave 14-2, doc 16 §P5) — replaces the old
 * hardcoded "fashion category ⇒ generic size guide" rule. The button
 * renders ONLY when the product itself carries a sizeChart
 * ({ headers, rows } from the editor), and both the button's modal and
 * the page section render THAT chart — never a generic fashion pack.
 * All cell values render as text.
 */
import { useState } from "react";
import { Modal } from "@/components/ui/modal";

export interface SizeChartData {
  headers: string[];
  rows: string[][];
}

function SizeChartTable({ chart }: { chart: SizeChartData }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[320px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-border">
            {chart.headers.map((h, i) => (
              <th key={i} className="px-3 py-2.5 font-semibold text-text-main">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {chart.rows.map((row, r) => (
            <tr key={r} className="border-b border-border last:border-0">
              {row.map((cell, c) => (
                <td key={c} className={`px-3 py-2.5 tabular-nums ${c === 0 ? "font-medium text-text-main" : "text-text-muted"}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SizeChartButton({ chart }: { chart: SizeChartData }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-[44px] rounded-lg border border-border px-4 py-3 text-sm font-medium text-text-main transition hover:bg-surface-2"
      >
        📏 সাইজ গাইড
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="সাইজ চার্ট">
        <SizeChartTable chart={chart} />
      </Modal>
    </>
  );
}

export function SizeChartSection({ chart }: { chart: SizeChartData }) {
  return (
    <section className="mt-10 rounded-3xl border border-border bg-card p-6 shadow-sm sm:p-8">
      <h2 className="text-lg font-extrabold text-text-main">সাইজ চার্ট</h2>
      <div className="mt-3">
        <SizeChartTable chart={chart} />
      </div>
    </section>
  );
}
