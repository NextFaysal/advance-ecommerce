import {
  isLockedAddOn,
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
}: {
  groups: readonly AdminNavGroup[];
  pathname: string;
  locale: Locale;
}) {
  const s = pick(locale, ADMIN_STRINGS);
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
              const locked = isLockedAddOn(item);
              const label = navItemLabel(item, locale);
              return (
                <a
                  key={item.id}
                  href={item.path}
                  aria-current={active ? "page" : undefined}
                  aria-label={label}
                  title={label}
                  className={`focus-ring group relative flex min-h-[40px] items-center gap-3 rounded-md py-2 pl-3 pr-2 text-sm transition duration-fast ease-smooth group-data-[collapsed=true]/sidebar:justify-center group-data-[collapsed=true]/sidebar:gap-0 group-data-[collapsed=true]/sidebar:px-0 ${
                    active
                      ? "bg-brand-soft font-semibold text-brand-ink shadow-xs"
                      : "font-medium text-text-muted hover:bg-surface-2 hover:text-text-main"
                  }`}
                >
                  {active ? (
                    <span aria-hidden="true" className="brand-gradient absolute inset-y-2 left-0 w-1 rounded-full" />
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
