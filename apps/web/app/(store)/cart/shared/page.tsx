import type { Metadata } from "next";
import { listActivePublicProducts } from "@/catalog/server-read";
import { verifyCartShareToken } from "@/cart-share/token";
import { SharedCartClient } from "@/cart-share/components/SharedCartClient";

// /cart/shared?t=<token> — cart-share landing (ADV-19, doc 22). The
// token is verified HERE, server-side (HMAC + expiry, src/cart-share/
// token): a tampered or expired link renders a clear error and never
// reaches the client component. On success the shell loads the real
// ACTIVE catalog so the client resolves every line against LIVE
// prices/stock — the token carries only variant ids + quantities.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "শেয়ার করা কার্ট — Advance Ecommerce",
  description: "শেয়ার করা কার্টের পণ্যগুলো লাইভ দাম ও স্টকসহ দেখুন এবং নিজের কার্টে যোগ করুন।",
};

const ERROR_COPY: Record<string, { title: string; body: string }> = {
  invalid: {
    title: "লিংকটি সঠিক নয়",
    body: "এই শেয়ার লিংকটি যাচাই করা যায়নি — লিংকটি বদলানো হয়ে থাকতে পারে অথবা অসম্পূর্ণ কপি হয়েছে। যিনি পাঠিয়েছেন, তাঁর কাছ থেকে আবার লিংকটি নিন।",
  },
  expired: {
    title: "লিংকের মেয়াদ শেষ",
    body: "শেয়ার করা কার্টের লিংক ৭ দিন পর মেয়াদ উত্তীর্ণ হয়। এই লিংকটির মেয়াদ শেষ হয়ে গেছে — নতুন একটি লিংক চেয়ে নিন।",
  },
  not_configured: {
    title: "শেয়ার সুবিধা এখন চালু নেই",
    body: "এই সার্ভারে কার্ট শেয়ার যাচাইয়ের ব্যবস্থা এখনো চালু হয়নি, তাই লিংকটি খোলা যাচ্ছে না।",
  },
};

export default async function SharedCartPage({
  searchParams,
}: {
  searchParams: { t?: string };
}) {
  const verdict = verifyCartShareToken(searchParams.t);
  if (!verdict.ok) {
    const copy = ERROR_COPY[verdict.reason] ?? ERROR_COPY.invalid!;
    return (
      <main className="mx-auto w-full max-w-[720px] px-4 pb-24 pt-6 sm:px-6">
        <section className="rounded-2xl border border-border bg-card p-6 text-center shadow-card" aria-label="শেয়ার লিংকের ত্রুটি">
          <h1 className="font-display text-h1">{copy.title}</h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-text-muted">{copy.body}</p>
          <a
            href="/products"
            className="brand-gradient mt-5 inline-flex min-h-[44px] items-center rounded-md px-5 text-sm font-semibold text-white shadow-md transition hover:opacity-90"
          >
            কেনাকাটা চালিয়ে যান
          </a>
        </section>
      </main>
    );
  }
  const catalogProducts = await listActivePublicProducts(100);
  return <SharedCartClient lines={verdict.lines} catalogProducts={catalogProducts} />;
}
