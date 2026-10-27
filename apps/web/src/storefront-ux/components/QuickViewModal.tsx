"use client";

/**
 * Quick-view modal — Part B wiring (Agent 21).
 * Renders exactly the QuickViewData built by buildQuickViewData()
 * (src/storefront-ux/quick-view.ts) — cost is never in that shape.
 * Doc 30: all chrome copy follows the active locale; the product's own
 * title/description are merchant data with bn/en variants, so the
 * active locale's variant is the one shown (no bilingual stacking).
 */
import Link from "next/link";
import { formatBdt } from "@advance-ecommerce/validators";
import { Modal } from "@/components/ui/modal";
import { useDigitText } from "@/components/ui/numerals";
import { interpolate, pick } from "@/i18n/locale";
import { useLocale } from "@/i18n/LocaleProvider";
import type { QuickViewData } from "../types";
import { UX_STRINGS } from "../strings";

export function QuickViewModal({ data, onClose }: { data: QuickViewData | null; onClose: () => void }) {
  const digits = useDigitText();
  const { locale, t } = useLocale();
  const s = pick(locale, UX_STRINGS);
  const title = data ? (locale === "bn" ? data.titleBn : data.titleEn) : "";
  const description = data ? (locale === "bn" ? data.descriptionBn : data.descriptionEn) : "";
  return (
    <Modal open={data !== null} onClose={onClose} title={s.quickView}>
      {data ? (
        <div>
          <div className="flex h-40 items-center justify-center rounded-lg bg-[#F8F9FD] text-sm text-slate-500">
            {title}
          </div>
          <h3 className="mt-3 break-words text-lg font-bold [overflow-wrap:anywhere]">{title}</h3>
          <p className="mt-1 text-sm text-slate-500">
            ★ {data.ratingAverage ?? "—"} {interpolate(s.qvReviews, { count: data.reviewCount })}{data.brandName ? ` • ${data.brandName}` : ""}
          </p>
          <p className="mt-2 text-xl font-bold text-[#4F46E5]">
            {digits(
              data.maxPricePoisha > data.minPricePoisha
                ? `${formatBdt(data.minPricePoisha)} — ${formatBdt(data.maxPricePoisha)}`
                : formatBdt(data.minPricePoisha),
            )}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {data.variants.map((v) => (
              <span key={v.variantId} className="rounded-full border px-3 py-1 text-sm">
                {v.label} — {digits(formatBdt(v.pricePoisha))}
                {v.inStock ? ` ${interpolate(s.qvStock, { stock: v.stock })}` : ` (${t.outOfStock})`}
              </span>
            ))}
          </div>
          <p className="mt-3 break-words text-sm leading-6 [overflow-wrap:anywhere]">{description}</p>
          {data.hasSizeGuide ? (
            <p className="mt-2 text-xs text-slate-500">{s.qvSizeGuideNote}</p>
          ) : null}
          <Link
            href={`/product/${data.slug}`}
            className="mt-4 inline-block rounded-lg bg-[#4F46E5] px-4 py-2 text-sm font-semibold text-white"
            onClick={onClose}
          >
            {s.qvViewDetails}
          </Link>
        </div>
      ) : null}
    </Modal>
  );
}
