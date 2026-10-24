"use client";

/**
 * Quick-view modal — Part B wiring (Agent 21).
 * Renders exactly the QuickViewData built by buildQuickViewData()
 * (src/storefront-ux/quick-view.ts) — cost is never in that shape.
 */
import Link from "next/link";
import { formatBdt } from "@advance-ecommerce/validators";
import { Modal } from "@/components/ui/modal";
import type { QuickViewData } from "../types";

export function QuickViewModal({ data, onClose }: { data: QuickViewData | null; onClose: () => void }) {
  return (
    <Modal open={data !== null} onClose={onClose} title="দ্রুত দেখুন">
      {data ? (
        <div>
          <div className="flex h-40 items-center justify-center rounded-lg bg-[#F8F9FD] text-sm text-slate-500">
            {data.titleBn}
          </div>
          <h3 className="mt-3 break-words text-lg font-bold [overflow-wrap:anywhere]">{data.titleBn}</h3>
          <p className="text-sm text-slate-500">{data.titleEn}</p>
          <p className="mt-1 text-sm text-slate-500">
            ★ {data.ratingAverage ?? "—"} ({data.reviewCount} রিভিউ){data.brandName ? ` • ${data.brandName}` : ""}
          </p>
          <p className="mt-2 text-xl font-bold text-[#4F46E5]">
            {data.maxPricePoisha > data.minPricePoisha
              ? `${formatBdt(data.minPricePoisha)} — ${formatBdt(data.maxPricePoisha)}`
              : formatBdt(data.minPricePoisha)}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {data.variants.map((v) => (
              <span key={v.variantId} className="rounded-full border px-3 py-1 text-sm">
                {v.label} — {formatBdt(v.pricePoisha)}
                {v.inStock ? ` (স্টক: ${v.stock})` : " (স্টক শেষ)"}
              </span>
            ))}
          </div>
          <p className="mt-3 break-words text-sm leading-6 [overflow-wrap:anywhere]">{data.descriptionBn}</p>
          {data.hasSizeGuide ? (
            <p className="mt-2 text-xs text-slate-500">এই পণ্যের জন্য সাইজ গাইড আছে — পণ্যের পেজে দেখুন।</p>
          ) : null}
          <Link
            href={`/product/${data.slug}`}
            className="mt-4 inline-block rounded-lg bg-[#4F46E5] px-4 py-2 text-sm font-semibold text-white"
            onClick={onClose}
          >
            বিস্তারিত দেখুন
          </Link>
        </div>
      ) : null}
    </Modal>
  );
}
