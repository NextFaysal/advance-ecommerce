import type { Metadata } from "next";
import { listActivePublicProducts } from "@/catalog/server-read";
import { verifyCartShareToken } from "@/cart-share/token";
import { SharedCartClient } from "@/cart-share/components/SharedCartClient";
import { pick, type Locale } from "@/i18n/locale";
import { getRequestLocale } from "@/i18n/server";
import { CART_STRINGS, type CartStrings } from "@/cart/strings";

// /cart/shared?t=<token> — cart-share landing (ADV-19, doc 22). The
// token is verified HERE, server-side (HMAC + expiry, src/cart-share/
// token): a tampered or expired link renders a clear error and never
// reaches the client component. On success the shell loads the real
// ACTIVE catalog so the client resolves every line against LIVE
// prices/stock — the token carries only variant ids + quantities.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const s = pick(await getRequestLocale(), CART_STRINGS);
  return {
    title: s.sharedCartMetaTitle,
    description: s.sharedCartMetaDescription,
  };
}

function errorCopy(s: CartStrings): Record<string, { title: string; body: string }> {
  return {
    invalid: {
      title: s.shareErrorInvalidTitle,
      body: s.shareErrorInvalidBody,
    },
    expired: {
      title: s.shareErrorExpiredTitle,
      body: s.shareErrorExpiredBody,
    },
    not_configured: {
      title: s.shareErrorNotConfiguredTitle,
      body: s.shareErrorNotConfiguredBody,
    },
  };
}

export default async function SharedCartPage({
  searchParams,
}: {
  searchParams: { t?: string };
}) {
  const verdict = verifyCartShareToken(searchParams.t);
  if (!verdict.ok) {
    const locale: Locale = await getRequestLocale();
    const s = pick(locale, CART_STRINGS);
    const errors = errorCopy(s);
    const copy = errors[verdict.reason] ?? errors.invalid!;
    return (
      <main className="mx-auto w-full max-w-[720px] px-4 pb-24 pt-6 sm:px-6">
        <section className="rounded-2xl border border-border bg-card p-6 text-center shadow-card" aria-label={s.shareErrorAria}>
          <h1 className="font-display text-h1">{copy.title}</h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-text-muted">{copy.body}</p>
          <a
            href="/products"
            className="brand-gradient mt-5 inline-flex min-h-[44px] items-center rounded-md px-5 text-sm font-semibold text-white shadow-md transition hover:opacity-90"
          >
            {s.continueShopping}
          </a>
        </section>
      </main>
    );
  }
  const catalogProducts = await listActivePublicProducts(100);
  return <SharedCartClient lines={verdict.lines} catalogProducts={catalogProducts} />;
}
