import {
  isLockedAddOnNow,
  navItemLabel,
  navSectionLabel,
  type AdminNavGroup,
} from "@/admin-nav/config";
import { pick, type Locale } from "@/i18n/locale";
import { ADMIN_STRINGS } from "@/admin/strings";
import { ShellIcon } from "./icons";
import { isActiveItem } from "./nav-utils";

/**
 * NavGroups — the grouped admin navigation list, shared by the desktop
 * Sidebar and the MobileNav full-nav drawer (doc 31, D2).
 *
 * Presentational only (no hooks), so the server Sidebar and the client
 * drawer render the identical list. When it sits inside the sidebar —
 * which carries `group/sidebar` + a `data-collapsed` attribute — the
 * `group-data-[collapsed=true]/sidebar:` variants below switch it to the
 * icons-only mini mode: labels and the add-on chip hide, section titles
 * become hairline dividers, and a dot on the icon tile keeps locked
 * add-ons recognisable. Outside the sidebar (the drawer) those variants
 * never match, so the list always renders in full mode.
 */
export function NavGroups({
  groups,
  pathname,
  locale,
  offFeatureFlags,
  variant = "sidebar",
}: {
  groups: readonly AdminNavGroup[];
  pathname: string;
  locale: Locale;
  /** Feature-flag keys currently OFF, resolved live by the admin
   *  layout from the unified flag store. An add-on item shows its
   *  lock badge (and mini-mode dot) only while its flag is in this
   *  list — enabling the flag removes the badge on the next render. */
  offFeatureFlags: readonly string[];
  /** Doc 35 wave 3: "drawer" (the MobileNav full-nav drawer) renders
   *  rows at the 44px mobile touch minimum; the desktop "sidebar"
   *  keeps its denser 40px rows. */
  variant?: "sidebar" | "drawer";
}) {
  const s = pick(locale, ADMIN_STRINGS);
  const offFlags = new Set(offFeatureFlags);
  return (
    <>
      {groups.map((group) => (
        <div key={group.section.id} className="mb-5 last:mb-2">
          <p className="px-3 pb-2 text-caption font-semibold uppercase tracking-wide text-text-subtle group-data-[collapsed=true]/sidebar:hidden">
            {navSectionLabel(group.section, locale)}
          </p>
          <div
            aria-hidden="true"
            className="mx-auto mb-3 hidden h-px w-8 bg-border group-data-[collapsed=true]/sidebar:block"
          />
          <nav aria-label={navSectionLabel(group.section, locale)} className="space-y-1">
            {group.items.map((item) => {
              const active = isActiveItem(pathname, item);
              const locked = isLockedAddOnNow(item, offFlags);
              const label = navItemLabel(item, locale);
              return (
                <a
                  key={item.id}
                  href={item.path}
                  aria-current={active ? "page" : undefined}
                  aria-label={label}
                  title={label}
                  className={`focus-ring group relative flex ${variant === "drawer" ? "min-h-[44px]" : "min-h-[40px]"} items-center gap-3 rounded-md py-2 pl-3 pr-2 text-sm transition duration-fast ease-smooth group-data-[collapsed=true]/sidebar:justify-center group-data-[collapsed=true]/sidebar:gap-0 group-data-[collapsed=true]/sidebar:px-0 ${
                    active
                      ? "bg-brand-soft font-semibold text-brand-ink shadow-xs"
                      : "font-medium text-text-muted hover:bg-surface-2 hover:text-text-main"
                  }`}
                >
                  {active ? (
                    /* Solid brand bar (doc 35 wave 3): the gradient is
                       reserved for hero / primary CTA / logo marks,
                       not nav indicators. */
                    <span aria-hidden="true" className="absolute inset-y-2 left-0 w-1 rounded-full bg-brand" />
                  ) : null}
                  <span
                    aria-hidden="true"
                    className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] transition duration-fast ease-smooth ${
                      active
                        ? "bg-surface-raised text-brand-ink shadow-xs"
                        : "text-text-subtle group-hover:text-brand-600"
                    }`}
                  >
                    <ShellIcon name={item.icon} className="h-[18px] w-[18px]" />
                    {locked ? (
                      <span className="absolute -right-0.5 -top-0.5 hidden h-2 w-2 rounded-full bg-warning-solid ring-2 ring-card group-data-[collapsed=true]/sidebar:block" />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate group-data-[collapsed=true]/sidebar:hidden">
                    {label}
                  </span>
                  {locked ? (
                    <span className="flex shrink-0 items-center gap-1 rounded-full border border-warning-solid/30 bg-warning-soft px-2 py-0.5 text-caption font-semibold text-warning-solid group-data-[collapsed=true]/sidebar:hidden">
                      <ShellIcon name="Lock" className="h-3 w-3" />
                      {s.addOn}
                    </span>
                  ) : null}
                </a>
              );
            })}
          </nav>
        </div>
      ))}
    </>
  );
}
