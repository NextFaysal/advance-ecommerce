/**
 * /account/courses — "আমার কোর্স" (ADV-23 vertical 6, LMS-lite).
 *
 * Lists the courses the signed-in customer CURRENTLY has access
 * to. Access is derived from their orders on every render (see
 * src/courses/service.ts for the rule) — a refunded or returned
 * course order drops off this list by itself; there is no
 * enrolment row to go stale. Logged-out visitors are sent to
 * /account. Flag OFF renders an honest "not enabled" notice — no
 * fake UI for a locked module.
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentCustomer } from "@/customer-auth/auth";
import { coursesEnabled } from "@/courses/flags";
import { listCustomerCourses } from "@/courses/service";
import { Icon } from "@/components/ui/icon";
import AccountNav from "../account-nav";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "আমার কোর্স — Advance Ecommerce",
  description: "আপনার কেনা কোর্সসমূহ — লেসন দেখুন।",
  robots: { index: false, follow: false },
};

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("bn-BD", { dateStyle: "medium" }).format(new Date(iso));
}

export default async function AccountCoursesPage() {
  const customer = await getCurrentCustomer();
  if (customer === null) redirect("/account");

  if (!coursesEnabled()) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-10 lg:max-w-5xl">
        <h1 className="font-display text-2xl font-bold text-text-main">আমার কোর্স</h1>
        <div className="lg:flex lg:items-start lg:gap-6">
          <AccountNav />
          <div className="min-w-0 flex-1">
            <p className="mt-6 rounded-2xl border border-border bg-card p-5 text-sm leading-6 text-text-muted shadow-card">
              কোর্স সুবিধাটি এই দোকানে এখনো চালু হয়নি।
            </p>
          </div>
        </div>
      </main>
    );
  }

  const courses = await listCustomerCourses(customer.id);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-10 lg:max-w-5xl">
      <h1 className="font-display text-2xl font-bold text-text-main">আমার কোর্স</h1>
      <p className="mt-1.5 text-sm leading-6 text-text-muted">
        কেনা কোর্সগুলোর লেসন এখান থেকে দেখুন। অর্ডার রিফান্ড বা রিটার্ন হলে সেই কোর্সের
        অ্যাক্সেস সরে যায়।
      </p>

      <div className="lg:flex lg:items-start lg:gap-6">
        <AccountNav />
        <div className="min-w-0 flex-1">
      {courses.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-border bg-card p-5 text-sm leading-6 text-text-muted shadow-card">
          এখনো কোনো কোর্স কেনা হয়নি।{" "}
          <a href="/shop" className="font-semibold text-brand-700 hover:underline">
            দোকানে যান
          </a>{" "}
          — পেমেন্ট সম্পন্ন হলেই কেনা কোর্স এখানে দেখা যাবে।
        </p>
      ) : (
        <ul className="mt-6 space-y-4">
          {courses.map((course) => (
            <li
              key={course.productId}
              className="rounded-2xl border border-border bg-card p-5 shadow-card"
            >
              <div className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-700"
                >
                  <span className="text-base" aria-hidden="true">▶</span>
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-base font-bold text-text-main">{course.productName}</h2>
                  <p className="mt-1 text-xs leading-5 text-text-muted">
                    অর্ডার {course.orderNo} · {formatDate(course.grantedAt)}
                    {course.outline
                      ? ` · ${course.outline.modules.length}টি মডিউল · ${course.outline.totalLessons}টি লেসন`
                      : " · পাঠ্যক্রম এখনো প্রকাশিত হয়নি"}
                  </p>
                </div>
              </div>
              <a
                href={`/account/courses/${course.productId}`}
                className="brand-gradient mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-md transition"
              >
                কোর্সে যান
                <Icon name="arrow-right" size={16} />
              </a>
            </li>
          ))}
        </ul>
      )}
        </div>
      </div>
    </main>
  );
}
