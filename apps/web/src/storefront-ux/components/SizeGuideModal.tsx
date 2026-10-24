"use client";

/**
 * Size-guide button + modal — Part B wiring (Agent 21).
 * Table data comes from buildSizeGuideModalData()
 * (src/storefront-ux/size-guide.ts), which reuses the fashion pack.
 */
import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { buildSizeGuideModalData } from "../size-guide";

export function SizeGuideButton() {
  const [open, setOpen] = useState(false);
  const data = buildSizeGuideModalData();
  const columns = data.rows[0]?.measurements ?? [];

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="rounded-lg border px-4 py-3 text-sm">
        📏 সাইজ গাইড
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={data.titleBn}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[320px] text-left text-sm">
            <thead>
              <tr className="border-b">
                <th className="px-2 py-2 font-semibold">সাইজ</th>
                {columns.map((c) => (
                  <th key={c.labelEn} className="px-2 py-2 font-semibold">
                    {c.labelBn} (সেমি)
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.size} className="border-b last:border-0">
                  <td className="px-2 py-2 font-medium">{r.size}</td>
                  {r.measurements.map((m) => (
                    <td key={m.labelEn} className="px-2 py-2 tabular-nums">
                      {m.cm}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.showMeasureGuide ? (
          <div className="mt-4">
            <h3 className="text-sm font-semibold">কীভাবে মাপবেন</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm leading-6">
              {data.measureGuideBn.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
