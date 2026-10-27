"use client";

/**
 * Bazaar Footer (doc 24 wave T1 / doc 25 wave S4a) — ThemeFooterProps.
 *
 * White footer in the reference layout's shape: a five-column top
 * area — (1) brand + our own intro + the order-tracking shortcut,
 * (2) Information, (3) Shop By, (4) Support, (5) Consumer Policy —
 * then a bottom bar with the copyright line and the platform's
 * payment/courier brand-mark rows (src/components/brand-marks.tsx,
 * the same colour chips the Aurora footer renders — partner names,
 * not copied logo artwork).
 *
 * The link columns render the CMS footer menu (`footerMenu` prop,
 * falling back to DEFAULT_FOOTER_MENU exactly like SiteFooter).
 * The CMS shape is an arbitrary list of groups, while this layout
 * has four fixed named columns: groups are assigned by matching
 * their English heading against the column intents (shop /
 * information / support / policy keywords); unmatched groups fill
 * the remaining columns in order, and any links beyond four groups
 * append to the last column — every CMS link keeps its real href
 * and none is dropped. Column headings are the layout's own (the
 * reference structure), while the links themselves are the store's.
 *
 * Like SiteFooter, NO contact details are printed: support
 * phone/email/address are per-client settings surfaced on /contact,
 * never hardcoded in a theme.
 */
import { CourierMarks, PaymentMarks } from "@/components/brand-marks";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { BAZAAR_STRINGS } from "./strings";
import {
  DEFAULT_FOOTER_MENU,
  type FooterMenuGroup,
  type FooterMenuLink,
} from "@/cms/site-content-types";
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

export default function BazaarFooter({
  brandName = "Advance Ecommerce",
  showPoweredBy = false,
  footerMenu,
}: ThemeFooterProps) {
  const { locale } = useLocale();
  const s = pick(locale, BAZAAR_STRINGS);
  const year = new Date().getFullYear();
  const groups: ReadonlyArray<FooterMenuGroup> =
    footerMenu && footerMenu.length > 0 ? footerMenu : DEFAULT_FOOTER_MENU;
  const columns = distributeColumns(groups);

  return (
    <footer className="border-t border-border bg-card">
      <div className="mx-auto max-w-[1440px] px-4 py-12 sm:px-6">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.3fr_1fr_1fr_1fr_1fr]">
          {/* Brand column — our own intro copy; contact channels live
              on /contact (per-client settings), linked below. */}
          <div className="min-w-0">
            <a href="/" className="flex items-center gap-2" aria-label={brandName}>
              <span className="brand-gradient flex h-10 w-10 items-center justify-center rounded-md text-lg font-bold text-white shadow-sm">
                {brandName.charAt(0)}
              </span>
              <span className="text-base font-bold text-text-main">{brandName}</span>
            </a>
            <p className="mt-3 max-w-xs break-words text-sm leading-6 text-text-muted">
              {s.footerIntro}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <a
                href="/track"
                className="inline-block rounded-md bg-secondary px-3.5 py-2 text-sm font-semibold text-secondary-foreground transition hover:opacity-90"
              >
                {s.trackOrderButton}
              </a>
              <a
                href="/contact"
                className="inline-block rounded-md border border-border px-3.5 py-2 text-sm font-semibold text-text-main transition hover:bg-muted"
              >
                {s.contactButton}
              </a>
            </div>
          </div>

          {columns.map((col) => (
            <nav key={col.headingEn} aria-label={locale === "bn" ? col.headingBn : col.headingEn}>
              <p className="text-sm font-bold text-text-main">{locale === "bn" ? col.headingBn : col.headingEn}</p>
              <span aria-hidden="true" className="mt-2 block h-0.5 w-8 rounded-full bg-primary" />
              <ul className="mt-3.5 space-y-2.5">
                {col.links.map((link) => (
                  <li key={link.id}>
                    <a
                      href={link.href}
                      className="text-sm text-text-muted transition hover:text-primary"
                    >
                      {locale === "bn" ? link.labelBn : link.labelEn || link.labelBn}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        {/* Payment + courier brand marks — same platform slot the
            Aurora footer renders. */}
        <div
          data-brand-marks-slot="payment-courier"
          className="mt-10 space-y-3 border-t border-border pt-6"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-text-muted">{s.paymentLabel}</span>
            <PaymentMarks locale={locale} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-text-muted">{s.deliveryPartnerLabel}</span>
            <CourierMarks locale={locale} />
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-6 text-xs text-text-subtle">
          <span>
            {interpolate(s.copyrightLine, { year, brand: brandName })}
          </span>
          <a href="/contact" className="hover:text-primary">
            {s.contactHint}
          </a>
          {showPoweredBy ? (
            <span className="ml-auto">Powered by Advance Ecommerce</span>
          ) : null}
        </div>
      </div>
    </footer>
  );
}
