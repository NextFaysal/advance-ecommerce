/**
 * Feature-flag check for API routes — Agent 15, migrated to the unified
 * reader by Agent 62.
 *
 * Fail-closed, same posture as src/reports/guard.ts: if the flag is off
 * or the key is unknown the feature does not run. This helper previously
 * read the DB `feature_flags` table directly via Prisma and — with the
 * Prisma client ungenerated — always failed closed with 503
 * FEATURE_FLAG_UNAVAILABLE. It now reads through the ONE unified flag
 * reader in src/lib/feature-flags.ts, the app-wide stand-in for the DB
 * flag reader (the same store the feature-flags API PATCHes), so the AI
 * and analytics routes gate exactly like every other module: 403
 * FEATURE_DISABLED while OFF, open when the flag is flipped on. When
 * the DB-backed source replaces the demo source inside
 * src/lib/feature-flags.ts, this helper reads the DB with no change
 * here. The exported API (FlagResult, requireFeature) is unchanged.
 */
import { isFeatureEnabled } from "../lib/feature-flags";

export type FlagResult =
  | { enabled: true }
  | { enabled: false; status: number; code: string; message: string };

export async function requireFeature(key: string): Promise<FlagResult> {
  if (isFeatureEnabled(key)) return { enabled: true };
  return {
    enabled: false,
    status: 403,
    code: "FEATURE_DISABLED",
    message: `Feature ${key} is not enabled for this store. Enable it in Admin > Settings > Feature Flags.`,
  };
}
