"use client";

import { useEffect, useState } from "react";
import {
  navItemLabel,
  type AdminNavGroup,
  type AdminNavItem,
} from "@/admin-nav/config";
import { pick } from "@/i18n/locale";
import { useLocale } from "@/i18n/LocaleProvider";
import { ADMIN_STRINGS } from "@/admin/strings";
import { ShellIcon } from "./icons";
import { NavGroups } from "./NavGroups";
import { isActiveItem } from "./nav-utils";

/**
 * MobileNav — phone admin navigation (doc 31, D2). md:hidden; tablets
 * and up use the Sidebar.
 *
 * Bottom tab bar: the same five pinned destinations as before, plus a
 * "More" button that opens a full-screen drawer rendering the FULL
 * grouped nav (NavGroups) — before D2, destinations outside the five
 * were unreachable from the phone shell. The drawer closes on route
 * change and on Escape, and locks body scroll while open. Safe-area
 * padding on the bar is kept (wave-17 lesson).
 */
export function MobileNav({
  groups,
  mobileItems,
  pathname,
  offFeatureFlags,
}: {
  groups: readonly AdminNavGroup[];
  mobileItems: readonly AdminNavItem[];
  pathname: string;
  /** Feature-flag keys currently OFF (live, from the admin layout);
   *  forwarded to the drawer's NavGroups for the lock badges. The
   *  bottom tab bar renders no badges, so it ignores this. */
  offFeatureFlags: readonly string[];
}) {
  const { locale } = useLocale();
  const s = pick(locale, ADMIN_STRINGS);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // A tapped drawer link navigates — the new pathname prop lands here
  // and the drawer must not stay open over the new page.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [drawerOpen]);

  return (
    <>
      {/* Bottom tab bar */}
      <nav
        aria-label={s.mobileNav}
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-card/95 px-2 pb-[env(safe-area-inset-bottom)] pt-1.5 shadow-pop backdrop-blur md:hidden"
      >
        {mobileItems.map((item) => {
          const active = isActiveItem(pathname, item);
          return (
            <a
              key={item.id}
              href={item.path}
              aria-current={active ? "page" : undefined}
              className={`focus-ring flex flex-1 flex-col items-center gap-0.5 rounded-md py-1.5 text-caption transition duration-fast ease-smooth ${
                active ? "font-semibold text-brand-700" : "font-medium text-text-muted"
              }`}
            >
              <span
                aria-hidden="true"
                className={`flex h-7 w-12 items-center justify-center rounded-full transition duration-fast ease-smooth ${
                  active ? "bg-brand-100" : ""
                }`}
              >
                <ShellIcon name={item.icon} className="h-5 w-5" />
              </span>
              {navItemLabel(item, locale)}
            </a>
          );
        })}
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={drawerOpen}
          className="focus-ring flex flex-1 flex-col items-center gap-0.5 rounded-md py-1.5 text-caption font-medium text-text-muted transition duration-fast ease-smooth"
        >
          <span aria-hidden="true" className="flex h-7 w-12 items-center justify-center rounded-full">
            <ShellIcon name="Menu" className="h-5 w-5" />
          </span>
          {s.moreNav}
        </button>
      </nav>

      {/* Full-nav drawer */}
      {drawerOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={s.allModules}
          className="fixed inset-0 z-50 flex animate-fade-slide-in flex-col bg-card md:hidden"
        >
          <div className="flex h-16 shrink-0 items-center gap-3 border-b border-border px-4">
            {/* Logo mark — one of the three sanctioned brand-gradient
                uses (hero / primary CTA / logo, doc 35); glow dropped
                in wave 3. */}
            <span aria-hidden="true" className="brand-gradient flex h-9 w-9 items-center justify-center rounded-md text-sm font-bold text-white">
              A
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-bold leading-5">Advance Ecommerce</span>
              <span className="block text-caption text-text-muted">{s.adminConsole}</span>
            </span>
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label={s.close}
              className="focus-ring flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-text-muted transition duration-fast hover:bg-surface-2 hover:text-text-main"
            >
              <ShellIcon name="X" className="h-5 w-5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 pb-[env(safe-area-inset-bottom)]">
            <NavGroups groups={groups} pathname={pathname} locale={locale} offFeatureFlags={offFeatureFlags} variant="drawer" />
          </div>
        </div>
      ) : null}
    </>
  );
}
