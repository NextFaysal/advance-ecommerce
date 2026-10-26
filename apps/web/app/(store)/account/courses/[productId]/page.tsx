/**
 * /account/courses/[productId] — the course PLAYER (ADV-23
 * vertical 6, LMS-lite).
 *
 * ACCESS IS CHECKED HERE, SERVER-SIDE, ON EVERY VIEW
 * (customerHasCourseAccess — order-derived, see
 * src/courses/service.ts):
 *
 *   - Buyer: the full content document is loaded and lessons
 *     render — video as an allowlisted-host embed iframe, text
 *     through renderDescriptionHtml (the escape-first house
 *     renderer used by the PDP/blog), link as an external anchor.
 *   - Non-buyer (or a buyer whose order was refunded/returned):
 *     the page renders ONLY the outline projection (toCourseOutline
 *     — module and lesson TITLES) plus a buy CTA. Lesson bodies,
 *     video URLs and link targets never appear in the response —
 *     there is nothing hidden in the payload to "unlock" from the
 *     client side.
 *
 * Logged-out visitors are sent to /account; an unknown or
 * non-course productId 404s exactly like a missing page (the route
 * never confirms that a product is a course to someone browsing).
 */
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCurrentCustomer } from "@/customer-auth/auth";
import { renderDescriptionHtml } from "@/catalog/description";
import { loadCourseContent, toCourseOutline, type CourseLesson } from "@/courses/content";
import { coursesEnabled } from "@/courses/flags";
import {
  customerHasCourseAccess,
  getCourseProductIdentity,
} from "@/courses/service";
import { isAllowedEmbedUrl } from "@/courses/video";
import { Icon } from "@/components/ui/icon";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "কোর্স — Advance Ecommerce",
  robots: { index: false, follow: false },
};

const KIND_LABEL: Record<CourseLesson["kind"], string> = {
  video: "ভিডিও",
  text: "লেখা",
  link: "লিংক",
};

/** One lesson for a BUYER. Only ever rendered after the access
 *  check has passed — the lesson object (with its body/URL) does
 *  not exist in this page's data otherwise. */
function LessonBody({ lesson }: { lesson: CourseLesson }) {
  if (lesson.kind === "video") {
    // Render-time host re-validation (save time already enforced
    // it): a hand-edited doc cannot smuggle an arbitrary iframe.
    if (!lesson.videoUrl || !isAllowedEmbedUrl(lesson.videoUrl)) {
      return (
        <p className="mt-2 text-sm text-text-muted">
          ভিডিওটি এখন দেখানো যাচ্ছে না — সাপোর্টে যোগাযোগ করুন।
        </p>
      );
    }
    return (
      <div className="mt-3 aspect-video w-full overflow-hidden rounded-xl bg-black">
        <iframe
          src={lesson.videoUrl}
          title={lesson.title}
          className="h-full w-full"
          loading="lazy"
          allow="accelerometer; autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
    );
  }
  if (lesson.kind === "text") {
    return (
      <div
        className="prose-sm mt-2 max-w-none break-words text-[15px] leading-8 text-text-muted [overflow-wrap:anywhere] [&_a]:text-brand-700 [&_a]:underline [&_h2]:mb-2 [&_h2]:mt-6 [&_h2]:font-display [&_h2]:text-lg [&_h2]:font-bold [&_h2]:text-text-main [&_h3]:mb-1.5 [&_h3]:mt-5 [&_h3]:font-display [&_h3]:text-base [&_h3]:font-bold [&_h3]:text-text-main [&_h4]:mb-1 [&_h4]:mt-4 [&_h4]:font-semibold [&_h4]:text-text-main [&_li]:ml-5 [&_ol]:list-decimal [&_p]:mb-3 [&_strong]:text-text-main [&_ul]:list-disc"
        dangerouslySetInnerHTML={{ __html: renderDescriptionHtml(lesson.bodyMd ?? "") }}
      />
    );
  }
  // kind === "link"
  if (!lesson.externalUrl || !/^https?:\/\//i.test(lesson.externalUrl)) {
    return <p className="mt-2 text-sm text-text-muted">লিংকটি এখন পাওয়া যাচ্ছে না।</p>;
  }
  return (
    <p className="mt-2">
      <a
        href={lesson.externalUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 font-semibold text-brand-700 hover:underline"
      >
        লিংকটি খুলুন
        <Icon name="arrow-right" size={15} />
      </a>
    </p>
  );
}

export default async function CoursePlayerPage({
  params,
}: {
  params: { productId: string };
}) {
  const customer = await getCurrentCustomer();
  if (customer === null) redirect("/account");

  const identity = await getCourseProductIdentity(params.productId);
  if (identity === null || !identity.isCourseProduct) notFound();

  if (!coursesEnabled()) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-10">
        <p className="text-sm">
          <a href="/account/courses" className="font-semibold text-brand-700 hover:underline">
            ← আমার কোর্স
          </a>
        </p>
        <h1 className="mt-2 font-display text-2xl font-bold text-text-main">
          {identity.productName}
        </h1>
        <p className="mt-3 text-sm leading-6 text-text-muted">
          কোর্স সুবিধাটি এই দোকানে এখনো চালু হয়নি।
        </p>
      </main>
    );
  }

  const hasAccess = await customerHasCourseAccess(customer.id, identity.productId);
  // For a buyer, `doc` (the full document, bodies included) feeds
  // the lesson render below. For everyone else the document is
  // read server-side ONLY to build the title projection via
  // toCourseOutline — no body, video URL, or link target from it
  // is rendered or serialised into the response.
  const doc = hasAccess ? await loadCourseContent(identity.productId) : null;
  const outline = hasAccess
    ? toCourseOutline(doc)
    : toCourseOutline(await loadCourseContent(identity.productId));

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-10">
      <p className="text-sm">
        <a href="/account/courses" className="font-semibold text-brand-700 hover:underline">
          ← আমার কোর্স
        </a>
      </p>
      <h1 className="mt-2 font-display text-2xl font-bold text-text-main">
        {identity.productName}
      </h1>

      {!hasAccess ? (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
          🔒 এই কোর্সের লেসনগুলো শুধু ক্রেতাদের জন্য। কোর্সটি কিনলে (পেমেন্ট সম্পন্ন হলে)
          সব লেসন এখানেই খুলে যাবে।
          <a
            href={`/product/${identity.slug}`}
            className="mt-2 inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2.5 font-semibold text-white transition hover:bg-brand-700"
          >
            কোর্সটি কিনুন
            <Icon name="arrow-right" size={15} />
          </a>
        </div>
      ) : null}

      {outline === null ? (
        <p className="mt-6 rounded-2xl border border-border bg-card p-5 text-sm leading-6 text-text-muted shadow-card">
          এই কোর্সের পাঠ্যক্রম এখনো প্রকাশিত হয়নি — কিছুদিন পর আবার দেখুন।
        </p>
      ) : hasAccess && doc !== null ? (
        <div className="mt-6 space-y-6">
          {doc.modules.map((mod, mi) => (
            <section
              key={mi}
              className="rounded-2xl border border-border bg-card p-5 shadow-card"
              aria-label={mod.title}
            >
              <h2 className="font-display text-lg font-bold text-text-main">
                মডিউল {mi + 1}: {mod.title}
              </h2>
              <div className="mt-4 space-y-5">
                {mod.lessons.map((lesson) => (
                  <article key={lesson.id} className="border-t border-border pt-4 first:border-t-0 first:pt-0">
                    <h3 className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-text-main">
                      {lesson.title}
                      <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-text-muted">
                        {KIND_LABEL[lesson.kind]}
                      </span>
                    </h3>
                    <LessonBody lesson={lesson} />
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        // Locked view: the outline projection only — titles and
        // kinds, rendered from `outline`, never from the full doc.
        <div className="mt-6 space-y-4">
          {outline.modules.map((mod, mi) => (
            <section
              key={mi}
              className="rounded-2xl border border-border bg-card p-5 shadow-card"
              aria-label={mod.title}
            >
              <h2 className="font-display text-lg font-bold text-text-main">
                মডিউল {mi + 1}: {mod.title}
              </h2>
              <ul className="mt-3 space-y-2">
                {mod.lessons.map((lesson) => (
                  <li
                    key={lesson.id}
                    className="flex items-center justify-between gap-3 text-sm text-text-muted"
                  >
                    <span className="min-w-0 truncate">🔒 {lesson.title}</span>
                    <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium">
                      {KIND_LABEL[lesson.kind]}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
