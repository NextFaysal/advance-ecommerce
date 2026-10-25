"use client";

// Flash sale countdown — storefront section (2026-10-25).
// Pure presentation: every prop is serializable (strings/numbers) so a
// server component can hand it the getLiveFlashSale() result directly.
// The parent (or <FlashSaleCountdownSection />) renders this ONLY when
// a sale is live; the component additionally hides itself the moment
// the countdown reaches zero, so an expired banner never lingers.
import { useEffect, useState } from "react";
import Link from "next/link";
import { formatPoisha } from "@/components/ui/money";
import { useDigitText } from "@/components/ui/numerals";

export interface FlashSaleCountdownItem {
  variantId: string;
  productTitleBn: string;
  productTitleEn: string;
  productSlug: string;
  imageUrl: string | null;
  regularPricePoisha: number;
  salePricePoisha: number;
  stockCap: number;
  soldCount: number;
  remaining: number;
}

export interface FlashSaleCountdownProps {
  /** Sale name (FlashSale.name). */
  title: string;
  /** ISO instant when the sale ends — the countdown target. */
  endsAt: string;
  items: FlashSaleCountdownItem[];
}

const BN_DIGITS = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];

function bn(n: number, pad = 2): string {
  return String(n)
    .padStart(pad, "0")
    .replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]);
}

function TimeBox({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex min-w-[3.5rem] flex-col items-center rounded-xl bg-white/15 px-2 py-2 ring-1 ring-inset ring-white/25">
      <span className="font-mono text-xl font-extrabold tabular-nums leading-none">{value}</span>
      <span className="mt-1 text-[11px] font-medium leading-none text-white/85">{label}</span>
    </div>
  );
}

export function FlashSaleCountdown({ title, endsAt, items }: FlashSaleCountdownProps) {
  // Prices honour the visitor's numerals preference like every other
  // storefront money surface (the timer/stock counts use bn() below
  // and are always Bengali by this banner's design).
  const digits = useDigitText();
  // null until mounted: the server render cannot know the client's
  // clock, so boxes show a placeholder first and tick after mount —
  // this also keeps hydration output identical.
  const [nowMs, setNowMs] = useState<number | null>(null);

  useEffect(() => {
    setNowMs(Date.now());
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const endsMs = Date.parse(endsAt);
  const remainingMs = nowMs === null ? null : endsMs - nowMs;

  // Ended (or an unparseable end time): render nothing.
  if (remainingMs !== null && remainingMs <= 0) return null;
  if (Number.isNaN(endsMs)) return null;

  const totalSeconds = remainingMs === null ? null : Math.floor(remainingMs / 1000);
  const days = totalSeconds === null ? null : Math.floor(totalSeconds / 86400);
  const hours = totalSeconds === null ? null : Math.floor((totalSeconds % 86400) / 3600);
  const minutes = totalSeconds === null ? null : Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds === null ? null : totalSeconds % 60;
  const placeholder = "––";

  return (
    <section aria-label="ফ্ল্যাশ সেল" className="brand-gradient mt-5 overflow-hidden rounded-3xl text-white shadow-md">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-5 p-6 sm:p-8">
        <div className="min-w-0">
          <span className="inline-flex items-center rounded-full bg-white px-3 py-1 text-xs font-bold text-brand-700 shadow-sm">
            ফ্ল্যাশ সেল
          </span>
          <h2 className="mt-3 break-words text-2xl font-extrabold leading-snug [overflow-wrap:anywhere] sm:text-3xl">
            {title}
          </h2>
          <p className="mt-1 text-sm text-white/85">সীমিত সময়ের অফার — স্টক থাকা পর্যন্ত</p>
        </div>

        <div className="flex items-start gap-2" role="timer" aria-label="অফার শেষ হতে বাকি">
          {days !== null && days > 0 ? <TimeBox value={bn(days)} label="দিন" /> : null}
          <TimeBox value={hours === null ? placeholder : bn(hours)} label="ঘণ্টা" />
          <TimeBox value={minutes === null ? placeholder : bn(minutes)} label="মিনিট" />
          <TimeBox value={seconds === null ? placeholder : bn(seconds)} label="সেকেন্ড" />
        </div>
      </div>

      {items.length > 0 ? (
        <ul className="flex gap-3 overflow-x-auto px-6 pb-6 sm:px-8">
          {items.map((item) => (
            <li key={item.variantId} className="w-44 shrink-0">
              <Link
                href={`/product/${item.productSlug}`}
                className="block rounded-2xl bg-white p-3 text-text-main shadow-sm transition hover:shadow-lift"
              >
                {item.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.imageUrl}
                    alt={item.productTitleBn}
                    className="h-24 w-full rounded-xl object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-24 w-full items-center rounded-xl bg-surface-2 px-2 text-center text-xs font-medium text-text-muted">
                    {item.productTitleBn}
                  </div>
                )}
                <p className="mt-2 line-clamp-2 min-h-[2.5em] text-[13px] font-semibold leading-snug">
                  {item.productTitleBn}
                </p>
                <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
                  <span className="font-mono text-[15px] font-bold text-brand-700">
                    {digits(formatPoisha(item.salePricePoisha))}
                  </span>
                  {item.regularPricePoisha > item.salePricePoisha ? (
                    <span className="font-mono text-xs text-text-subtle line-through">
                      {digits(formatPoisha(item.regularPricePoisha))}
                    </span>
                  ) : null}
                </p>
                <p className="mt-1 text-[11px] font-medium text-text-muted">
                  {item.remaining > 0 ? `মাত্র ${bn(item.remaining, 0)}টি বাকি` : "স্টক শেষ"}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
