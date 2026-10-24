/**
 * Audit log — server-side only.
 *
 * Every sensitive action must be audited with actor, action, entity, a
 * before/after snapshot, and a reason. Credentials must never appear in an
 * audit record: sanitizeAuditJson() masks secret-like keys, and callers
 * that update a setting must pass only "changed: true" (see settings.ts).
 */
import { prisma } from "@advance-ecommerce/db";

/** Actions that require a non-empty reason. */
export const SENSITIVE_ACTIONS = [
  "orders.delete",
  "orders.refund",
  "payments.refund",
  "products.delete",
  "products.price_change",
  "customers.view_full_phone",
  "customers.export",
  "orders.export",
  "settings.update",
  "staff.manage",
  "roles.manage",
  "feature_flags.manage",
] as const;

const SECRET_KEY_PATTERN = /(password|secret|token|api_key|apikey|private_key|client_secret|access_key|totp|otp|code)/i;

export function sanitizeAuditJson(
  value: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (value === null) return null;
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : val;
  }
  return out;
}

/** Shallow diff: only fields that changed, secret keys redacted. */
export function diffFields(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): { before: Record<string, unknown> | null; after: Record<string, unknown> | null } {
  if (before === null || after === null) {
    return { before: sanitizeAuditJson(before), after: sanitizeAuditJson(after) };
  }
  const beforeOut: Record<string, unknown> = {};
  const afterOut: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (before[key] !== after[key]) {
      beforeOut[key] = before[key];
      afterOut[key] = after[key];
    }
  }
  return { before: sanitizeAuditJson(beforeOut), after: sanitizeAuditJson(afterOut) };
}

export interface AuditInput {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  beforeJson?: Record<string, unknown> | null;
  afterJson?: Record<string, unknown> | null;
  reason?: string;
  ip?: string;
  userAgent?: string;
}

export async function writeAudit(input: AuditInput): Promise<string | null> {
  if ((SENSITIVE_ACTIONS as readonly string[]).includes(input.action)) {
    if (input.reason === undefined || input.reason.trim() === "") {
      throw new Error(`Audit reason is required for sensitive action: ${input.action}`);
    }
  }
  try {
    const row = await prisma.auditLog.create({
      data: {
        actorId: input.actorId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        beforeJson: sanitizeAuditJson(input.beforeJson ?? null) as never,
        afterJson: sanitizeAuditJson(input.afterJson ?? null) as never,
        reason: input.reason,
        ip: input.ip,
        userAgent: input.userAgent,
      },
    });
    return row.id;
  } catch (error) {
    // Audit must not take down the business operation, but it must not
    // fail silently either: surface a non-sensitive error for the caller
    // to log/monitor. Callers that need a hard guarantee should check the
    // return value (null = not recorded).
    console.error("Audit log write failed:", input.action, input.entityType);
    void error;
    return null;
  }
}

/** Convenience: audit a full-phone view without recording the phone itself. */
export async function logPhoneAccess(input: {
  actorId: string;
  customerId: string;
  reason: string;
  ip?: string;
  userAgent?: string;
}): Promise<void> {
  await writeAudit({
    actorId: input.actorId,
    action: "customers.view_full_phone",
    entityType: "Customer",
    entityId: input.customerId,
    beforeJson: null,
    afterJson: null,
    reason: input.reason,
    ip: input.ip,
    userAgent: input.userAgent,
  });
}

export async function getAuditLogs(input: {
  entityType?: string;
  entityId?: string;
  actorId?: string;
  page?: number;
  pageSize?: number;
}) {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 20));
  const where = {
    ...(input.entityType ? { entityType: input.entityType } : {}),
    ...(input.entityId ? { entityId: input.entityId } : {}),
    ...(input.actorId ? { actorId: input.actorId } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditLog.count({ where }),
  ]);
  return { rows, total, page, pageSize };
}
