import { ADMIN_NAV, type AdminNavItem } from "@/admin-nav/config";

/** Active-route test for a nav item (moved from app/admin/layout.tsx, D2).
 *  The dashboard root matches exactly; every other item also matches its
 *  sub-routes (`/admin/orders/123` keeps Orders active). */
export function isActiveItem(pathname: string, item: AdminNavItem): boolean {
  if (item.path === "/admin") return pathname === "/admin";
  return pathname === item.path || pathname.startsWith(`${item.path}/`);
}

/** The five destinations pinned to the phone bottom bar (unchanged from
 *  the pre-D2 layout). The full nav lives behind MobileNav's "More"
 *  drawer. */
export const MOBILE_NAV_ITEMS: readonly AdminNavItem[] = ADMIN_NAV.filter((item) =>
  ["/admin", "/admin/orders", "/admin/products", "/admin/customers", "/admin/modules"].includes(item.path),
);

/** Longest-prefix active item for the topbar breadcrumb — when nested
 *  settings paths overlap (`/admin/settings` vs `/admin/settings/orders`)
 *  the longest path wins. */
export function activeNavItem(pathname: string): AdminNavItem {
  return (
    ADMIN_NAV.filter((item) => isActiveItem(pathname, item)).sort(
      (a, b) => b.path.length - a.path.length,
    )[0] ?? ADMIN_NAV[0]!
  );
}
