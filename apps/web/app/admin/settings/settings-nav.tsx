"use client";

/**
 * SettingsNav — the settings section rail (doc 31, D6).
 *
 * One rail for the whole settings subtree: on desktop it is a sticky
 * vertical nav (the two-column settings pattern — rail + panel); on
 * phone it collapses to a horizontally scrolling pill row above the
 * panel. Labels come from the settings dictionary's own card titles
 * (the same strings the settings index cards use), so the rail never
 * invents copy. Active state derives from the pathname only.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/icon";
import { useLocale } from "@/i18n/LocaleProvider";
import { pick } from "@/i18n/locale";
import { SETTINGS_STRINGS, type SettingsStrings } from "./strings";

interface RailItem {
  href: string;
  icon: IconName;
  label: (s: SettingsStrings) => string;
}

const ITEMS: RailItem[] = [
  { href: "/admin/settings", icon: "grid", label: (s) => s.idxTitle },
  { href: "/admin/settings/payments", icon: "credit-card", label: (s) => s.cardPaymentsTitle },
  { href: "/admin/settings/shipping", icon: "truck", label: (s) => s.cardShippingTitle },
  { href: "/admin/settings/notifications", icon: "bell", label: (s) => s.cardNotificationsTitle },
  { href: "/admin/settings/integrations", icon: "settings", label: (s) => s.cardIntegrationsTitle },
  { href: "/admin/settings/connectors", icon: "sparkles", label: (s) => s.cardConnectorsTitle },
  { href: "/admin/settings/tracking", icon: "chart", label: (s) => s.cardTrackingTitle },
  { href: "/admin/settings/accounting", icon: "banknote", label: (s) => s.cardAccountingTitle },
  { href: "/admin/settings/orders", icon: "cart", label: (s) => s.cardOrdersTitle },
  { href: "/admin/settings/checkout-fields", icon: "package", label: (s) => s.cardCheckoutTitle },
  { href: "/admin/settings/call-center", icon: "phone", label: (s) => s.cardCallCenterTitle },
  { href: "/admin/settings/privacy", icon: "shield", label: (s) => s.cardPrivacyTitle },
  { href: "/admin/settings/templates", icon: "tag", label: (s) => s.cardTemplatesTitle },
];

export function SettingsNav() {
  const pathname = usePathname();
  const { locale } = useLocale();
  const s = pick(locale, SETTINGS_STRINGS);
  return (
    <nav
      aria-label={s.idxTitle}
      className="flex gap-1 overflow-x-auto pb-1 lg:sticky lg:top-6 lg:flex-col lg:overflow-visible lg:rounded-3xl lg:border lg:border-border/60 lg:bg-card lg:p-2 lg:shadow-card"
    >
      {ITEMS.map((item) => {
        const active =
          item.href === "/admin/settings"
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-xl px-3 py-2.5 text-sm transition duration-fast ease-smooth ${
              active
                ? "bg-brand-soft font-semibold text-brand-ink"
                : "font-medium text-text-muted hover:bg-surface-2 hover:text-text-main"
            }`}
          >
            <Icon name={item.icon} size={17} />
            {item.label(s)}
          </Link>
        );
      })}
    </nav>
  );
}
