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

export class DbFeatureFlagSource implements FeatureFlagSource {
  private readonly cache = new InMemoryFeatureFlagSource();
  private hydration: Promise<void> | null = null;
  private hydrated = false;
  /** Keys flipped locally since construction: hydration must not
   *  overwrite a fresher in-process flip with a stale table value
   *  (their write-chain upsert persists them right after). */
  private readonly dirtyKeys = new Set<string>();
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
    this.cache.setEnabled(key, enabled);
    this.writeChain = this.writeChain
      .then(async () => {
        const def = this.cache.getFlag(key);
        await prisma.featureFlag.upsert({
          where: { key },
          create: { key, enabled, description: def?.description ?? null },
          update: { enabled },
        });
      })
      .catch((e: unknown) => {
        this.lastWriteError = e;
      });
  }

  /** Loads the table into the cache. Idempotent; concurrent callers
   *  share one in-flight load. */
  ensureHydrated(): Promise<void> {
    if (this.hydrated) return Promise.resolve();
    if (!this.hydration) {
      this.hydration = (async () => {
        try {
          const rows = await prisma.featureFlag.findMany({
            select: { key: true, enabled: true },
          });
          for (const row of rows) {
            if (this.cache.isKnown(row.key) && !this.dirtyKeys.has(row.key)) {
              this.cache.setEnabled(row.key, row.enabled);
            }
          }
          this.hydrated = true;
        } catch (e) {
          // DB unreachable: stay fail-closed on catalogue defaults and
          // allow a later retry (do not cache the failed promise).
          this.lastWriteError = e;
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
