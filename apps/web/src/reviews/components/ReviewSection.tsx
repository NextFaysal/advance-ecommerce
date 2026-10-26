/**
 * PDP review section — server component. Reads APPROVED reviews +
 * the aggregate from the reviews store (Review table) and renders:
 * the aggregate summary, the approved list (author NAME ONLY — the
 * stored phone is verification data and is never rendered), and the
 * submission form (client component, string prop only).
 *
 * Fail-safe like the rest of the PDP's data reads: a store problem
 * degrades to the honest empty state instead of breaking the page.
 */
import { getApprovedReviewAggregate, listApprovedReviews } from "@/reviews/store";
import { getReviewPhotoStatus } from "@/reviews/photo";
import { ReviewForm } from "./ReviewForm";
import { Stars } from "./Stars";

function bnDate(iso: string): string {
  return new Date(iso).toLocaleDateString("bn-BD", {
    timeZone: "Asia/Dhaka",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export async function ReviewSection({
  productId,
  productSlug,
}: {
  productId: string;
  productSlug: string;
}) {
  const [reviews, aggregate, photoStatus] = await Promise.all([
    listApprovedReviews(productId).catch(() => []),
    getApprovedReviewAggregate(productId).catch(() => ({ average: null, count: 0 })),
    // Photo reviews are not live yet (storage and/or persistence —
    // see src/reviews/photo.ts); the form shows the honest reason.
    getReviewPhotoStatus().catch(() => null),
  ]);

  return (
    <section className="mt-10 rounded-3xl border border-border bg-card p-6 shadow-sm sm:p-8" aria-label="কাস্টমার রিভিউ">
      <h2 className="text-lg font-extrabold text-text-main">কাস্টমার রিভিউ</h2>

      <div className="mt-3 flex flex-wrap items-center gap-2.5 text-sm text-text-muted">
        <Stars rating={aggregate.average ?? 0} size={17} />
        {aggregate.count > 0 && aggregate.average !== null ? (
          <span>
            <span className="font-bold text-text-main">{aggregate.average}</span> / ৫ — মোট{" "}
            {aggregate.count}টি অনুমোদিত রিভিউ
          </span>
        ) : (
          <span>এখনো কোনো অনুমোদিত রিভিউ নেই</span>
        )}
      </div>

      {reviews.length > 0 ? (
        <ul className="mt-6 space-y-5">
          {reviews.map((r) => (
            <li key={r.id} className="border-t border-border pt-5 first:border-t-0 first:pt-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-text-main">{r.authorName}</span>
                {r.verifiedPurchase ? (
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                    যাচাইকৃত ক্রেতা
                  </span>
                ) : null}
                <span className="text-xs text-text-subtle">{bnDate(r.createdAt)}</span>
              </div>
              <div className="mt-1.5">
                <Stars rating={r.rating} size={13} />
              </div>
              {r.title ? (
                <p className="mt-2 text-sm font-bold text-text-main">{r.title}</p>
              ) : null}
              <p className="mt-1 max-w-3xl break-words text-sm leading-7 text-text-muted [overflow-wrap:anywhere]">
                {r.body}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-5 text-sm text-text-muted">
          এই পণ্যের কোনো রিভিউ এখনো প্রকাশিত হয়নি — প্রথম রিভিউটি আপনিই লিখুন।
        </p>
      )}

      <div className="mt-8 border-t border-border pt-6">
        <h3 className="text-base font-extrabold text-text-main">আপনার রিভিউ লিখুন</h3>
        <p className="mt-1 text-sm text-text-muted">
          আপনার অভিজ্ঞতা অন্যদের সাহায্য করবে। রিভিউটি মডারেশনের পর প্রকাশিত হবে।
        </p>
        <ReviewForm productSlug={productSlug} photoUpload={photoStatus ?? undefined} />
      </div>
    </section>
  );
}
