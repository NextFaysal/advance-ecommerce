"use client";

/**
 * Size-guide button + modal — Part B wiring (Agent 21).
 * Table data comes from buildSizeGuideModalData()
 * (src/storefront-ux/size-guide.ts), which reuses the fashion pack.
 * Doc 30: the data is bilingual (titleBn/titleEn, labelBn/labelEn,
 * measureGuideBn/En) — the modal renders the active locale's variant;
 * the chrome words come from UX_STRINGS.
 */
import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { pick } from "@/i18n/locale";
import { useLocale } from "@/i18n/LocaleProvider";
import { buildSizeGuideModalData } from "../size-guide";
import { UX_STRINGS } from "../strings";

export function SizeGuideButton() {
  const { locale } = useLocale();
  const s = pick(locale, UX_STRINGS);
  const isBn = locale === "bn";
  const [open, setOpen] = useState(false);
  const data = buildSizeGuideModalData();
  const columns = data.rows[0]?.measurements ?? [];
  const title = isBn ? data.titleBn : data.titleEn;
  const measureGuide = isBn ? data.measureGuideBn : data.measureGuideEn;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="rounded-lg border px-4 py-3 text-sm">
        📏 {title}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={title}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[320px] text-left text-sm">
            <thead>
              <tr className="border-b">
                <th className="px-2 py-2 font-semibold">{s.sgSize}</th>
                {columns.map((c) => (
                  <th key={c.labelEn} className="px-2 py-2 font-semibold">
                    {isBn ? c.labelBn : c.labelEn} {s.sgCm}
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
            <h3 className="text-sm font-semibold">{s.sgHowToMeasure}</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm leading-6">
              {measureGuide.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
