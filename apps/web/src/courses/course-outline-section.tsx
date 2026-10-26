/**
 * PDP course outline (ADV-23 vertical 6, wave 56) — the PUBLIC
 * view of a course product: module + lesson TITLES and kinds only.
 *
 * The props are the CourseOutline projection from
 * src/courses/content.ts (toCourseOutline) — by construction this
 * component can never receive a lesson body, a video URL, or an
 * external link target, so nothing buyer-only can leak through the
 * (ISR-cached) product page. Buyers watch/read inside the account
 * player; this section ends with that pointer.
 */
import { Reveal } from "@/components/ui/reveal";
import type { CourseOutline, LessonKind } from "./content";

const KIND_LABEL: Record<LessonKind, string> = {
  video: "ভিডিও",
  text: "লেখা",
  link: "লিংক",
};

export function CourseOutlineSection({ outline }: { outline: CourseOutline }) {
  if (outline.modules.length === 0) return null;
  return (
    <Reveal>
      <section
        className="mt-10 rounded-3xl border border-border bg-card p-6 shadow-card sm:p-8"
        aria-label="কোর্সের পাঠ্যক্রম"
      >
        <h2 className="font-display text-xl font-extrabold text-text-main">কোর্সের পাঠ্যক্রম</h2>
        <p className="mt-1.5 text-sm leading-6 text-text-muted">
          মোট {outline.modules.length}টি মডিউল · {outline.totalLessons}টি লেসন। কোর্সটি কিনলে
          সব লেসন আপনার অ্যাকাউন্টের{" "}
          <a href="/account/courses" className="font-semibold text-brand-700 hover:underline">
            আমার কোর্স
          </a>{" "}
          পেজে খুলে যাবে।
        </p>
        <div className="mt-5 max-w-3xl space-y-4">
          {outline.modules.map((mod, mi) => (
            <div key={mi} className="rounded-2xl border border-border px-4 py-3">
              <h3 className="text-[15px] font-bold text-text-main">
                মডিউল {mi + 1}: {mod.title}
              </h3>
              <ul className="mt-2 space-y-1.5">
                {mod.lessons.map((lesson) => (
                  <li
                    key={lesson.id}
                    className="flex items-center justify-between gap-3 text-sm text-text-muted"
                  >
                    <span className="min-w-0 truncate">{lesson.title}</span>
                    <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium">
                      {KIND_LABEL[lesson.kind]}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </Reveal>
  );
}
