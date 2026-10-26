/**
 * Suspicious-login alerts (ADV-28) — HEURISTIC alerts, not an IDS.
 *
 * Three simple rules over the staff login flow (src/lib/auth.ts) raise
 * an alert row for an admin to glance at:
 *   - "lockout":        an account crossed the failed-login threshold
 *                       and was locked (MAX_FAILED_LOGINS in auth.ts).
 *   - "failure_burst":  5 failed attempts for one identifier inside
 *                       15 minutes (tracked in the failures doc below;
 *                       the bucket clears when the alert fires, so the
 *                       rule re-arms instead of alerting per attempt).
 *   - "new_ip_success": a successful password check from an IP the
 *                       account has never held a Session row on (the
 *                       first-ever login never alerts — no history).
 * An alert is a prompt for human review, never proof of an attack:
 * staff travel, VPNs and shared office NATs all trip these rules.
 *
 * Storage: two Setting docs, the established Setting-doc pattern
 * (connectors.attempts / warehouse.pick_lists) — the generic settings
 * API rejects unknown keys and these docs are machine-shaped, so they
 * get their own zod-validated store over prisma.setting, written
 * directly:
 *   - `security.login_alerts`   { alerts: LoginAlert[] }, newest
 *     first, capped at the newest 100.
 *   - `security.login_failures` { [identifier]: epochMs[] }, pruned
 *     to the trailing 15 minutes on every write.
 *
 * Recording must NEVER break or delay a login: every function here
 * swallows its own errors, and the auth hooks call them
 * fire-and-forget. Read-modify-write can lose an alert under heavy
 * concurrency — acceptable at staff-login write rates, the same
 * trade-off the other Setting-doc ledgers make.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";

export const LOGIN_ALERTS_DOC_KEY = "security.login_alerts";
export const LOGIN_FAILURES_DOC_KEY = "security.login_failures";
/** Cap: the alerts doc keeps the newest 100 alerts; older ones fall off. */
export const LOGIN_ALERTS_CAP = 100;
/** Failed attempts inside the window that raise one failure_burst alert. */
export const FAILURE_BURST_THRESHOLD = 5;
export const FAILURE_WINDOW_MS = 15 * 60 * 1000;
/** Hygiene cap on tracked identifiers in the failures doc. */
const FAILURE_BUCKETS_CAP = 500;

export type LoginAlertKind = "lockout" | "failure_burst" | "new_ip_success";

export interface LoginAlert {
  id: string;
  kind: LoginAlertKind;
  /** Canonical identifier the attempts were made against (normalised phone, else lowercased email). */
  identifier: string;
  ip: string | null;
  detail: string;
  /** ISO-8601 timestamp of the event that raised the alert. */
  at: string;
  acknowledged: boolean;
}

const loginAlertSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["lockout", "failure_burst", "new_ip_success"]),
  identifier: z.string().max(254),
  ip: z.string().max(120).nullable(),
  detail: z.string().max(500),
  at: z.string().min(1),
  acknowledged: z.boolean(),
});

const loginAlertsDocSchema = z.object({
  alerts: z.array(loginAlertSchema).max(LOGIN_ALERTS_CAP),
});

const loginFailuresDocSchema = z.record(z.string(), z.array(z.number()));

export interface SecurityDocStore {
  read(key: string): Promise<string | null>;
  write(key: string, value: string, actorId: string): Promise<void>;
}

const DOC_DESCRIPTIONS: Record<string, string> = {
  [LOGIN_ALERTS_DOC_KEY]: "Suspicious staff-login alert ledger (JSON, ADV-28)",
  [LOGIN_FAILURES_DOC_KEY]: "Staff-login failure-burst tracker (JSON, ADV-28)",
};

/** Production store — prisma imported lazily (the connectors-ledger
 *  pattern) so pure-logic consumers never drag the DB client in. */
export function prismaSecurityDocStore(): SecurityDocStore {
  return {
    async read(key) {
      const { prisma } = await import("@advance-ecommerce/db");
      const row = await prisma.setting.findUnique({ where: { key } });
      return row?.value ?? null;
    },
    async write(key, value, actorId) {
      const { prisma } = await import("@advance-ecommerce/db");
      await prisma.setting.upsert({
        where: { key },
        create: {
          key,
          value,
          valueEncrypted: false,
          isPublic: false,
          category: "general",
          description: DOC_DESCRIPTIONS[key] ?? "Security doc (JSON, ADV-28)",
          updatedById: actorId,
        },
        update: { value, valueEncrypted: false, updatedById: actorId },
      });
    },
  };
}

async function readAlerts(store: SecurityDocStore): Promise<LoginAlert[]> {
  const raw = await store.read(LOGIN_ALERTS_DOC_KEY);
  if (raw === null || raw.trim() === "") return [];
  try {
    const parsed = loginAlertsDocSchema.safeParse(JSON.parse(raw));
    return parsed.success ? (parsed.data.alerts as LoginAlert[]) : [];
  } catch {
    return [];
  }
}

async function readFailures(store: SecurityDocStore): Promise<Record<string, number[]>> {
  const raw = await store.read(LOGIN_FAILURES_DOC_KEY);
  if (raw === null || raw.trim() === "") return {};
  try {
    const parsed = loginFailuresDocSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/**
 * Prepend one alert and re-cap the doc. NEVER throws — a lost alert
 * is acceptable, a broken login is not.
 */
export async function recordLoginAlert(
  input: { kind: LoginAlertKind; identifier: string; ip: string | null; detail: string },
  store: SecurityDocStore = prismaSecurityDocStore(),
): Promise<void> {
  try {
    const alert: LoginAlert = {
      id: randomUUID(),
      kind: input.kind,
      identifier: input.identifier,
      ip: input.ip,
      detail: input.detail,
      at: new Date().toISOString(),
      acknowledged: false,
    };
    if (!loginAlertSchema.safeParse(alert).success) return;
    const existing = await readAlerts(store);
    const next = [alert, ...existing].slice(0, LOGIN_ALERTS_CAP);
    await store.write(LOGIN_ALERTS_DOC_KEY, JSON.stringify({ alerts: next }), "system:security");
  } catch {
    // Swallowed by design (see header): alert loss is logged nowhere
    // because this runs inside the login path, where a console line
    // per failed write would spam exactly when the DB is in trouble.
  }
}

/**
 * Record one failed login attempt for the identifier and maintain the
 * burst rule: timestamps are kept per identifier, pruned to the
 * trailing 15 minutes (all buckets, so the doc stays small); when the
 * pruned count reaches FAILURE_BURST_THRESHOLD, ONE failure_burst
 * alert fires and the identifier's bucket is cleared so the rule
 * re-arms. NEVER throws.
 */
export async function recordFailedAttempt(
  identifier: string,
  ip: string | null,
  store: SecurityDocStore = prismaSecurityDocStore(),
  now: number = Date.now(),
): Promise<void> {
  try {
    const doc = await readFailures(store);
    const cutoff = now - FAILURE_WINDOW_MS;
    // Prune every bucket to the window; drop empties.
    for (const key of Object.keys(doc)) {
      const kept = (doc[key] ?? []).filter((ts) => ts > cutoff);
      if (kept.length === 0) delete doc[key];
      else doc[key] = kept;
    }
    const bucket = [...(doc[identifier] ?? []), now];
    const burst = bucket.length >= FAILURE_BURST_THRESHOLD;
    if (burst) {
      delete doc[identifier];
    } else {
      doc[identifier] = bucket;
      // Hygiene: if the doc somehow grows past the bucket cap, keep
      // the buckets with the most recent activity.
      const keys = Object.keys(doc);
      if (keys.length > FAILURE_BUCKETS_CAP) {
        keys
          .sort((a, b) => Math.max(...(doc[b] ?? [0])) - Math.max(...(doc[a] ?? [0])))
          .slice(FAILURE_BUCKETS_CAP)
          .forEach((key) => delete doc[key]);
      }
    }
    await store.write(LOGIN_FAILURES_DOC_KEY, JSON.stringify(doc), "system:security");
    if (burst) {
      await recordLoginAlert(
        {
          kind: "failure_burst",
          identifier,
          ip,
          detail: `${FAILURE_BURST_THRESHOLD} failed staff-login attempts within 15 minutes.`,
        },
        store,
      );
    }
  } catch {
    // Swallowed by design (see header).
  }
}

/**
 * Fire a "new_ip_success" alert when a successful login's IP has
 * never appeared on any prior Session row for the account. The first
 * ever login (no prior sessions) never alerts, and an unknown IP
 * (no forwarding header — the login route passes the literal
 * "unknown") cannot be judged, so it never alerts either. Called from
 * authenticateStaff BEFORE the route handler creates the session for
 * this login, so every Session row read here is strictly prior.
 * NEVER throws.
 */
export async function recordNewIpSuccessIfUnseen(
  input: { userId: string; identifier: string; ip: string | null },
  store: SecurityDocStore = prismaSecurityDocStore(),
): Promise<void> {
  try {
    const ip = input.ip;
    if (ip === null || ip === "" || ip === "unknown") return;
    const { prisma } = await import("@advance-ecommerce/db");
    const priorCount = await prisma.session.count({ where: { userId: input.userId } });
    if (priorCount === 0) return;
    const seen = await prisma.session.findFirst({
      where: { userId: input.userId, ip },
      select: { id: true },
    });
    if (seen !== null) return;
    await recordLoginAlert(
      {
        kind: "new_ip_success",
        identifier: input.identifier,
        ip,
        detail: "Successful staff login from an IP address this account has no previous session on.",
      },
      store,
    );
  } catch {
    // Swallowed by design (see header).
  }
}

/** Newest first. Never throws — a broken ledger reads as empty. */
export async function listLoginAlerts(
  store: SecurityDocStore = prismaSecurityDocStore(),
): Promise<LoginAlert[]> {
  try {
    return await readAlerts(store);
  } catch {
    return [];
  }
}

/**
 * Mark one alert acknowledged and return the updated alert, or null
 * when the id is unknown (or the ledger cannot be read/written — the
 * caller answers 404 rather than claiming an update that did not
 * persist).
 */
export async function acknowledgeLoginAlert(
  id: string,
  store: SecurityDocStore = prismaSecurityDocStore(),
): Promise<LoginAlert | null> {
  try {
    const alerts = await readAlerts(store);
    const index = alerts.findIndex((a) => a.id === id);
    if (index === -1) return null;
    const updated: LoginAlert = { ...(alerts[index] as LoginAlert), acknowledged: true };
    const next = [...alerts];
    next[index] = updated;
    await store.write(LOGIN_ALERTS_DOC_KEY, JSON.stringify({ alerts: next }), "system:security");
    return updated;
  } catch {
    return null;
  }
}
