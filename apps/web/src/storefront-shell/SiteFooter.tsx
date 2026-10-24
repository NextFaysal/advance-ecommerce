// SiteFooter — shared storefront footer (Agent 31, Storefront Shell).
//
// Server-friendly: no hooks, no "use client" — safe to render from any
// Server Component. NO contact details are printed here on purpose:
// support phone/email/address belong to the per-client settings and the
// /contact page, never hardcoded in the shell (do not invent them).
// Payment/courier mentions are text badges only — no logos or images.

export interface SiteFooterProps {
  brandName?: string;
  /** "Powered by" line — OFF by default (white-label installs). */
  showPoweredBy?: boolean;
}

const COLUMNS: ReadonlyArray<{
  headingBn: string;
  headingEn: string;
  links: ReadonlyArray<{ href: string; labelBn: string; labelEn: string }>;
}> = [
  {
    headingBn: "দোকান",
    headingEn: "Shop",
    links: [
      { href: "/shop", labelBn: "সব পণ্য", labelEn: "All Products" },
      { href: "/search", labelBn: "পণ্য খুঁজুন", labelEn: "Search" },
      { href: "/wishlist", labelBn: "উইশলিস্ট", labelEn: "Wishlist" },
      { href: "/compare", labelBn: "তুলনা করুন", labelEn: "Compare" },
      { href: "/recently-viewed", labelBn: "সম্প্রতি দেখা", labelEn: "Recently Viewed" },
    ],
  },
  {
    headingBn: "সাহায্য",
    headingEn: "Help",
    links: [
      { href: "/track", labelBn: "অর্ডার ট্র্যাক করুন", labelEn: "Track Order" },
      { href: "/faq", labelBn: "সাধারণ জিজ্ঞাসা", labelEn: "FAQ" },
      { href: "/contact", labelBn: "যোগাযোগ", labelEn: "Contact" },
      { href: "/shipping-policy", labelBn: "ডেলিভারি নীতিমালা", labelEn: "Shipping Policy" },
      { href: "/refund-policy", labelBn: "রিটার্ন ও রিফান্ড", labelEn: "Returns & Refunds" },
    ],
  },
  {
    headingBn: "আইনি",
    headingEn: "Legal",
    links: [
      { href: "/privacy", labelBn: "গোপনীয়তা নীতি", labelEn: "Privacy Policy" },
      { href: "/terms", labelBn: "শর্তাবলি", labelEn: "Terms & Conditions" },
    ],
  },
  {
    headingBn: "আমাদের সম্পর্কে",
    headingEn: "About",
    links: [{ href: "/about", labelBn: "আমাদের কথা", labelEn: "About Us" }],
  },
];

const PAYMENT_BADGES = ["ক্যাশ অন ডেলিভারি (COD)", "বিকাশ", "নগদ", "রকেট", "SSLCommerz"] as const;
const COURIER_BADGES = ["স্টেডফাস্ট", "পাঠাও", "রেডএক্স", "পেপারফ্লাই", "ইকুরিয়ার"] as const;

function BadgeRow({ label, items }: { label: string; items: readonly string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-text-muted">{label}</span>
      {items.map((item) => (
        <span
          key={item}
          className="rounded-full border border-border bg-surface-2 px-2.5 py-1 text-xs text-text-main"
        >
          {item}
        </span>
      ))}
    </div>
  );
}

export default function SiteFooter({
  brandName = "Advance Ecommerce",
  showPoweredBy = false,
}: SiteFooterProps) {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-border bg-card">
      <div className="mx-auto max-w-[1440px] px-4 py-10 sm:px-6">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          {COLUMNS.map((col) => (
            <nav key={col.headingEn} aria-label={col.headingEn}>
              <p className="text-sm font-bold text-text-main">
                {col.headingBn}
                <span className="ml-2 text-xs font-normal text-text-subtle">{col.headingEn}</span>
              </p>
              <ul className="mt-3 space-y-2">
                {col.links.map((link) => (
                  <li key={link.href}>
                    <a href={link.href} className="text-sm text-text-muted hover:text-brand-700">
                      {link.labelBn}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-10 space-y-3 border-t border-border pt-6">
          <BadgeRow label="পেমেন্ট:" items={PAYMENT_BADGES} />
          <BadgeRow label="ডেলিভারি পার্টনার:" items={COURIER_BADGES} />
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
