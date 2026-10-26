/**
 * Admin security API — /api/v1/admin/security/ip-rules (ADV-28 core)
 *
 * Staff-login IP allow/block lists, stored as ONE Setting JSON doc
 * (`security.ip_rules` — see src/security/ip-rules.ts) and enforced by
 * the login route BEFORE credential verification.
 *
 * GET -> { data: { allow, block } }
 *   - requires settings.view (mirrors the generic settings route:
 *     reads of the Setting store are settings.view).
 *
 * PUT { allow, block, reason } -> replace both lists
 *   - requires settings.edit (the Setting store's write permission,
 *     same as the generic settings route's POST).
 *   - EVERY entry must parse as an IP or CIDR (v4 or v6); a single bad
 *     entry rejects the WHOLE write with 400 + the invalid entries in
 *     error.details — a partially-applied rule set is never stored.
 *   - reason is REQUIRED: the change is audited as `settings.update`,
 *     a SENSITIVE_ACTIONS member that writeAudit refuses to record
 *     without one.
 *   - persistence is the Setting-doc upsert (the team-docs pattern —
 *     the generic setSetting path rejects unregistered keys by
 *     design), followed by invalidateSettingCache so the login route's
 *     memoised getSetting read sees the new rules immediately.
 *   - the audit before/after carry the full lists: IP rules are not
 *     credentials, and an incident review needs to see exactly which
 *     networks were allowed/blocked, not just "changed".
 *   - a DB failure returns 503 and never claims the rules were saved.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@advance-ecommerce/db";
import { validateSessionToken } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { requirePermission, RbacError, type PermissionKey } from "@/lib/rbac";
import { getSetting, invalidateSettingCache } from "@/lib/settings";
import {
  IP_RULES_SETTING_KEY,
  isValidIpEntry,
  parseIpRules,
  type IpRules,
} from "@/security/ip-rules";

export const dynamic = "force-dynamic";

function err(code: string, message: string, status: number, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

async function requireAdmin(permissions: PermissionKey[]) {
  const token = cookies().get("admin_session")?.value;
  if (!token) return { error: err("UNAUTHENTICATED", "Admin login required.", 401) };
  try {
    const session = await validateSessionToken(token);
    if (!session) return { error: err("UNAUTHENTICATED", "Session expired or revoked.", 401) };
    for (const permission of permissions) requirePermission(session.user.permissions, permission);
    return { session };
  } catch (e) {
    if (e instanceof RbacError) return { error: err("FORBIDDEN", e.message, 403) };
    return { error: err("DB_NOT_READY", "Session check needs a working database (Prisma generate + DB connection).", 503) };
  }
}

export async function GET() {
  const auth = await requireAdmin(["settings.view"]);
  if ("error" in auth) return auth.error;

  // Read the raw doc directly (not the fail-open login loader): an
  // admin managing the rules must see a DB outage as an outage, not
  // as "no rules configured". parseIpRules sanitises whatever is
  // stored — a hand-edited/corrupt doc reads as its valid subset.
  let raw: string | null;
  try {
    raw = await getSetting(IP_RULES_SETTING_KEY);
  } catch {
    return err("DB_NOT_READY", "IP rules need a working database connection.", 503);
  }
  const rules = parseIpRules(raw);
  return NextResponse.json({ data: rules, meta: { persistence: "database" } });
}

const putSchema = z.object({
  allow: z.array(z.string().min(1).max(64)).max(200),
  block: z.array(z.string().min(1).max(64)).max(200),
  reason: z.string().min(1, "Reason is required for a security rule change."),
});

export async function PUT(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return err("VALIDATION_ERROR", "IP rules input invalid.", 400, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  const auth = await requireAdmin(["settings.edit"]);
  if ("error" in auth) return auth.error;

  // Trim + drop blanks, then validate EVERY entry before any write:
  // one bad line rejects the whole change with the offenders listed.
  const clean = (list: string[]): string[] =>
    [...new Set(list.map((entry) => entry.trim()).filter((entry) => entry !== ""))];
  const next: IpRules = { allow: clean(parsed.data.allow), block: clean(parsed.data.block) };
  const invalid = [...next.allow, ...next.block].filter((entry) => !isValidIpEntry(entry));
  if (invalid.length > 0) {
    return err(
      "INVALID_IP_ENTRIES",
      "Some entries are not valid IPs or CIDR ranges — nothing was saved.",
      400,
      invalid.map((entry) => `Invalid IP/CIDR entry: ${entry}`),
    );
  }

  // Previous rules for the audit before-snapshot; a failed read here
  // must not block the write itself (the upsert below is the gate).
  let previous: IpRules | null = null;
  try {
    previous = parseIpRules(await getSetting(IP_RULES_SETTING_KEY));
  } catch {
    previous = null;
  }

  const actorId = auth.session.user.id;
  try {
    await prisma.setting.upsert({
      where: { key: IP_RULES_SETTING_KEY },
      create: {
        key: IP_RULES_SETTING_KEY,
        value: JSON.stringify(next),
        valueEncrypted: false,
        isPublic: false,
        category: "security",
        description: "Staff login IP rules (JSON, ADV-28)",
        updatedById: actorId,
      },
      update: { value: JSON.stringify(next), valueEncrypted: false, updatedById: actorId },
    });
  } catch {
    // Never claim the rules were saved when the write did not land.
    return err("SETTINGS_SAVE_FAILED", "IP rules could not be saved — database unavailable.", 503);
  }
  invalidateSettingCache(IP_RULES_SETTING_KEY);
  await writeAudit({
    actorId,
    action: "settings.update",
    entityType: "Setting",
    entityId: IP_RULES_SETTING_KEY,
    beforeJson: previous ? { allow: previous.allow, block: previous.block } : null,
    afterJson: { allow: next.allow, block: next.block },
    reason: parsed.data.reason,
  });
  return NextResponse.json({ data: next, meta: { saved: true } });
}
