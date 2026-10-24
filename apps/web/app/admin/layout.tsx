import type { ReactNode } from "react";
import { ADMIN_NAV, groupBySection, isLockedAddOn } from "@/admin-nav/config";
import { CommandPalette } from "@/command-palette";

// Navigation comes from src/admin-nav/config.ts (single source).
// Showing an item here is UX only — every admin API route still enforces
// its session + permission server-side, and flag-gated add-ons stay
// listed with a lock badge (never hidden).
const navGroups = groupBySection(ADMIN_NAV);
const mobileNav = ADMIN_NAV.filter((item) =>
  ["/admin", "/admin/orders", "/admin/products", "/admin/customers", "/admin/modules"].includes(item.path),
);

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg-app text-text-main">
      <CommandPalette />
      {/* Topbar — 64px, sticky, translucent (Part I §6; glass sparingly, Part II §19) */}
      <header className="sticky top-0 z-40 flex h-16 items-center gap-4 border-b border-border bg-card/80 px-4 backdrop-blur sm:px-6">
        <span className="font-bold text-brand-700">Advance Ecommerce</span>
        <input
          aria-label="Global search"
          placeholder="Search…  ⌘K"
          className="hidden h-10 min-w-0 flex-1 rounded-[10px] border border-border bg-card px-3 text-sm outline-none focus:border-brand-500 md:block"
        />
        <span className="ml-auto flex items-center gap-2">
          <button type="button" className="min-h-[44px] rounded-md px-3 hover:bg-surface-2">+ New</button>
          <button type="button" aria-label="Notifications" className="min-h-[44px] min-w-[44px] rounded-md hover:bg-surface-2">🔔 3</button>
          <button type="button" aria-label="Toggle language" className="min-h-[44px] rounded-md px-3 hover:bg-surface-2">বাং / EN</button>
          <span aria-label="Admin avatar" className="flex h-10 w-10 items-center justify-center rounded-full brand-gradient text-white">N</span>
        </span>
      </header>

      <div className="flex">
        {/* Sidebar — 264px desktop, hidden on phone (bottom nav instead) */}
        <aside className="sticky top-16 hidden h-[calc(100vh-64px)] w-[264px] shrink-0 flex-col overflow-y-auto border-r border-border bg-card p-4 md:flex">
          {navGroups.map((group) => (
            <div key={group.section.id} className="mb-4">
              <p className="px-2 text-xs font-medium text-text-muted">{group.section.labelBn}</p>
              <nav aria-label={group.section.labelEn} className="mt-2 space-y-1">
                {group.items.map((item) => (
                  <a
                    key={item.id}
                    href={item.path}
                    className="flex items-center justify-between rounded-md px-3 py-2 text-sm text-text-main hover:bg-surface-2"
                  >
                    <span>{item.labelBn}</span>
                    {isLockedAddOn(item) ? (
                      <span className="text-xs text-text-muted">🔒 অ্যাড-অন</span>
                    ) : null}
                  </a>
                ))}
              </nav>
            </div>
          ))}
        </aside>

        <main className="min-w-0 flex-1 px-4 py-6 pb-24 sm:px-6 md:pb-6">
          <div className="mx-auto max-w-[1440px]">{children}</div>
        </main>
      </div>

      {/* Mobile bottom tab bar — Part II §18 */}
      <nav aria-label="Mobile admin navigation" className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-card px-2 py-2 md:hidden">
        {mobileNav.map((item) => (
          <a key={item.id} href={item.path} className="flex flex-1 flex-col items-center py-1 text-xs text-text-muted">
            {item.labelBn}
          </a>
        ))}
      </nav>
    </div>
  );
}
