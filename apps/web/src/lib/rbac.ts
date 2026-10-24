/**
 * RBAC — server-side only.
 *
 * Permission strings are always `module.action`. Every admin API route and
 * every Server Action must call requirePermission() (or hasPermission() for
 * UI gating) — client-side hiding is never a security boundary.
 *
 * This catalogue must stay in sync with packages/db/prisma/seed.ts, which
 * seeds the same strings into the Permission table. If you add a permission
 * here, add it to the seed catalogue too.
 */
import { maskPhone } from "@advance-ecommerce/validators";

export const PERMISSIONS = [
  // Orders
  "orders.view",
  "orders.create",
  "orders.update_status",
  "orders.edit",
  "orders.delete",
  "orders.export",
  "orders.print",
  // Products / catalog
  "products.view",
  "products.create",
  "products.edit",
  "products.delete",
  "products.edit_cost_price",
  "products.import",
  "products.export",
  // Customers / CRM
  "customers.view",
  "customers.edit",
  "customers.view_full_phone",
  "customers.export",
  "customers.block",
  // Inventory
  "inventory.view",
  "inventory.adjust",
  "inventory.purchase_order",
  // Payments / refunds
  "payments.view",
  "payments.verify_manual",
  "payments.refund",
  "payments.export",
  // Shipments / courier
  "shipments.view",
  "shipments.book",
  "shipments.cancel",
  // Marketing
  "marketing.coupon",
  "marketing.campaign",
  "marketing.banner",
  // Content
  "content.page",
  "content.blog",
  "content.media",
  // Reports
  "reports.view",
  "reports.export",
  "reports.accounting",
  // Team / audit
  "staff.view",
  "staff.manage",
  "roles.manage",
  "audit.view",
  // Settings / integrations
  "settings.view",
  "settings.edit",
  "settings.integrations",
  "settings.branding",
  "feature_flags.manage",
  // Automation / fraud (v2 add-on modules)
  "automation.view",
  "automation.manage",
  "fraud.view",
  "fraud.manage",
  // B2B / vendors (v2 add-on modules)
  "b2b.view",
  "b2b.manage",
  "vendors.view",
  "vendors.manage",
  // Riders (v2 add-on module)
  "riders.view",
  "riders.manage",
  // Resellers (v2 add-on module, added 2026-10-24 per AGENT14-REVIEW G2)
  "resellers.view",
  "resellers.manage",
  // POS (v2 add-on module, dedicated pair — POS previously borrowed orders.*)
  "pos.view",
  "pos.manage",
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number];

export function isPermissionKey(value: string): value is PermissionKey {
  return (PERMISSIONS as readonly string[]).includes(value);
}

/** Default role -> permissions. Owner is handled as "all" (see below). */
export const DEFAULT_ROLE_PERMISSIONS: Record<string, readonly PermissionKey[]> = {
  Manager: [
    "orders.view", "orders.create", "orders.update_status", "orders.edit", "orders.export", "orders.print",
    "products.view", "products.create", "products.edit", "products.import", "products.export",
    "customers.view", "customers.edit", "customers.view_full_phone",
    "inventory.view", "inventory.adjust", "inventory.purchase_order",
    "payments.view", "payments.verify_manual",
    "shipments.view", "shipments.book", "shipments.cancel",
    "marketing.coupon", "marketing.campaign", "marketing.banner",
    "content.page", "content.blog", "content.media",
    "reports.view", "reports.export",
    "staff.view", "audit.view",
    "settings.view",
    "automation.view", "automation.manage", "fraud.view", "fraud.manage",
    "pos.view", "pos.manage",
  ],
  "Order Processor": [
    "orders.view", "orders.create", "orders.update_status", "orders.print",
    "products.view",
    "customers.view",
    "payments.view",
    "shipments.view", "shipments.book",
    "pos.view", "pos.manage",
  ],
  Inventory: [
    "products.view",
    "inventory.view", "inventory.adjust", "inventory.purchase_order",
    "orders.view",
  ],
  Support: [
    "orders.view",
    "customers.view",
    "content.page",
  ],
  Accountant: [
    "orders.view", "orders.export",
    "payments.view", "payments.refund", "payments.export",
    "shipments.view",
    "reports.view", "reports.export", "reports.accounting",
  ],
  "Content Editor": [
    "products.view", "products.create", "products.edit",
    "content.page", "content.blog", "content.media",
  ],
};

export function permissionsForRole(roleName: string): readonly PermissionKey[] {
  if (roleName === "Owner") return PERMISSIONS;
  return DEFAULT_ROLE_PERMISSIONS[roleName] ?? [];
}

export function hasPermission(userPermissions: readonly string[], key: PermissionKey): boolean {
  return userPermissions.includes(key);
}

export class RbacError extends Error {
  readonly code = "FORBIDDEN";
  constructor(permission: string) {
    super(`Missing permission: ${permission}`);
    this.name = "RbacError";
  }
}

/** Throw RbacError if the user lacks the permission. Use in API routes / Server Actions. */
export function requirePermission(userPermissions: readonly string[], key: PermissionKey): void {
  if (!hasPermission(userPermissions, key)) throw new RbacError(key);
}

/* ------------------------------------------------------------------ */
/* Field-level permissions                                             */
/* ------------------------------------------------------------------ */

/** Full phone only with customers.view_full_phone; otherwise masked. */
export function phoneForViewer(phone: string | null, userPermissions: readonly string[]): string | null {
  if (phone === null) return null;
  return hasPermission(userPermissions, "customers.view_full_phone") ? phone : maskPhone(phone);
}

/** Cost price only with products.edit_cost_price; otherwise null (never 0, which would look like free). */
export function costPriceForViewer(
  costPoisha: number | null,
  userPermissions: readonly string[],
): number | null {
  if (costPoisha === null) return null;
  return hasPermission(userPermissions, "products.edit_cost_price") ? costPoisha : null;
}

/** Strip cost price from a product-like object for a viewer without permission. */
export function stripCostPrice<T extends { costPoisha?: number | null }>(
  product: T,
  userPermissions: readonly string[],
): T {
  if (hasPermission(userPermissions, "products.edit_cost_price")) return product;
  const { costPoisha: _removed, ...rest } = product;
  return rest as T;
}
