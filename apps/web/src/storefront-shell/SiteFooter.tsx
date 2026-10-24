// SiteFooter — shared storefront footer (Agent 31, Storefront Shell).
//
// Server-friendly: no hooks, no "use client" — safe to render from any
// Server Component. NO contact details are printed here on purpose:
// support phone/email/address belong to the per-client settings and the
// /contact page, never hardcoded in the shell (do not invent them).
// Design refresh (Direction A): brand intro column, single-language
// (Bangla) headings and links per the bn-default locale — no mixed
// "দোকান Shop" style labels — and a marked slot where the parent wires
// in real payment/courier brand marks (SVG logo chips, plan §2.4).

import { CourierMarks, PaymentMarks } from "@/components/brand-marks";

export interface SiteFooterProps {
  brandName?: string;
  /** "Powered by" line — OFF by default (white-label installs). */
  showPoweredBy?: boolean;
}

const COLUMNS: ReadonlyArray<{
  headingBn: string;
  links: ReadonlyArray<{ href: string; labelBn: string }>;
}> = [
  {
    headingBn: "দোকান",
    links: [
      { href: "/shop", labelBn: "সব পণ্য" },
      { href: "/search", labelBn: "পণ্য খুঁজুন" },
      { href: "/wishlist", labelBn: "উইশলিস্ট" },
      { href: "/compare", labelBn: "তুলনা করুন" },
      { href: "/recently-viewed", labelBn: "সম্প্রতি দেখা" },
    ],
  },
  {
    headingBn: "সাহায্য",
    links: [
      { href: "/track", labelBn: "অর্ডার ট্র্যাক করুন" },
      { href: "/faq", labelBn: "সাধারণ জিজ্ঞাসা" },
      { href: "/contact", labelBn: "যোগাযোগ" },
      { href: "/shipping-policy", labelBn: "ডেলিভারি নীতিমালা" },
      { href: "/refund-policy", labelBn: "রিটার্ন ও রিফান্ড" },
    ],
  },
  {
    headingBn: "আইনি",
    links: [
      { href: "/privacy", labelBn: "গোপনীয়তা নীতি" },
      { href: "/terms", labelBn: "শর্তাবলি" },
    ],
  },
  {
    headingBn: "আমাদের সম্পর্কে",
    links: [{ href: "/about", labelBn: "আমাদের কথা" }],
  },
];

export default function SiteFooter({
  brandName = "Advance Ecommerce",
  showPoweredBy = false,
}: SiteFooterProps) {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-border bg-card">
      <div className="mx-auto max-w-[1440px] px-4 py-12 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[1.3fr_1fr_1fr_1fr_1fr]">
          {/* Brand intro */}
          <div className="min-w-0">
            <a href="/" className="flex items-center gap-2" aria-label={brandName}>
              <span className="brand-gradient flex h-10 w-10 items-center justify-center rounded-lg text-lg font-bold text-white shadow-sm">
                {brandName.charAt(0)}
              </span>
              <span className="text-base font-bold text-text-main">{brandName}</span>
            </a>
            <p className="mt-3 max-w-xs break-words text-sm leading-6 text-text-muted">
              বাংলাদেশের ক্রেতাদের জন্য তৈরি অনলাইন শপ — যাচাই করা অরিজিনাল পণ্য, ক্যাশ অন ডেলিভারি আর সারাদেশে হোম ডেলিভারি।
            </p>
            <a
              href="/track"
              className="mt-4 inline-block rounded-lg bg-brand-50 px-3.5 py-2 text-sm font-semibold text-brand-700 transition hover:bg-brand-100"
            >
              অর্ডার ট্র্যাক করুন
            </a>
          </div>

          {COLUMNS.map((col) => (
            <nav key={col.headingBn} aria-label={col.headingBn}>
              <p className="text-sm font-bold text-text-main">{col.headingBn}</p>
              <span aria-hidden="true" className="brand-gradient mt-2 block h-0.5 w-8 rounded-full" />
              <ul className="mt-3.5 space-y-2.5">
                {col.links.map((link) => (
                  <li key={link.href}>
                    <a href={link.href} className="text-sm text-text-muted transition hover:text-brand-700">
                      {link.labelBn}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        {/* Payment + courier brand marks (design plan §2.4): colour chips
            from src/components/brand-marks.tsx — clean colour marks with
            the partner names, not copied official logo artwork. */}
        <div data-brand-marks-slot="payment-courier" className="mt-10 space-y-3 border-t border-border pt-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-text-muted">পেমেন্ট:</span>
            <PaymentMarks />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-text-muted">ডেলিভারি পার্টনার:</span>
            <CourierMarks />
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-6 text-xs text-text-subtle">
          <span>
            © {year} {brandName} — সর্বস্বত্ব সংরক্ষিত।
          </span>
          <a href="/contact" className="hover:text-brand-700">
            যোগাযোগের জন্য এখানে দেখুন
          </a>
          {showPoweredBy ? <span className="ml-auto">Powered by Advance Ecommerce</span> : null}
        </div>
      </div>
    </footer>
  );
}
