import { PageHeader } from "@/components/ui/page-header";
import { coursesEnabled } from "@/courses/flags";
import { pick } from "@/i18n/locale";
import { getRequestLocale } from "@/i18n/server";
import { COURSES_STRINGS } from "./strings";
import { CoursesConfigCard } from "./courses-config-card";
import { CoursesContentCard } from "./courses-content-card";

// Admin > Courses — ADV-23 vertical 6 (doc 23, wave 56), the last
// ADV-23 vertical. Locked state: while module.courses is OFF (the
// seeded default — paid add-on), the page renders the lock panel
// instead of data, matching the sibling vertical pages. The config
// and content APIs stay reachable without the flag (settings- /
// products-guarded) so a merchant can prepare courses before
// enabling the module.

export const dynamic = "force-dynamic";

export default async function CoursesPage() {
  const s = pick(await getRequestLocale(), COURSES_STRINGS);
  if (!coursesEnabled()) {
    return (
      <div className="space-y-6">
        <PageHeader title={s.title} />
        <p role="status" className="rounded-2xl border border-border/60 bg-card px-5 py-4 text-sm text-text-muted shadow-xs">
          {s.lockedPrefix} <code className="font-mono text-xs">module.courses</code> {s.lockedSuffix}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={s.title} description={s.description} />
      <CoursesContentCard />
      <CoursesConfigCard />
    </div>
  );
}
