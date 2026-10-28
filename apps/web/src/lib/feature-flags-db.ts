/**
 * DB-backed feature-flag source — server-only (imports Prisma).
 *
 * Implements the FeatureFlagSource seam from src/lib/feature-flags.ts
 * over the FeatureFlag table:
 *
 * - READS are synchronous (the reader contract every consumer uses):
 *   they hit an in-memory cache hydrated from the table. Hydration
 *   starts on install and on first read; until it lands, reads return
 *   the catalogue defaults (all OFF — fail-closed, matching the seed).
 * - The cache REVALIDATES on a TTL (default 20 s, env
 *   FEATURE_FLAGS_REVALIDATE_MS): a read that finds the cache stale
 *   kicks a background reload, and ensureHydrated() — awaited by
 *   server guards/entry points via ensureDbFeatureFlags() — waits
 *   for the reload when stale, so a flip made in another process (or
 *   before this process started) is picked up without a restart. A
 *   failed revalidation keeps serving the last good cache and does
 *   not mark it fresh, so the next read retries.
 * - WRITES update the cache SYNCHRONOUSLY first — so a flip via the
 *   admin API takes effect for in-process consumers in the same tick,
 *   exactly as the in-memory demo source behaved — and persist to the
 *   table on a serialized promise chain. flushFeatureFlagWrites()
 *   awaits that chain (the flags API route awaits it before answering,
 *   so a 200 response means the row is in the DB).
 * - Rows for keys outside the catalogue are ignored on read (the
 *   catalogue in feature-flags.ts mirrors the seed exactly); unknown
 *   keys stay fail-closed.
 *
 * Install points: Next instrumentation (server start) and the
 * feature-flags API store (ensureDbFeatureFlags()). A fresh process /
 * fresh source instance hydrates from the DB, so state survives
 * restarts and is shared across processes through the table.
 */
import { prisma } from "@advance-ecommerce/db";
import {
  InMemoryFeatureFlagSource,
  installFeatureFlagSource,
  sharedFeatureFlagSource,
  type FeatureFlagRecord,
  type FeatureFlagSource,
} from "./feature-flags";

/** Revalidation window for the hydrated cache. A process that
 *  started before a flag flip would otherwise serve the stale state
 *  forever; with a TTL it converges within one window. Overridable
 *  via FEATURE_FLAGS_REVALIDATE_MS (invalid values are ignored). */
function revalidateMsFromEnv(): number {
  const raw = process.env.FEATURE_FLAGS_REVALIDATE_MS;
  if (raw) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 20_000;
}

const FEATURE_FLAGS_REVALIDATE_MS = revalidateMsFromEnv();

export class DbFeatureFlagSource implements FeatureFlagSource {
  private readonly cache = new InMemoryFeatureFlagSource();
  private hydration: Promise<void> | null = null;
  private hydrated = false;
  /** Epoch ms of the last SUCCESSFUL (re)hydration; 0 = never. The
   *  cache is stale once it is older than the revalidation window. */
  private lastHydratedAt = 0;
  /** Keys with a local flip whose write-chain upsert has not yet
   *  completed: (re)hydration must not overwrite a fresher in-process
   *  flip with a stale table value. A key leaves the set when its
   *  last queued upsert lands (see releaseDirtyKey) — from then on
   *  the table holds the value, so revalidation may sync it again,
   *  including with a newer value written by another process. */
  private readonly dirtyKeys = new Set<string>();
  /** Queued-but-unfinished write-chain links per key (one link per
   *  setEnabled call); dirtyKeys is released only when this hits 0,
   *  so an earlier link completing cannot unprotect a later flip of
   *  the same key that is still in flight. */
  private readonly pendingWrites = new Map<string, number>();
  /** Monotonic counter bumped on every local flip, and the counter
   *  value at each key's latest flip. A load applies a row only if
   *  the key was not flipped after the load STARTED — the load's
   *  table snapshot may predate a just-persisted flip even when the
   *  dirty guard was already released by the time the load applies. */
  private flipEpoch = 0;
  private readonly flipEpochByKey = new Map<string, number>();
  private writeChain: Promise<void> = Promise.resolve();
  /** Last persistence error, kept for diagnostics; reads/writes of the
   *  cache are unaffected (the API route surfaces failure via flush). */
  lastWriteError: unknown = null;

  isKnown(key: string): boolean {
    return this.cache.isKnown(key);
  }

  isEnabled(key: string): boolean {
    void this.ensureHydrated();
    return this.cache.isEnabled(key);
  }

  getFlag(key: string): FeatureFlagRecord | null {
    void this.ensureHydrated();
    return this.cache.getFlag(key);
  }

  listFlags(): FeatureFlagRecord[] {
    void this.ensureHydrated();
    return this.cache.listFlags();
  }

  setEnabled(key: string, enabled: boolean): void {
    // Unknown keys stay unknown + fail-closed (never persisted).
    if (!this.cache.isKnown(key)) return;
    // Synchronous cache update first (in-process consumers see the
    // flip immediately — the unified-reader behaviour), then persist.
    this.dirtyKeys.add(key);
    this.pendingWrites.set(key, (this.pendingWrites.get(key) ?? 0) + 1);
    this.flipEpochByKey.set(key, ++this.flipEpoch);
    this.cache.setEnabled(key, enabled);
    this.writeChain = this.writeChain
      .then(async () => {
        const def = this.cache.getFlag(key);
        await prisma.featureFlag.upsert({
          where: { key },
          create: { key, enabled, description: def?.description ?? null },
          update: { enabled },
        });
        // The upsert landed: the table now holds this key's value,
        // so the dirty guard for it can be released once no later
        // flip of the same key is still queued behind this link.
        this.releaseDirtyKey(key);
      })
      .catch((e: unknown) => {
        this.lastWriteError = e;
      });
  }

  /** One write-chain link for `key` has persisted. Releases the
   *  key's dirty guard when its last queued link has landed; while
   *  any link is still in flight the guard stays, and a FAILED link
   *  never reaches this — its key keeps the guard (the table does
   *  not hold the value, so a revalidation must not revert the
   *  in-process flip the API already reported via flush()). */
  private releaseDirtyKey(key: string): void {
    const remaining = (this.pendingWrites.get(key) ?? 1) - 1;
    if (remaining <= 0) {
      this.pendingWrites.delete(key);
      this.dirtyKeys.delete(key);
    } else {
      this.pendingWrites.set(key, remaining);
    }
  }

  private isStale(): boolean {
    if (!this.hydrated) return true;
    return Date.now() - this.lastHydratedAt >= FEATURE_FLAGS_REVALIDATE_MS;
  }

  /** Loads (or reloads) the table into the cache. When the cache is
   *  fresh this resolves immediately; when stale, concurrent callers
   *  share one in-flight (re)load and the returned promise resolves
   *  only after the reload has been applied — callers that await it
   *  (ensureDbFeatureFlags) therefore check flags against state at
   *  most one revalidation window old, and a caller arriving right
   *  after another process flipped a flag gets the new value on the
   *  first stale read. A failed (re)load keeps the last good cache,
   *  does NOT mark it fresh, and clears the in-flight handle so the
   *  next call retries. */
  ensureHydrated(): Promise<void> {
    if (!this.isStale()) return Promise.resolve();
    if (!this.hydration) {
      const loadStartEpoch = this.flipEpoch;
      this.hydration = (async () => {
        try {
          const rows = await prisma.featureFlag.findMany({
            select: { key: true, enabled: true },
          });
          for (const row of rows) {
            if (!this.cache.isKnown(row.key)) continue;
            // Never overwrite a flip whose write is still in flight…
            if (this.dirtyKeys.has(row.key)) continue;
            // …nor a flip that landed after this load started (its
            // snapshot may predate the flip's upsert).
            if ((this.flipEpochByKey.get(row.key) ?? 0) > loadStartEpoch) continue;
            this.cache.setEnabled(row.key, row.enabled);
          }
          this.hydrated = true;
          this.lastHydratedAt = Date.now();
        } catch (e) {
          // DB unreachable: keep serving the last good cache (or the
          // fail-closed catalogue defaults before the first load)
          // and allow a later retry (do not cache the failed load,
          // do not mark the cache fresh).
          this.lastWriteError = e;
        } finally {
          this.hydration = null;
        }
      })();
    }
    return this.hydration;
  }

  /** Awaits every queued persistence write. Throws if the last write
   *  failed, so the API route can answer honestly instead of claiming
   *  a persisted toggle that never landed. */
  async flush(): Promise<void> {
    await this.writeChain;
    if (this.lastWriteError) {
      const err = this.lastWriteError;
      this.lastWriteError = null;
      throw err instanceof Error ? err : new Error("Feature flag write failed.");
    }
  }
}

/** The one DB flag source for this process. */
export const dbFeatureFlagSource = new DbFeatureFlagSource();

// Immediately install behind sharedFeatureFlagSource so all consumers use the DB source
if (!sharedFeatureFlagSource.isInstalled) {
  installFeatureFlagSource(dbFeatureFlagSource);
}

/**
 * Installs the DB source behind the shared reader and hydrates it.
 * Safe to call repeatedly (install + hydration are idempotent).
 */
export async function ensureDbFeatureFlags(): Promise<void> {
  if (!sharedFeatureFlagSource.isInstalled) {
    installFeatureFlagSource(dbFeatureFlagSource);
  }
  await dbFeatureFlagSource.ensureHydrated();
}

/** Awaits pending flag writes (see DbFeatureFlagSource.flush). */
export async function flushFeatureFlagWrites(): Promise<void> {
  await dbFeatureFlagSource.flush();
}
