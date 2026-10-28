/**
 * /contact — Contact Us. Agent 29; form wired by Agent 47.
 * Phone/email/address are PLACEHOLDER values from
 * src/legal/content.ts (CONTACT_PLACEHOLDERS) — the owner must replace
 * them before live. The form POSTs to /api/v1/public/contact;
 * submissions land in the support inbox (in-memory demo store in this
 * build — no email/SMS is sent).
 * Locale resolves per request (doc 30): visitor cookie → store default;
 * the {bn, en} content + form labels are selected by that locale.
 */
import type { Metadata } from "next";
import ContactForm from "./ContactForm";
import { CONTACT_CONTENT, CONTACT_PLACEHOLDERS } from "@/legal/content";
import { getRequestLocale } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const content = CONTACT_CONTENT[locale];
  return {
    title: `${content.title} — Advance Ecommerce`,
    description: content.description,
  };
}

export default async function ContactPage() {
  const locale = await getRequestLocale();
  const content = CONTACT_CONTENT[locale];
  const isBn = locale === "bn";
  return (
    <main className="mx-auto w-full max-w-md px-4 py-8 sm:py-12">
      <h1 className="font-display text-3xl font-extrabold leading-snug text-text-main">
        {content.title}
      </h1>
      <p className="mt-2 text-sm leading-[1.9] text-text-muted">{content.intro}</p>

      <dl className="mt-6 space-y-3 rounded-2xl border border-border bg-card p-5 text-sm shadow-card">
        <div>
          <dt className="font-medium text-text-subtle">{content.phoneLabel}</dt>
          <dd className="mt-0.5 font-semibold text-text-main">{CONTACT_PLACEHOLDERS.phoneDisplay}</dd>
        </div>
        <div>
          <dt className="font-medium text-text-subtle">{content.emailLabel}</dt>
          <dd className="mt-0.5 font-semibold text-text-main">{CONTACT_PLACEHOLDERS.emailDisplay}</dd>
        </div>
        <div>
          <dt className="font-medium text-text-subtle">{content.addressLabel}</dt>
          <dd className="mt-0.5 text-text-main">
            {isBn
              ? CONTACT_PLACEHOLDERS.addressDisplayBn
              : CONTACT_PLACEHOLDERS.addressDisplayEn}
          </dd>
        </div>
        <div>
          <dt className="font-medium text-text-subtle">{content.hoursLabel}</dt>
          <dd className="mt-0.5 text-text-main">
            {isBn ? CONTACT_PLACEHOLDERS.hoursBn : CONTACT_PLACEHOLDERS.hoursEn}
          </dd>
        </div>
      </dl>

      <h2 className="font-display mt-8 text-lg font-bold text-text-main">{content.formTitle}</h2>
      <ContactForm />
    </main>
  );
}
