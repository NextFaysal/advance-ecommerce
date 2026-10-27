/**
 * /track — public order tracking page. Agent 19.
 * Mobile-first. Data comes from POST /api/v1/public/track
 * (real order data from the DB; phone is only ever shown masked).
 * UI copy follows the doc-30 resolved locale (visitor cookie → store
 * default); the form itself is a client component on useLocale().
 */
import type { Metadata } from "next";
import TrackForm from "./TrackForm";
import { TRACK_STRINGS } from "./strings";
import { getRequestLocale } from "@/i18n/server";
import { pick } from "@/i18n/locale";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const t = pick(locale, TRACK_STRINGS);
  return {
    title: t.metaTitle,
    description: t.metaDescription,
    robots: { index: false, follow: false },
  };
}

export default async function TrackPage() {
  const locale = await getRequestLocale();
  const t = pick(locale, TRACK_STRINGS);
  return (
    <main className="mx-auto w-full max-w-md px-4 py-8 sm:py-10">
      <h1 className="font-display text-2xl font-bold text-text-main">{t.pageTitle}</h1>
      <p className="mt-1.5 text-sm leading-6 text-text-muted">{t.pageIntro}</p>
      <div className="mt-4">
        <TrackForm />
      </div>
    </main>
  );
}
