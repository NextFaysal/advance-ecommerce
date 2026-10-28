import { headers } from "next/headers";
import { ADMIN_NAV, groupBySection } from "@/admin-nav/config";
import { featureFlags } from "@/lib/feature-flags";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { AdminCommandPaletteLazy } from "./command-palette-lazy";
import { getRequestLocale } from "@/i18n/server";
import { Sidebar } from "@/admin-shell/Sidebar";
import { Topbar } from "@/admin-shell/Topbar";
import { MobileNav } from "@/admin-shell/MobileNav";
import { MOBILE_NAV_ITEMS } from "@/admin-shell/nav-utils";
import { PresenceHeartbeatGlobal } from "./presence-heartbeat";

// Navigation comes from src/admin-nav/config.ts (single source).
// Showing an item here is UX only — every admin API route still enforces
// its session + permission server-side, and flag-gated add-ons stay
// listed (never hidden), showing a lock badge only while their flag is
// OFF — resolved live below from the unified flag store, so enabling a
// flag in Admin → Feature Flags drops the badge on the next render.
//
// Shell composition (doc 31, D2): this layout stays a thin server
// component — Sidebar / Topbar / MobileNav live in src/admin-shell/,
// with the interactive islands (sidebar collapse, mobile drawer, ⌘K
// palette, switchers) as small client components inside them.
const navGroups = groupBySection(ADMIN_NAV);

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Auth screens (login / 2FA / invite acceptance) render WITHOUT the
  // admin shell: an unauthenticated visitor must never see the
  // navigation or topbar.
  const pathname = (await headers()).get("x-pathname") ?? "";
  if (pathname.startsWith("/admin/login") || pathname.startsWith("/admin/accept-invite")) {
    return (
      <>
        {/* JetBrains Mono is scoped to the admin shell (perf wave,
            2026-10-28): the root layout loads only Hind Siliguri +
            Plus Jakarta Sans, and admin is where font-mono is actually
            used (IDs, SKUs, data tables). Weights 400/600 are the ones
            the design uses (see src/styles/fonts.css provenance). */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&display=swap"
        />
        <div className="min-h-screen bg-bg-app text-text-main">{children}</div>
      </>
    );
  }

  const locale = await getRequestLocale();

  // Live add-on lock state: hydrate the DB flag source (TTL-cached,
  // cheap on repeat renders) and collect the nav flags that are
  // currently OFF. Passed down as a plain serialisable list; the nav
  // renderers show the lock badge only for items whose flag is in it
  // (isLockedAddOnNow in src/admin-nav/config.ts).
  await ensureDbFeatureFlags();
  const offFeatureFlags = [
    ...new Set(
      ADMIN_NAV.map((item) => item.featureFlag).filter(
        (key): key is string =>
          key !== null && !featureFlags.isFeatureEnabled(key),
      ),
    ),
  ];

  return (
    <div className="min-h-screen bg-bg-app text-text-main">
      {/* JetBrains Mono, scoped to the admin shell — see the auth-branch
          return above for why this lives here and not in the root layout. */}
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&display=swap"
      />
      {/* ⌘K palette, lazy (admin perf wave B1): only the eager
          listener shim in command-palette-lazy.tsx mounts here; the
          palette chunk loads on the first ⌘K / topbar-trigger press,
          which still opens it on that first press. */}
      <AdminCommandPaletteLazy offFeatureFlags={offFeatureFlags} />
      {/* Staff presence heartbeat for the current /admin path
          (renders nothing; auth screens returned above, so they
          never heartbeat). */}
      <PresenceHeartbeatGlobal />
      <div className="flex">
        <Sidebar groups={navGroups} pathname={pathname} locale={locale} offFeatureFlags={offFeatureFlags} />
        {/* Content column */}
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar pathname={pathname} locale={locale} />
          <main className="min-w-0 flex-1 px-4 py-6 pb-24 sm:px-6 md:pb-8">
            <div className="mx-auto w-full max-w-[1440px]">{children}</div>
          </main>
        </div>
      </div>

      <MobileNav groups={navGroups} mobileItems={MOBILE_NAV_ITEMS} pathname={pathname} offFeatureFlags={offFeatureFlags} />
    </div>
  );
}
