/**
 * Subscriptions feature flag (ADV-18 remainder).
 *
 * The flag DEFINITION is registered centrally — the parent registers
 * this exact entry in BOTH src/lib/feature-flags.ts
 * (FEATURE_FLAG_DEFINITIONS) and packages/db/prisma/seed.ts
 * (FEATURE_FLAGS), descriptions identical:
 *
 *   { key: "module.subscriptions", description: "Customer subscriptions / auto-replenish (v2 add-on, ADV-18)" }
 *
 * Until that registration lands, the shared reader has no record for
 * the key and isFeatureEnabled() returns false — the module fails
 * CLOSED (routes 403 FEATURE_LOCKED, the generator no-ops), which is
 * the correct pre-launch state for an OFF-by-default add-on.
 */
import { isFeatureEnabled } from "@/lib/feature-flags";

export const SUBSCRIPTIONS_FLAG_KEY = "module.subscriptions";

export function subscriptionsEnabled(): boolean {
  return isFeatureEnabled(SUBSCRIPTIONS_FLAG_KEY);
}
