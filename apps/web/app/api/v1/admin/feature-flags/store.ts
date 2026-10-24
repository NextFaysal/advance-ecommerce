/**
 * Feature-flag API store — Agent 39, migrated to the unified reader by
 * Agent 60, DB-backed by the persistence swap.
 *
 * This module is a thin route-local facade over the ONE unified flag
 * store in src/lib/feature-flags.ts: the catalogue is
 * FEATURE_FLAG_DEFINITIONS there, which mirrors FEATURE_FLAGS in
 * packages/db/prisma/seed.ts exactly (19 keys, all OFF by default).
 *
 * Enabled state now persists in the FeatureFlag table through the DB
 * source in src/lib/feature-flags-db.ts: the async helpers below
 * install + hydrate that source before reading, and a toggle awaits
 * flushFeatureFlagWrites() so a successful response means the row is
 * in the DB. In-process consumers keep reading the same unified reader
 * synchronously and see a flip in the same tick (the DB source updates
 * its cache before persisting) — Agent 62's unified-reader behaviour.
 * The sync facade functions remain for compatibility and read through
 * the shared source (DB-backed once installed).
 */
import {
  FEATURE_FLAG_DEFINITIONS,
  featureFlags,
  type FeatureFlagRecord,
} from "@/lib/feature-flags";
import {
  ensureDbFeatureFlags,
  flushFeatureFlagWrites,
} from "@/lib/feature-flags-db";

export interface DemoFeatureFlag {
  key: string;
  description: string;
}

/** The catalogue — re-exported from the unified module (seed mirror). */
export const DEMO_FEATURE_FLAGS: readonly DemoFeatureFlag[] = FEATURE_FLAG_DEFINITIONS;

export function isKnownFlag(key: string): boolean {
  return featureFlags.isKnownFlag(key);
}

/** Reads the unified store (DB source once installed/hydrated). */
export function isFlagEnabledDemo(key: string): boolean {
  return featureFlags.isFeatureEnabled(key);
}

/** Writes through to the unified store — visible to all migrated consumers. */
export function setFlagEnabledDemo(key: string, enabled: boolean): void {
  featureFlags.setFeatureEnabled(key, enabled);
}

export function listFlagsWithState(): FeatureFlagRecord[] {
  return featureFlags.listFeatureFlags();
}

/* ------------------------------------------------------------------ */
/* DB-backed async path (used by the API route)                        */
/* ------------------------------------------------------------------ */

/** Installs + hydrates the DB source, then lists flags from it. */
export async function listFlagsWithStateDb(): Promise<FeatureFlagRecord[]> {
  await ensureDbFeatureFlags();
  return featureFlags.listFeatureFlags();
}

/** Installs + hydrates the DB source, then reads one flag's state. */
export async function isFlagEnabledDb(key: string): Promise<boolean> {
  await ensureDbFeatureFlags();
  return featureFlags.isFeatureEnabled(key);
}

/**
 * Toggles a flag through the unified store and awaits persistence:
 * resolves only after the FeatureFlag row is written, rejects if the
 * write failed (the route must not claim a persisted toggle then).
 */
export async function setFlagEnabledDb(key: string, enabled: boolean): Promise<void> {
  await ensureDbFeatureFlags();
  featureFlags.setFeatureEnabled(key, enabled);
  await flushFeatureFlagWrites();
}
