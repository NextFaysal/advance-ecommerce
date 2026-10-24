/**
 * Feature-flag API store — Agent 39, migrated to the unified reader by
 * Agent 60.
 *
 * This module no longer keeps its own flag state. It is a thin
 * route-local facade over the ONE unified flag store in
 * src/lib/feature-flags.ts (`demoFeatureFlagSource`): the catalogue is
 * FEATURE_FLAG_DEFINITIONS there, which mirrors FEATURE_FLAGS in
 * packages/db/prisma/seed.ts exactly (19 keys, all OFF by default), and
 * PATCH toggles write through the unified store — so a flip made via
 * this API is visible in the same process to every other migrated
 * consumer (advanced-orders page gate, AI-assist page gate).
 *
 * When the Prisma wiring lands, the unified module swaps its demo
 * source for a DB source reading the `feature_flags` table; this facade
 * and the route contract do not change, and toggles persist (with the
 * audit entry written via writeAudit()).
 */
import {
  FEATURE_FLAG_DEFINITIONS,
  featureFlags,
  type FeatureFlagRecord,
} from "@/lib/feature-flags";

export interface DemoFeatureFlag {
  key: string;
  description: string;
}

/** The catalogue — re-exported from the unified module (seed mirror). */
export const DEMO_FEATURE_FLAGS: readonly DemoFeatureFlag[] = FEATURE_FLAG_DEFINITIONS;

export function isKnownFlag(key: string): boolean {
  return featureFlags.isKnownFlag(key);
}

/** Reads the unified demo store (the stand-in for the DB flag reader). */
export function isFlagEnabledDemo(key: string): boolean {
  return featureFlags.isFeatureEnabled(key);
}

/** Writes through to the unified demo store — visible to all migrated consumers. */
export function setFlagEnabledDemo(key: string, enabled: boolean): void {
  featureFlags.setFeatureEnabled(key, enabled);
}

export function listFlagsWithState(): FeatureFlagRecord[] {
  return featureFlags.listFeatureFlags();
}
