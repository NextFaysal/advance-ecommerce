"use client";

// Hero text block with client-side A/B resolution (Wave 46 ISR
// conversion). The homepage is statically rendered with the
// DEFAULT hero copy (the props); when a hero experiment could
// apply (experimentActive), this component asks
// GET /api/v1/public/experiments/hero on mount — the endpoint runs
// the exact server resolution the page used to run inline
// (variant assignment + deduped exposure recording) — and swaps
// the copy when the visitor's variant carries its own. Control
// visitors, flag-off, and any fetch failure simply keep the
// default copy: the static render below is byte-identical to the
// pre-ISR homepage hero.
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";

interface HeroCopyResponse {
  headlineBn: string;
  subBn: string;
  ctaLabelBn: string;
  ctaHref: string;
}

interface HeroCopyState {
  headline: string;
  sub: string;
  ctaLabel: string;
  ctaHref: string;
}

/* Small inline icons (Lucide-style, 1.6 stroke) — moved with the
   hero JSX from app/page.tsx, which keeps its own copies of the
   other icons used by the remaining sections. */
const iconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

function BoltIcon({ size = 26 }: { size?: number }) {
  return (
    <svg {...iconProps} width={size} height={size}>
      <path d="M13 2.5 4.5 13.5H11L9.8 21.5 18.5 10H12l1-7.5z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg {...iconProps} width="16" height="16" strokeWidth="2.2">
      <path d="M4.5 12.5 9.5 17.5 19.5 6.5" />
    </svg>
  );
}

export function HeroExperiment({
  headline,
  sub,
  ctaLabel,
  ctaHref,
  experimentActive,
  children,
}: {
  /** Default hero copy — the exact literals the static page renders. */
  headline: string;
  sub: string;
  ctaLabel: string;
  ctaHref: string;
  /** True when the mechanics flag is on AND a hero experiment is running. */
  experimentActive: boolean;
  /** Server-rendered hero stats block (stays server-rendered). */
  children?: ReactNode;
}) {
  const [copy, setCopy] = useState<HeroCopyState>({ headline, sub, ctaLabel, ctaHref });
  const [swapped, setSwapped] = useState(false);

  useEffect(() => {
    if (!experimentActive) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/v1/public/experiments/hero", {
          credentials: "same-origin",
        });
        const json: unknown = await res.json().catch(() => null);
        const hero = (json as { data?: HeroCopyResponse | null } | null)?.data ?? null;
        if (cancelled || hero === null) return;
        setCopy({
          headline: hero.headlineBn,
          // Mirror the old server seam: an empty variant sub falls
          // back to the default sub copy.
          sub: hero.subBn !== "" ? hero.subBn : sub,
          ctaLabel: hero.ctaLabelBn,
          ctaHref: hero.ctaHref,
        });
        setSwapped(true);
      } catch {
        // Network/parse failure — keep the default copy.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [experimentActive, sub]);

  return (
    <>
      <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-bold text-brand-700 shadow-sm">
        <BoltIcon size={13} />
        বাংলাদেশের নিজস্ব অনলাইন শপ
      </span>
      <h1 className="mt-5 break-words text-4xl font-extrabold leading-[1.2] text-text-main [overflow-wrap:anywhere] sm:text-5xl sm:leading-[1.15]">
        {swapped ? (
          copy.headline
        ) : (
          <>
            সারাদেশে হোম ডেলিভারি,
            <span className="brand-gradient bg-clip-text text-transparent"> পছন্দের সব পণ্য</span>
          </>
        )}
      </h1>
      <p className="mt-4 max-w-lg break-words text-[15px] leading-7 text-text-muted [overflow-wrap:anywhere]">
        {copy.sub}
      </p>
      <div className="mt-7 flex flex-wrap gap-3">
        <Link
          href={copy.ctaHref}
          className="brand-gradient rounded-xl px-6 py-3.5 text-[15px] font-bold text-white shadow-md transition hover:opacity-90"
        >
          {copy.ctaLabel}
        </Link>
        <Link
          href="/shop?sort=newest"
          className="rounded-xl border border-border bg-surface px-6 py-3.5 text-[15px] font-bold text-text-main shadow-sm transition hover:bg-surface-2"
        >
          নতুন কালেকশন দেখুন
        </Link>
      </div>
      <ul className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-[13px] font-medium text-text-muted">
        <li className="flex items-center gap-1.5">
          <span className="text-emerald-600"><CheckIcon /></span> ক্যাশ অন ডেলিভারি
        </li>
        <li className="flex items-center gap-1.5">
          <span className="text-emerald-600"><CheckIcon /></span> সহজ রিটার্ন
        </li>
        <li className="flex items-center gap-1.5">
          <span className="text-emerald-600"><CheckIcon /></span> ১০০% অরিজিনাল পণ্য
        </li>
      </ul>

      {children}
    </>
  );
}
