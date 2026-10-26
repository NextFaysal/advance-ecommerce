/**
 * Staff presence (ADV-27 remainder, doc 23 wave 53-4) — "who is
 * online / who is looking at this page right now", used for the
 * order-page edit-conflict WARNING. Presence is advisory only: it
 * never locks, blocks, or gates anything.
 *
 * STORAGE — Redis (via src/lib/redis's shared client):
 *   presence:staff:<userId>  -> JSON { name, path, at }, EX 75s
 *   presence:staff-index     -> a SET of userIds (enumeration index;
 *                               members whose key has expired are
 *                               pruned lazily on read)
 * Clients heartbeat every 30s, so a live entry is always ≤30s old
 * and disappears ≤75s after the tab closes / heartbeat stops.
 *
 * FALLBACK: when Redis is unconfigured or errors, an in-process Map
 * takes over (same philosophy as src/lib/redis's own memory
 * fallbacks) — presence then works per-instance and simply sees
 * fewer people. NOTHING in here ever throws or surfaces an error to
 * a caller: worst case, presence reads as empty.
 *
 * Freshness is double-checked on read from the stored `at` stamp, so
 * a stale index member or a lingering memory entry can never make a
 * departed colleague look present.
 */
import { getRedisClient } from "@/lib/redis";

export const PRESENCE_TTL_SECONDS = 75;

const KEY_PREFIX = "presence:staff:";
const INDEX_KEY = "presence:staff-index";

export interface PresenceEntry {
  userId: string;
  name: string;
  /** Admin path the staff member is currently on, e.g. /admin/orders/<id>. */
  path: string;
  /** ISO instant of the last heartbeat. */
  at: string;
}

interface StoredPresence {
  name: string;
  path: string;
  at: string;
}

/* In-process fallback (single-instance / Redis-down). */
const memoryPresence = new Map<string, StoredPresence>();

function isFresh(stored: StoredPresence, nowMs: number): boolean {
  const at = Date.parse(stored.at);
  return Number.isFinite(at) && nowMs - at <= PRESENCE_TTL_SECONDS * 1000;
}

function parseStored(raw: string | null): StoredPresence | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredPresence>;
    if (
      typeof parsed.name === "string" &&
      typeof parsed.path === "string" &&
      typeof parsed.at === "string"
    ) {
      return { name: parsed.name, path: parsed.path, at: parsed.at };
    }
  } catch {
    // Corrupt value -> treated as absent.
  }
  return null;
}

/** Record a heartbeat for a staff member. Never throws. */
export async function recordPresence(input: {
  userId: string;
  name: string;
  path: string;
}): Promise<void> {
  const stored: StoredPresence = {
    name: input.name,
    path: input.path,
    at: new Date().toISOString(),
  };
  const client = getRedisClient();
  if (client) {
    try {
      await client.set(
        `${KEY_PREFIX}${input.userId}`,
        JSON.stringify(stored),
        "EX",
        PRESENCE_TTL_SECONDS,
      );
      await client.sadd(INDEX_KEY, input.userId);
      return;
    } catch {
      // Fall through to the memory fallback.
    }
  }
  memoryPresence.set(input.userId, stored);
}

/**
 * Fresh presence entries, optionally filtered to one exact path.
 * Never throws; Redis trouble reads as "nobody here".
 */
export async function listPresence(path?: string): Promise<PresenceEntry[]> {
  const nowMs = Date.now();
  const entries: PresenceEntry[] = [];
  const collect = (userId: string, stored: StoredPresence | null) => {
    if (!stored || !isFresh(stored, nowMs)) return;
    if (path !== undefined && stored.path !== path) return;
    entries.push({ userId, name: stored.name, path: stored.path, at: stored.at });
  };

  const client = getRedisClient();
  if (client) {
    try {
      const ids = await client.smembers(INDEX_KEY);
      if (ids.length > 0) {
        const keys = ids.map((id) => `${KEY_PREFIX}${id}`);
        const values = await client.mget(...keys);
        const stale: string[] = [];
        ids.forEach((id, i) => {
          const stored = parseStored(values[i] ?? null);
          if (stored === null) stale.push(id);
          collect(id, stored);
        });
        if (stale.length > 0) {
          // Prune index members whose keys expired (fire-and-forget).
          void client.srem(INDEX_KEY, ...stale).catch(() => {});
        }
      }
      return sortEntries(entries);
    } catch {
      // Fall through to the memory fallback.
    }
  }

  for (const [userId, stored] of memoryPresence) {
    if (!isFresh(stored, nowMs)) {
      memoryPresence.delete(userId);
      continue;
    }
    collect(userId, stored);
  }
  return sortEntries(entries);
}

function sortEntries(entries: PresenceEntry[]): PresenceEntry[] {
  return entries.sort((a, b) => a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId));
}
