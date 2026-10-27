"use client";

// SiteFooter — shared storefront footer (Agent 31, Storefront Shell).
//
// NO contact details are printed here on purpose: support phone/email/
// address belong to the per-client settings and the /contact page,
// never hardcoded in the shell (do not invent them).
// Design refresh (Direction A): brand intro column, headings and links
// in the ACTIVE locale (doc 30) — no mixed "দোকান Shop" style labels —
// and a marked slot where the parent wires in real payment/courier
// brand marks (SVG logo chips, plan §2.4).
//
// Doc 30 note: this component is rendered inside the client storefront
// shell (its strings are per-visitor), so it reads the locale from
// LocaleProvider like SiteHeader. Footer menu groups are CMS content
// with their own {bn, en} heading/label fields, picked by locale.

import { CourierMarks, PaymentMarks } from "@/components/brand-marks";
import { DEFAULT_FOOTER_MENU, type FooterMenuGroup } from "@/cms/site-content-types";
import { interpolate, pick } from "@/i18n/locale";
import { useLocale } from "@/i18n/LocaleProvider";
import { SHELL_STRINGS } from "./strings";

export interface SiteFooterProps {
  brandName?: string;
  /** "Powered by" line — OFF by default (white-label installs). */
  showPoweredBy?: boolean;
  /** Owner-configured footer menu (Admin → Content, CMS site
   *  content), already visible-filtered by the public API. Omit to
   *  render the built-in default columns (DEFAULT_FOOTER_MENU) —
   *  the same links, so the footer never waits on the CMS fetch. */
  footerMenu?: ReadonlyArray<FooterMenuGroup>;
}

export default function SiteFooter({
  brandName = "Advance Ecommerce",
  showPoweredBy = false,
  footerMenu,
}: SiteFooterProps) {
  const { locale, t } = useLocale();
  const s = pick(locale, SHELL_STRINGS);
  // CMS menu labels are owner content with {bn, en} fields: pick the
  // active locale's text, falling back to Bangla when En is blank.
  const pickLabel = (bn: string, en: string) => (locale === "en" && en ? en : bn);
  const year = new Date().getFullYear();
  const columns: ReadonlyArray<FooterMenuGroup> =
    footerMenu && footerMenu.length > 0 ? footerMenu : DEFAULT_FOOTER_MENU;
  // The built-in layout is brand + 4 fixed columns; an owner menu
  // with a different group count uses a wrapping grid instead (the
  // default render below is byte-identical to the pre-CMS footer).
  const customLayout = footerMenu !== undefined && footerMenu.length > 0 && footerMenu.length !== 4;
  return (
    <footer className="border-t border-border bg-card">
      <div className="mx-auto max-w-[1440px] px-4 py-12 sm:px-6">
        <div className={customLayout ? "grid gap-10 sm:grid-cols-2 lg:grid-cols-3" : "grid gap-10 lg:grid-cols-[1.3fr_1fr_1fr_1fr_1fr]"}>
          {/* Brand intro */}
          <div className="min-w-0">
            <a href="/" className="flex items-center gap-2" aria-label={brandName}>
              <span className="brand-gradient flex h-10 w-10 items-center justify-center rounded-lg text-lg font-bold text-white shadow-sm">
                {brandName.charAt(0)}
              </span>
              <span className="text-base font-bold text-text-main">{brandName}</span>
            </a>
            <p className="mt-3 max-w-xs break-words text-sm leading-6 text-text-muted">
              {s.footerIntro}
            </p>
            <a
              href="/track"
              className="mt-4 inline-block rounded-lg bg-brand-50 px-3.5 py-2 text-sm font-semibold text-brand-700 transition hover:bg-brand-100"
            >
              {t.trackOrder}
            </a>
          </div>

          {columns.map((col) => (
            <nav key={col.id} aria-label={pickLabel(col.headingBn, col.headingEn)}>
              <p className="text-sm font-bold text-text-main">{pickLabel(col.headingBn, col.headingEn)}</p>
              <span aria-hidden="true" className="brand-gradient mt-2 block h-0.5 w-8 rounded-full" />
              <ul className="mt-3.5 space-y-2.5">
                {col.links.map((link) => (
                  <li key={link.id}>
                    <a href={link.href} className="text-sm text-text-muted transition hover:text-brand-700">
                      {pickLabel(link.labelBn, link.labelEn)}
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
            <span className="text-xs font-medium text-text-muted">{s.paymentLabel}</span>
            <PaymentMarks />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-text-muted">{s.deliveryPartnerLabel}</span>
            <CourierMarks />
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-6 text-xs text-text-subtle">
          <span>
            {interpolate(s.copyrightLine, { year, brandName })}
          </span>
          <a href="/contact" className="hover:text-brand-700">
            {s.contactPrompt}
          </a>
          {showPoweredBy ? <span className="ml-auto">{s.poweredBy}</span> : null}
        </div>
      </div>
    </footer>
  );
}
