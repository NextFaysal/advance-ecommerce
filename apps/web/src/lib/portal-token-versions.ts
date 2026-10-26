/**
 * Portal session token versions — doc 23 wave 54-7. Server-only.
 *
 * The reseller and vendor portals issue STATELESS HMAC session
 * tokens (src/reseller/portal-auth.ts, src/vendors/portal-auth.ts):
 * no session table, so a single token cannot be revoked before its
 * 7-day expiry. This module adds the emergency brake on top of that
 * design: a per-portal monotonic version counter, stored as ONE
 * JSON document in a Setting row (key `portal.token_versions`,
 * shape { reseller: n, vendor: n }, both default 0) — the
 * established no-migration document pattern (cf.
 * src/vendors/kyc-store.ts).
 *
 * Contract:
 *  - Issuance embeds the CURRENT version in the signed payload
 *    (`v`). Validation rejects any token whose `v` differs from the
 *    version currently stored for that portal.
 *  - Tokens issued before this mechanism existed carry no `v` and
 *    are treated as version 0: they stay valid ONLY while the
 *    stored version is still 0. The first bump therefore retires
 *    every pre-change token too — that is the point of an emergency
 *    revoke, and it is why there is no grandfathering past a bump.
 *  - Bumping is the ONLY new behaviour. Normal login/logout flows
 *    are untouched: logout still just clears the cookie, and an
 *    individual token still cannot be singled out (no session
 *    table) — the counter revokes a portal's sessions ALL AT ONCE.
 *  - Reads hit the Setting row directly (no settings memo/cache):
 *    an emergency bump must take effect on the next request, not
 *    after a cache TTL. A store read FAILURE propagates: callers
 *    fail closed (a token that cannot be checked against the
 *    counter is not honoured, and issuance refuses to mint an
 *    unstamppable token). A missing or corrupt document reads as
 *    the zero document — the writer below only ever writes valid
 *    documents, so corruption implies external tampering, at which
 *    point outstanding v0 tokens are the least concern.
 *
 * The admin actions live at:
 *  - POST /api/v1/admin/resellers/revoke-sessions (resellers.manage)
 *  - POST /api/v1/admin/vendors/revoke-sessions (vendors.manage)
 * Both are audited with a mandatory reason.
 */
import { z } from "zod";

export const PORTAL_TOKEN_VERSIONS_KEY = "portal.token_versions";

export type PortalKind = "reseller" | "vendor";

export interface PortalTokenVersions {
  reseller: number;
  vendor: number;
}

const ZERO_VERSIONS: PortalTokenVersions = { reseller: 0, vendor: 0 };

const portalTokenVersionsSchema = z.object({
  reseller: z.number().int().nonnegative().default(0),
  vendor: z.number().int().nonnegative().default(0),
});

export interface KeyValueStore {
  read(key: string): Promise<string | null>;
  write(key: string, value: string, actorId: string): Promise<void>;
}

/** Production store over the Setting table (prisma imported lazily,
 *  the saved-reports / kyc-store pattern). */
export function prismaKeyValueStore(): KeyValueStore {
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
          description: "Portal session token versions (JSON, doc 23 wave 54-7)",
          updatedById: actorId,
        },
        update: { value, valueEncrypted: false, updatedById: actorId },
      });
    },
  };
}

/** Read the whole document; a missing/corrupt doc reads as zeros.
 *  Store read errors PROPAGATE (fail-closed callers depend on it). */
export async function readPortalTokenVersions(
  kv: KeyValueStore = prismaKeyValueStore(),
): Promise<PortalTokenVersions> {
  const raw = await kv.read(PORTAL_TOKEN_VERSIONS_KEY);
  if (raw === null) return { ...ZERO_VERSIONS };
  try {
    const parsed = portalTokenVersionsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : { ...ZERO_VERSIONS };
  } catch {
    return { ...ZERO_VERSIONS };
  }
}

/** The current token version for one portal (0 until first bump). */
export async function getPortalTokenVersion(
  portal: PortalKind,
  kv: KeyValueStore = prismaKeyValueStore(),
): Promise<number> {
  const doc = await readPortalTokenVersions(kv);
  return doc[portal];
}

/**
 * Increment one portal's version by 1, invalidating every session
 * token that portal has outstanding. Read-modify-write of the whole
 * document; bumps are staff-paced admin actions, so contention is a
 * non-issue at this scale.
 */
export async function bumpPortalTokenVersion(
  portal: PortalKind,
  actorId: string,
  kv: KeyValueStore = prismaKeyValueStore(),
): Promise<{ previous: number; current: number }> {
  const doc = await readPortalTokenVersions(kv);
  const previous = doc[portal];
  const current = previous + 1;
  doc[portal] = current;
  await kv.write(PORTAL_TOKEN_VERSIONS_KEY, JSON.stringify(doc), actorId);
  return { previous, current };
}
