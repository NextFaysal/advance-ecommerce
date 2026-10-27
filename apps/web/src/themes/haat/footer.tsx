"use client";

/**
 * Haat Footer (doc 27 theme T-A) — ThemeFooterProps.
 *
 * Modelled on the Bazaar footer's structure (the platform's own
 * package): a service strip, then a five-column top area — (1)
 * brand + our own intro + order-tracking shortcut, (2–5) the CMS
 * footer-menu groups distributed into four named columns — then
 * the payment/courier brand-mark rows and a bottom bar. Restyled
 * for this package: orange accents throughout and a charcoal
 * bottom band.
 *
 * The link columns render the CMS footer menu (`footerMenu`
 * prop, falling back to DEFAULT_FOOTER_MENU exactly like
 * SiteFooter). Groups are assigned to columns by matching their
 * English heading against column-intent keywords; unmatched
 * groups fill the remaining columns in order, and any links
 * beyond four groups append to the last column — every CMS link
 * keeps its real href and none is dropped.
 *
 * Like SiteFooter, NO contact details are printed: support
 * phone/email/address are per-client settings surfaced on
 * /contact, never hardcoded in a theme. The service strip states
 * only the platform's generic storefront promises (COD, delivery,
 * returns, payment) in this package's own words.
 */
import { CourierMarks, PaymentMarks } from "@/components/brand-marks";
import { Icon } from "@/components/ui/icon";
import {
  DEFAULT_FOOTER_MENU,
  type FooterMenuGroup,
  type FooterMenuLink,
} from "@/cms/site-content-types";
import { interpolate, pick } from "@/i18n/locale";
import { useLocale } from "@/i18n/LocaleProvider";
import { HAAT_COLORS } from "./tokens";
import { HAAT_STRINGS, type HaatStrings } from "./strings";
import type { ThemeFooterProps } from "../slots";

/* Our own generic service points (icon + line) — the same real
   platform promises the home trust language uses, in this
   package's own words. */
function serviceItems(S: HaatStrings) {
  return [
  { icon: "banknote", title: S.serviceCodTitle, text: S.serviceCodText },
  { icon: "truck", title: S.serviceDeliveryTitle, text: S.serviceDeliveryText },
  { icon: "rotate-ccw", title: S.serviceReturnTitle, text: S.serviceReturnText },
  { icon: "shield", title: S.serviceSafeTitle, text: S.serviceSafeText },
] as const;
}

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

export default function HaatFooter({
  brandName = "Advance Ecommerce",
  showPoweredBy = false,
  footerMenu,
}: ThemeFooterProps) {
  const { locale } = useLocale();
  const s = pick(locale, HAAT_STRINGS);
  const SERVICE_ITEMS = serviceItems(s);
  const year = new Date().getFullYear();
  const groups: ReadonlyArray<FooterMenuGroup> =
    footerMenu && footerMenu.length > 0 ? footerMenu : DEFAULT_FOOTER_MENU;
  const columns = distributeColumns(groups);

  return (
    <footer className="mt-10 border-t border-border bg-card">
      {/* Service strip — this package's own generic promises */}
      <div className="border-b border-border">
        <div className="mx-auto grid max-w-[1440px] grid-cols-2 gap-3 px-4 py-5 sm:px-6 lg:grid-cols-4">
          {SERVICE_ITEMS.map((item) => (
            <div key={item.title} className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary text-primary">
                <Icon name={item.icon} size={20} />
              </span>
              <span className="min-w-0">
                <span className="block break-words text-sm font-bold leading-snug text-text-main">
                  {item.title}
                </span>
                <span className="mt-0.5 hidden break-words text-xs leading-5 text-text-muted sm:block">
                  {item.text}
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="mx-auto max-w-[1440px] px-4 py-10 sm:px-6">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.3fr_1fr_1fr_1fr_1fr]">
          {/* Brand column — our own intro copy; contact channels live
              on /contact (per-client settings), linked below. */}
          <div className="min-w-0">
            <a href="/" className="flex items-center gap-2" aria-label={brandName}>
              <span className="flex h-10 w-10 items-center justify-center rounded bg-primary text-lg font-extrabold text-white shadow-sm">
                {brandName.charAt(0)}
              </span>
              <span className="text-base font-extrabold text-text-main">{brandName}</span>
            </a>
            <p className="mt-3 max-w-xs break-words text-sm leading-6 text-text-muted">
              {s.footerIntro}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <a
                href="/track"
                className="inline-block rounded bg-primary px-3.5 py-2 text-sm font-semibold text-white transition hover:opacity-90"
              >
                {s.footerTrackOrder}
              </a>
              <a
                href="/contact"
                className="inline-block rounded border border-border px-3.5 py-2 text-sm font-semibold text-text-main transition hover:bg-muted"
              >
                {s.footerContact}
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
                      {locale === "bn" ? link.labelBn : link.labelEn}
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
      </div>

      {/* Bottom band — charcoal, this package's footer signature */}
      <div className="text-white" style={{ backgroundColor: HAAT_COLORS.charcoal }}>
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-4 text-xs text-white/75 sm:px-6">
          <span>
            {interpolate(s.copyrightLine, { year, brand: brandName })}
          </span>
          <a href="/contact" className="hover:text-white hover:underline">
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
