import type { ReactNode } from "react";
import { headers } from "next/headers";
import { ADMIN_NAV, groupBySection, isLockedAddOn, type AdminNavItem } from "@/admin-nav/config";
import { AdminCommandPalette, CommandPaletteTrigger } from "@/admin/command-palette";

// Navigation comes from src/admin-nav/config.ts (single source).
// Showing an item here is UX only — every admin API route still enforces
// its session + permission server-side, and flag-gated add-ons stay
// listed with a lock badge (never hidden).
const navGroups = groupBySection(ADMIN_NAV);
const mobileNav = ADMIN_NAV.filter((item) =>
  ["/admin", "/admin/orders", "/admin/products", "/admin/customers", "/admin/modules"].includes(item.path),
);

/* ------------------------------------------------------------------ */
/* Sidebar/topbar icons — inline SVG in the Lucide stroke style        */
/* (1.8px stroke, round caps). lucide-react is not installed, and the  */
/* nav config stores Lucide names only, so the shell maps names here.  */
/* ------------------------------------------------------------------ */
const ICON_PATHS: Record<string, ReactNode> = {
  LayoutDashboard: (<><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></>),
  ShoppingCart: (<><circle cx="8" cy="21" r="1" /><circle cx="19" cy="21" r="1" /><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" /></>),
  CreditCard: (<><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></>),
  Truck: (<><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2" /><path d="M15 18h-5" /><path d="M15 8h4l3 5v4a1 1 0 0 1-1 1h-2" /><circle cx="7" cy="18" r="2" /><circle cx="17" cy="18" r="2" /></>),
  PhoneCall: (<><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" /><path d="M15 3a6 6 0 0 1 6 6" /><path d="M15 7a2 2 0 0 1 2 2" /></>),
  Bike: (<><circle cx="18.5" cy="17.5" r="3.5" /><circle cx="5.5" cy="17.5" r="3.5" /><circle cx="15" cy="5" r="1" /><path d="M12 17.5V14l-3-3 4-3 2 3h2" /></>),
  Store: (<><path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7" /><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" /><path d="M2 7h20v5H2z" /><path d="M9 22v-6h6v6" /></>),
  Inbox: (<><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></>),
  MapPin: (<><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></>),
  Split: (<><path d="M16 3h5v5" /><path d="M8 3H3v5" /><path d="m21 3-7.536 7.536a2 2 0 0 1-1.414.584H9" /><path d="m3 3 7.536 7.536A2 2 0 0 0 11.95 11.12H15" /><path d="M12 12v9" /></>),
  Package: (<><path d="m7.5 4.27 9 5.15" /><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" /></>),
  Warehouse: (<><path d="M22 8.35V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.35A2 2 0 0 1 3.26 6.5l8-3.2a2 2 0 0 1 1.48 0l8 3.2A2 2 0 0 1 22 8.35Z" /><path d="M6 18h12" /><path d="M6 14h12" /><path d="M10 22v-4h4v4" /></>),
  FileText: (<><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path d="M10 9H8" /><path d="M16 13H8" /><path d="M16 17H8" /></>),
  Users: (<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>),
  Megaphone: (<><path d="m3 11 18-5v12L3 14v-3z" /><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" /></>),
  Rocket: (<><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" /><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" /><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" /><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" /></>),
  Gift: (<><rect x="3" y="8" width="18" height="4" rx="1" /><path d="M12 8v13" /><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" /><path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5" /></>),
  Sparkles: (<><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" /></>),
  BarChart3: (<><path d="M3 3v18h18" /><path d="M18 17V9" /><path d="M13 17V5" /><path d="M8 17v-3" /></>),
  LineChart: (<><path d="M3 3v18h18" /><path d="m19 9-5 5-4-4-3 3" /></>),
  TrendingUp: (<><polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" /></>),
  Workflow: (<><rect x="3" y="3" width="6" height="6" rx="1" /><rect x="15" y="15" width="6" height="6" rx="1" /><path d="M9 6h6a3 3 0 0 1 3 3v6" /><circle cx="6" cy="18" r="3" /></>),
  ShieldAlert: (<><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /><path d="M12 8v4" /><path d="M12 16h.01" /></>),
  Blocks: (<><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /></>),
  Calculator: (<><rect x="4" y="2" width="16" height="20" rx="2" /><line x1="8" x2="16" y1="6" y2="6" /><line x1="16" x2="16" y1="14" y2="18" /><path d="M16 10h.01" /><path d="M12 10h.01" /><path d="M8 10h.01" /><path d="M12 14h.01" /><path d="M8 14h.01" /><path d="M12 18h.01" /><path d="M8 18h.01" /></>),
  Building2: (<><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" /><path d="M2 22h20" /><path d="M9 6h1" /><path d="M14 6h1" /><path d="M9 10h1" /><path d="M14 10h1" /><path d="M9 14h1" /><path d="M14 14h1" /><path d="M10 22v-3h4v3" /></>),
  Briefcase: (<><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></>),
  Settings: (<><circle cx="12" cy="12" r="3" /><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" /></>),
  Bell: (<><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></>),
  Flag: (<><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" x2="4" y1="22" y2="15" /></>),
  ListOrdered: (<><line x1="10" x2="21" y1="6" y2="6" /><line x1="10" x2="21" y1="12" y2="12" /><line x1="10" x2="21" y1="18" y2="18" /><path d="M4 6h1v4" /><path d="M4 10h2" /><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" /></>),
  Palette: (<><circle cx="13.5" cy="6.5" r=".5" /><circle cx="17.5" cy="10.5" r=".5" /><circle cx="8.5" cy="7.5" r=".5" /><circle cx="6.5" cy="12.5" r=".5" /><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.685 1.685 0 0 1 1.69-1.688H21c.928 0 1.664-.75 1.664-1.686C22.664 6.5 17.5 2 12 2z" /></>),
  Plug: (<><path d="M12 22v-5" /><path d="M9 8V2" /><path d="M15 8V2" /><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" /></>),
  ScrollText: (<><path d="M15 2h-8a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path d="M9 13h6" /><path d="M9 17h6" /></>),
  Lock: (<><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>),
  Search: (<><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></>),
  Plus: (<><path d="M12 5v14M5 12h14" /></>),
  ChevronRight: (<><path d="m9 18 6-6-6-6" /></>),
};

function Icon({ name, className = "h-5 w-5" }: { name: string; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {ICON_PATHS[name] ?? <circle cx="12" cy="12" r="3" />}
    </svg>
  );
}

function isActiveItem(pathname: string, item: AdminNavItem): boolean {
  if (item.path === "/admin") return pathname === "/admin";
  return pathname === item.path || pathname.startsWith(`${item.path}/`);
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Auth screens (login / 2FA / invite acceptance) render WITHOUT the
  // admin shell: an unauthenticated visitor must never see the
  // navigation or topbar.
  const pathname = (await headers()).get("x-pathname") ?? "";
  if (pathname.startsWith("/admin/login") || pathname.startsWith("/admin/accept-invite")) {
    return <div className="min-h-screen bg-bg-app text-text-main">{children}</div>;
  }

  const activeItem =
    ADMIN_NAV.filter((item) => isActiveItem(pathname, item)).sort(
      (a, b) => b.path.length - a.path.length,
    )[0] ?? ADMIN_NAV[0];

  return (
    <div className="min-h-screen bg-bg-app text-text-main">
      <AdminCommandPalette />
      <div className="flex">
        {/* Sidebar — full-height, sticky; hidden on phone (bottom nav instead) */}
        <aside className="sticky top-0 hidden h-screen w-[272px] shrink-0 flex-col border-r border-border bg-card md:flex">
          {/* Brand lockup + store chip */}
          <div className="border-b border-border px-5 pb-4 pt-5">
            <a href="/admin" className="flex items-center gap-3">
              <span aria-hidden="true" className="brand-gradient flex h-10 w-10 items-center justify-center rounded-md text-base font-bold text-white shadow-md">
                A
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-bold leading-5">Advance Ecommerce</span>
                <span className="block text-caption text-text-muted">অ্যাডমিন কনসোল</span>
              </span>
            </a>
            <div className="mt-4 flex items-center gap-2 rounded-md bg-surface-2 px-3 py-2">
              <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
              <span className="truncate text-small font-medium">আমার দোকান</span>
              <span className="ml-auto rounded-full bg-emerald-50 px-2 py-0.5 text-caption font-semibold text-emerald-700">
                লাইভ
              </span>
            </div>
          </div>

          {/* Nav groups */}
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
            {navGroups.map((group) => (
              <div key={group.section.id} className="mb-5 last:mb-2">
                <p className="px-3 pb-2 text-caption font-semibold tracking-wide text-text-subtle">
                  {group.section.labelBn}
                </p>
                <nav aria-label={group.section.labelEn} className="space-y-1">
                  {group.items.map((item) => {
                    const active = isActiveItem(pathname, item);
                    const locked = isLockedAddOn(item);
                    return (
                      <a
                        key={item.id}
                        href={item.path}
                        aria-current={active ? "page" : undefined}
                        className={`group relative flex min-h-[40px] items-center gap-3 rounded-md py-2 pl-3 pr-2 text-sm transition motion-fast ${
                          active
                            ? "bg-brand-50 font-semibold text-brand-700"
                            : "font-medium text-text-muted hover:bg-surface-2 hover:text-text-main"
                        }`}
                      >
                        {active ? (
                          <span aria-hidden="true" className="brand-gradient absolute inset-y-2 left-0 w-1 rounded-full" />
                        ) : null}
                        <span
                          aria-hidden="true"
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] transition motion-fast ${
                            active ? "bg-brand-100 text-brand-700" : "text-text-subtle group-hover:text-brand-600"
                          }`}
                        >
                          <Icon name={item.icon} className="h-[18px] w-[18px]" />
                        </span>
                        <span className="min-w-0 flex-1 truncate">{item.labelBn}</span>
                        {locked ? (
                          <span className="flex shrink-0 items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-caption font-semibold text-amber-700">
                            <Icon name="Lock" className="h-3 w-3" />
                            অ্যাড-অন
                          </span>
                        ) : null}
                      </a>
                    );
                  })}
                </nav>
              </div>
            ))}
          </div>

          {/* Sidebar footer — session chip */}
          <div className="border-t border-border px-5 py-4">
            <div className="flex items-center gap-3">
              <span aria-label="Admin avatar" className="brand-gradient flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ring-2 ring-brand-100">
                N
              </span>
              <span className="min-w-0">
                <span className="block truncate text-small font-semibold">অ্যাডমিন</span>
                <span className="block text-caption text-text-muted">সেশন সক্রিয়</span>
              </span>
            </div>
          </div>
        </aside>

        {/* Content column */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Topbar — sticky, translucent (glass sparingly) */}
          <header className="sticky top-0 z-40 flex h-16 items-center gap-3 border-b border-border bg-card/80 px-4 backdrop-blur sm:px-6">
            <span className="font-bold text-brand-700 md:hidden">Advance Ecommerce</span>
            {/* Breadcrumb */}
            <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1.5 text-sm md:flex">
              <a href="/admin" className="shrink-0 font-medium text-text-muted transition hover:text-brand-700">
                অ্যাডমিন
              </a>
              <span aria-hidden="true" className="text-text-subtle">
                <Icon name="ChevronRight" className="h-4 w-4" />
              </span>
              <span aria-current="page" className="truncate font-semibold text-text-main">
                {activeItem?.labelBn ?? "ড্যাশবোর্ড"}
              </span>
            </nav>
            <div className="relative ml-auto hidden w-full max-w-sm lg:block">
              <CommandPaletteTrigger />
            </div>
            <span className="ml-auto flex items-center gap-1.5 lg:ml-0">
              <button
                type="button"
                className="brand-gradient flex min-h-[40px] items-center gap-1.5 rounded-md px-3.5 text-sm font-semibold text-white shadow-md transition motion-fast hover:opacity-95"
              >
                <Icon name="Plus" className="h-4 w-4" />
                <span className="hidden sm:inline">নতুন</span>
              </button>
              <button
                type="button"
                aria-label="Notifications"
                className="relative flex min-h-[40px] min-w-[40px] items-center justify-center rounded-md text-text-muted transition hover:bg-surface-2 hover:text-text-main"
              >
                <Icon name="Bell" className="h-5 w-5" />
              </button>
              <button
                type="button"
                aria-label="Toggle language"
                className="flex min-h-[40px] items-center rounded-md bg-surface-2 px-1 py-1 text-caption font-semibold"
              >
                <span className="rounded-[8px] bg-card px-2 py-1 text-brand-700 shadow-sm">বাং</span>
                <span className="px-2 py-1 text-text-muted">EN</span>
              </button>
              <span aria-label="Admin avatar" className="brand-gradient ml-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-bold text-white ring-2 ring-brand-100">
                N
              </span>
            </span>
          </header>

          <main className="min-w-0 flex-1 px-4 py-6 pb-24 sm:px-6 md:pb-8">
            <div className="mx-auto w-full max-w-[1440px]">{children}</div>
          </main>
        </div>
      </div>

      {/* Mobile bottom tab bar */}
      <nav aria-label="Mobile admin navigation" className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-card/95 px-2 pb-[env(safe-area-inset-bottom)] pt-1.5 shadow-pop backdrop-blur md:hidden">
        {mobileNav.map((item) => {
          const active = isActiveItem(pathname, item);
          return (
            <a
              key={item.id}
              href={item.path}
              aria-current={active ? "page" : undefined}
              className={`flex flex-1 flex-col items-center gap-0.5 rounded-md py-1.5 text-caption transition motion-fast ${
                active ? "font-semibold text-brand-700" : "font-medium text-text-muted"
              }`}
            >
              <span
                aria-hidden="true"
                className={`flex h-7 w-12 items-center justify-center rounded-full transition motion-fast ${
                  active ? "bg-brand-100" : ""
                }`}
              >
                <Icon name={item.icon} className="h-5 w-5" />
              </span>
              {item.labelBn}
            </a>
          );
        })}
      </nav>
    </div>
  );
}
