"use client";

/**
 * Account nav rail (doc 32, P6) — the ONE navigation pattern for the
 * customer account area, replacing every subpage's hand-rolled
 * back-link header. Rendered by the hub and every account subpage:
 *
 *   - phone: a horizontal scrolling chip row (44px targets);
 *   - desktop (lg+): a sticky left rail card aligned with the P6
 *     section-card pattern.
 *
 * Entries are only the routes that exist today (hub, the hub's orders
 * section, preferences, subscriptions, tickets, courses, B2B); labels
 * come from ACCOUNT_STRINGS via useLocale() (doc 30). Subpages keep
 * their own module gates — a locked module still renders its honest
 * notice at its route. Active state follows the pathname; the two hub
 * entries are split by the #orders hash.
 *
 * Presentation only: no data is fetched and no route changes.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/icon";
import { useLocale } from "@/i18n/LocaleProvider";
import { pick } from "@/i18n/locale";
import { ACCOUNT_STRINGS } from "./strings";

interface NavEntry {
  href: string;
  label: string;
  icon: IconName;
  isActive: (pathname: string, hash: string) => boolean;
}

export default function AccountNav() {
  const pathname = usePathname() ?? "/account";
  const { locale } = useLocale();
  const s = pick(locale, ACCOUNT_STRINGS);
  const [hash, setHash] = useState("");

  // The Orders entry points at the hub's orders section (#orders);
  // track the hash so Overview vs Orders highlight correctly.
  useEffect(() => {
    const read = () => setHash(window.location.hash);
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, [pathname]);

  const entries: NavEntry[] = [
    {
      href: "/account",
      label: s.backToAccountText,
      icon: "user",
      isActive: (p, h) => p === "/account" && h !== "#orders",
    },
    {
      href: "/account#orders",
      label: s.myOrders,
      icon: "package",
      isActive: (p, h) => p === "/account" && h === "#orders",
    },
    {
      href: "/account/preferences",
      label: s.navPreferences,
      icon: "settings",
      isActive: (p) => p.startsWith("/account/preferences"),
    },
    {
      href: "/account/subscriptions",
      label: s.mySubscriptions,
      icon: "refresh-ccw",
      isActive: (p) => p.startsWith("/account/subscriptions"),
    },
    {
      href: "/account/tickets",
      label: s.myTickets,
      icon: "info",
      isActive: (p) => p.startsWith("/account/tickets"),
    },
    {
      href: "/account/courses",
      label: s.myCourses,
      icon: "sparkles",
      isActive: (p) => p.startsWith("/account/courses"),
    },
    {
      href: "/account/b2b",
      label: s.b2bPortal,
      icon: "store",
      isActive: (p) => p.startsWith("/account/b2b"),
    },
  ];

  return (
    <>
      {/* Phone: horizontal scrolling chip row */}
      <nav aria-label={s.navAriaLabel} className="mt-6 lg:hidden">
        <ul className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {entries.map((entry) => {
            const active = entry.isActive(pathname, hash);
            return (
              <li key={entry.href} className="shrink-0">
                <Link
                  href={entry.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full border px-4 text-sm transition ${
                    active
                      ? "brand-gradient border-transparent font-semibold text-white shadow-md"
                      : "border-border bg-card font-medium text-text-muted hover:bg-surface-2 hover:text-text-main"
                  }`}
                >
                  <Icon name={entry.icon} size={16} />
                  {entry.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Desktop: sticky left rail */}
      <aside className="mt-6 hidden w-60 shrink-0 lg:block">
        <nav
          aria-label={s.navAriaLabel}
          className="sticky top-24 rounded-2xl border border-border bg-card p-2.5 shadow-card"
        >
          <ul className="space-y-1">
            {entries.map((entry) => {
              const active = entry.isActive(pathname, hash);
              return (
                <li key={entry.href}>
                  <Link
                    href={entry.href}
                    aria-current={active ? "page" : undefined}
                    className={`flex min-h-11 items-center gap-2.5 rounded-xl px-3.5 text-sm transition ${
                      active
                        ? "bg-brand-soft font-semibold text-brand-ink"
                        : "font-medium text-text-muted hover:bg-surface-2 hover:text-text-main"
                    }`}
                  >
                    <Icon name={entry.icon} size={18} />
                    {entry.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>
    </>
  );
}
