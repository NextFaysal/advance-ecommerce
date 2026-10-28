import type { AdminNavGroup } from "@/admin-nav/config";
import { pick, type Locale } from "@/i18n/locale";
import { ADMIN_STRINGS } from "@/admin/strings";
import { NavGroups } from "./NavGroups";
import { SidebarToggle } from "./SidebarToggle";

/**
 * Sidebar — desktop admin navigation (doc 31, D2; Aurora Pro).
 *
 * Server component: brand lockup + store status card at the head, the
 * grouped nav (NavGroups) in a thin-scrollbar scroll area, and the
 * session/user card + collapse toggle at the foot. Hidden below md —
 * phones use MobileNav instead.
 *
 * Mini mode: the aside carries `group/sidebar` and starts expanded
 * (`data-collapsed="false"`); SidebarToggle flips the attribute from
 * localStorage, and the `group-data-[collapsed=true]/sidebar:` variants
 * across this file + NavGroups collapse widths (272px → 76px), hide
 * labels and centre the remaining icons. Per the D7 breakpoint
 * contract, SidebarToggle also forces the attribute on in the
 * 768–1279px band regardless of the stored preference.
 */
export function Sidebar({
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
    <aside
      data-admin-sidebar
      data-collapsed="false"
      className="group/sidebar sticky top-0 hidden h-screen w-[272px] shrink-0 flex-col border-r border-border bg-card transition-[width] duration-base ease-smooth md:flex data-[collapsed=true]:w-[76px]"
    >
      {/* Brand lockup + store chip */}
      <div className="border-b border-border bg-gradient-to-b from-brand-soft/70 to-transparent px-5 pb-4 pt-5 group-data-[collapsed=true]/sidebar:px-3">
        <a href="/admin" className="flex items-center gap-3 group-data-[collapsed=true]/sidebar:justify-center">
          <span aria-hidden="true" className="brand-gradient flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-base font-bold text-white shadow-glow">
            A
          </span>
          <span className="min-w-0 group-data-[collapsed=true]/sidebar:hidden">
            <span className="block truncate text-[15px] font-bold leading-5">Advance Ecommerce</span>
            <span className="block text-caption text-text-muted">{s.adminConsole}</span>
          </span>
        </a>
        <div className="mt-4 flex items-center gap-2 rounded-md bg-surface-2 px-3 py-2 group-data-[collapsed=true]/sidebar:justify-center group-data-[collapsed=true]/sidebar:px-0">
          <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-success-solid motion-safe:animate-pulse" />
          <span className="truncate text-small font-medium group-data-[collapsed=true]/sidebar:hidden">{s.myStore}</span>
          <span className="ml-auto rounded-full bg-success-soft px-2 py-0.5 text-caption font-semibold text-success-solid group-data-[collapsed=true]/sidebar:hidden">
            {s.live}
          </span>
        </div>
      </div>

      {/* Nav groups — the global thin themed scrollbar (globals.css)
          styles this scroll area in both modes. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <NavGroups groups={groups} pathname={pathname} locale={locale} />
      </div>

      {/* Sidebar footer — collapse toggle + session chip */}
      <div className="border-t border-border px-3 py-3">
        <SidebarToggle collapseLabel={s.collapseSidebar} expandLabel={s.expandSidebar} />
        <div className="mt-2 flex items-center gap-3 rounded-md px-2 py-1.5 group-data-[collapsed=true]/sidebar:justify-center group-data-[collapsed=true]/sidebar:px-0">
          <span aria-label={s.adminAvatar} className="brand-gradient flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ring-2 ring-brand-100">
            N
          </span>
          <span className="min-w-0 group-data-[collapsed=true]/sidebar:hidden">
            <span className="block truncate text-small font-semibold">{s.admin}</span>
            <span className="block text-caption text-text-muted">{s.sessionActive}</span>
          </span>
        </div>
      </div>
    </aside>
  );
}
