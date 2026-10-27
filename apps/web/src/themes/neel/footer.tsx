/**
 * Neel Footer (doc 27 T-E) — ThemeFooterProps.
 *
 * A deep-blue footer: a five-column top area — (1) brand + our own
 * intro + the order-tracking shortcut, (2) Information, (3) Shop
 * By, (4) Support, (5) Consumer Policy — then a bottom bar with the
 * copyright line and the platform's payment/courier brand-mark
 * rows (src/components/brand-marks.tsx, the same colour chips the
 * other packages' footers render — partner names, not copied logo
 * artwork).
 *
 * The link columns render the CMS footer menu (`footerMenu` prop,
 * falling back to DEFAULT_FOOTER_MENU exactly like SiteFooter).
 * The CMS shape is an arbitrary list of groups, while this layout
 * has four fixed named columns: groups are assigned by matching
 * their English heading against the column intents (shop /
 * information / support / policy keywords); unmatched groups fill
 * the remaining columns in order, and any links beyond four groups
 * append to the last column — every CMS link keeps its real href
 * and none is dropped.
 *
 * Like SiteFooter, NO contact details are printed: support
 * phone/email/address are per-client settings surfaced on /contact,
 * never hardcoded in a theme.
 */
import { CourierMarks, PaymentMarks } from "@/components/brand-marks";
import {
  DEFAULT_FOOTER_MENU,
  type FooterMenuGroup,
  type FooterMenuLink,
} from "@/cms/site-content-types";
import { NEEL_COLORS } from "./tokens";
import type { ThemeFooterProps } from "../slots";

const COLUMN_DEFS: ReadonlyArray<{
  headingBn: string;
  headingEn: string;
  /** English-heading keywords that claim a CMS group for this column. */
  keywords: readonly string[];
}> = [
  { headingBn: "তথ্য", headingEn: "Information", keywords: ["information", "about", "company", "info"] },
  { headingBn: "কেনাকাটা", headingEn: "Shop By", keywords: ["shop", "store", "categor", "product"] },
  { headingBn: "সাপোর্ট", headingEn: "Support", keywords: ["support", "help", "customer", "service"] },
  { headingBn: "ভোক্তা নীতি", headingEn: "Consumer Policy", keywords: ["policy", "consumer", "terms", "privacy", "refund", "return"] },
];

interface FooterColumn {
  headingBn: string;
  headingEn: string;
  links: FooterMenuLink[];
}

/** Distribute CMS groups into the four fixed columns (see header). */
function distributeColumns(groups: ReadonlyArray<FooterMenuGroup>): FooterColumn[] {
  const columns: FooterColumn[] = COLUMN_DEFS.map((d) => ({
    headingBn: d.headingBn,
    headingEn: d.headingEn,
    links: [],
  }));
  const claimed = new Array<boolean>(columns.length).fill(false);
  const leftovers: FooterMenuGroup[] = [];

  for (const group of groups) {
    const heading = group.headingEn.toLowerCase();
    const idx = COLUMN_DEFS.findIndex(
      (d, i) => !claimed[i] && d.keywords.some((k) => heading.includes(k)),
    );
    if (idx >= 0) {
      claimed[idx] = true;
      columns[idx]!.links.push(...group.links);
    } else {
      leftovers.push(group);
    }
  }
  // Unmatched groups fill unclaimed columns in order; anything still
  // left appends to the final column so no CMS link is ever dropped.
  for (const group of leftovers) {
    const idx = claimed.indexOf(false);
    if (idx >= 0) {
      claimed[idx] = true;
      columns[idx]!.links.push(...group.links);
    } else {
      columns[columns.length - 1]!.links.push(...group.links);
    }
  }
  return columns;
}

export default function NeelFooter({
  brandName = "Advance Ecommerce",
  showPoweredBy = false,
  footerMenu,
}: ThemeFooterProps) {
  const year = new Date().getFullYear();
  const groups: ReadonlyArray<FooterMenuGroup> =
    footerMenu && footerMenu.length > 0 ? footerMenu : DEFAULT_FOOTER_MENU;
  const columns = distributeColumns(groups);

  return (
    <footer className="text-white" style={{ backgroundColor: NEEL_COLORS.deepBlue }}>
      <div className="mx-auto max-w-[1440px] px-4 py-12 sm:px-6">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.3fr_1fr_1fr_1fr_1fr]">
          {/* Brand column — our own intro copy; contact channels live
              on /contact (per-client settings), linked below. */}
          <div className="min-w-0">
            <a href="/" className="flex items-center gap-2" aria-label={brandName}>
              <span className="flex h-10 w-10 items-center justify-center rounded-md bg-white/15 text-lg font-bold text-white ring-1 ring-white/30">
                {brandName.charAt(0)}
              </span>
              <span className="text-base font-bold text-white">{brandName}</span>
            </a>
            <p className="mt-3 max-w-xs break-words text-sm leading-6 text-white/75">
              পছন্দের পণ্য ঘরে বসেই — এক জায়গায় হাজারো পণ্য, পরিষ্কার দাম আর
              দেশজুড়ে যত্নে ডেলিভারি।
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <a
                href="/track"
                className="inline-block rounded-md bg-white px-3.5 py-2 text-sm font-semibold text-primary transition hover:opacity-90"
              >
                অর্ডার ট্র্যাক করুন
              </a>
              <a
                href="/contact"
                className="inline-block rounded-md border border-white/40 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                যোগাযোগ করুন
              </a>
            </div>
          </div>

          {columns.map((col) => (
            <nav key={col.headingEn} aria-label={col.headingBn}>
              <p className="text-sm font-bold text-white">{col.headingBn}</p>
              <span aria-hidden="true" className="mt-2 block h-0.5 w-8 rounded-full bg-accent" />
              <ul className="mt-3.5 space-y-2.5">
                {col.links.map((link) => (
                  <li key={link.id}>
                    <a
                      href={link.href}
                      className="text-sm text-white/75 transition hover:text-white"
                    >
                      {link.labelBn}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        {/* Payment + courier brand marks — same platform slot the
            other packages' footers render. */}
        <div
          data-brand-marks-slot="payment-courier"
          className="mt-10 space-y-3 border-t border-white/15 pt-6"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-white/70">পেমেন্ট:</span>
            <PaymentMarks />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-white/70">ডেলিভারি পার্টনার:</span>
            <CourierMarks />
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/15 pt-6 text-xs text-white/60">
          <span>
            © {year} {brandName} — সর্বস্বত্ব সংরক্ষিত।
          </span>
          <a href="/contact" className="hover:text-white">
            যোগাযোগের জন্য এখানে দেখুন
          </a>
          {showPoweredBy ? (
            <span className="ml-auto">Powered by Advance Ecommerce</span>
          ) : null}
        </div>
      </div>
    </footer>
  );
}
