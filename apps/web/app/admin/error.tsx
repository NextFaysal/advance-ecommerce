"use client";

/**
 * Admin segment error boundary (doc 35 wave 4) — replaces the fall
 * to the root global-error for failures inside /admin, so staff see
 * a calm message in the shell's own bilingual pattern with a retry,
 * and never a stack trace or raw error text.
 *
 * Strings follow the doc 30 pattern (`bn` written once, `en` typed
 * with the mapped type, parity compile-checked), resolved through
 * the client LocaleProvider like every other admin client surface.
 */
import { Button } from "@/components/ui/button";
import { useLocale } from "@/i18n/LocaleProvider";
import { pick, type Locale } from "@/i18n/locale";

const bn = {
  title: "কিছু একটা সমস্যা হয়েছে",
  body: "এই পেজটি এই মুহূর্তে লোড করা যাচ্ছে না। আবার চেষ্টা করুন — সমস্যা বারবার হলে কিছুক্ষণ পর ফিরে আসুন।",
  retry: "আবার চেষ্টা করুন",
};
type AdminErrorStrings = { [K in keyof typeof bn]: string };
const en: AdminErrorStrings = {
  title: "Something went wrong",
  body: "This page could not be loaded just now. Please try again — if it keeps happening, come back in a little while.",
  retry: "Try again",
};
const ADMIN_ERROR_STRINGS: Record<Locale, AdminErrorStrings> = { bn, en };

export default function AdminError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { locale } = useLocale();
  const s = pick(locale, ADMIN_ERROR_STRINGS);
  return (
    <section className="mx-auto flex max-w-md flex-col items-center px-6 py-16 text-center">
      <h1 className="font-display text-xl font-semibold text-text-main">{s.title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-text-muted">{s.body}</p>
      <Button className="mt-6" onClick={() => reset()}>
        {s.retry}
      </Button>
    </section>
  );
}
