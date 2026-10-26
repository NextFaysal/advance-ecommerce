/**
 * /kb — public knowledge base index (ADV-16 remainder, doc 22).
 *
 * Articles live in the `support.kb_articles` Setting doc (edited
 * from /admin/tickets); only published = true articles are listed.
 * With zero published articles the page renders its honest empty
 * state — no placeholder articles, ever.
 *
 * Static shell with ISR (revalidate = 300), the wave-47 pattern:
 * the content comes from the Setting doc at render/revalidation
 * time, never from per-request user state.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { listPublishedKbArticlesSafe } from "@/support/docs";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "সাহায্য কেন্দ্র — Advance Ecommerce",
  description: "ডেলিভারি, পেমেন্ট, রিটার্নসহ সাধারণ সব প্রশ্নের উত্তর — Advance Ecommerce সাহায্য কেন্দ্র।",
};

export default async function KbIndexPage() {
  const articles = await listPublishedKbArticlesSafe();

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-10">
      <h1 className="font-display text-2xl font-bold text-text-main">সাহায্য কেন্দ্র</h1>
      <p className="mt-1.5 text-sm leading-6 text-text-muted">
        সাধারণ প্রশ্নের উত্তর এখানে পাবেন। উত্তর না পেলে{" "}
        <Link href="/account/tickets" className="font-semibold text-brand-700 hover:underline">
          সাপোর্ট টিকিট
        </Link>{" "}
        খুলুন — আমাদের টিম উত্তর দেবে।
      </p>

      {articles.length === 0 ? (
        <p className="mt-8 rounded-2xl border border-border bg-card p-6 text-sm leading-6 text-text-muted shadow-card">
          এখনো কোনো সাহায্য আর্টিকেল প্রকাশ করা হয়নি। আপনার প্রশ্নের জন্য সরাসরি একটি{" "}
          <Link href="/account/tickets" className="font-semibold text-brand-700 hover:underline">
            সাপোর্ট টিকিট
          </Link>{" "}
          খুলুন।
        </p>
      ) : (
        <ul className="mt-8 space-y-3">
          {articles.map((a) => (
            <li key={a.id}>
              <Link
                href={`/kb/${a.slug}`}
                className="block rounded-2xl border border-border bg-card p-5 shadow-card transition hover:border-brand-300"
              >
                <span className="text-base font-bold text-text-main">{a.titleBn}</span>
                {a.titleEn ? (
                  <span className="mt-0.5 block text-xs text-text-subtle">{a.titleEn}</span>
                ) : null}
                <span className="mt-2 line-clamp-2 block text-sm leading-6 text-text-muted">
                  {a.bodyBn}
                </span>
                <span className="mt-2 block text-sm font-semibold text-brand-700">পুরোটা পড়ুন →</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
