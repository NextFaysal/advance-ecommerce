/**
 * Server startup wiring (Next instrumentation).
 *
 * Installs the DB-backed sources behind the app's synchronous reader
 * contracts, once per server process:
 * - Feature flags: the Prisma-backed source (src/lib/feature-flags-db)
 *   is installed behind the unified reader in src/lib/feature-flags.ts
 *   and hydrated from the FeatureFlag table, so module gates read the
 *   persisted state (seeded all OFF) instead of per-process defaults.
 * - Coupon snapshot: the marketing repository's snapshot is refreshed
 *   from the Coupon/CouponUsage tables so checkout evaluation sees DB
 *   coupons (with restart-proof usage counts) from the first request.
 *
 * Both are best-effort at boot: on a DB failure the app still starts
 * fail-closed (flags OFF = catalogue defaults; coupon snapshot warms
 * again on first module load / admin write), and the API routes that
 * need the DB answer 503 honestly.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { ensureDbFeatureFlags } = await import("./src/lib/feature-flags-db");
    await ensureDbFeatureFlags();
  } catch {
    // Fail-closed: flags remain on the in-memory catalogue defaults.
  }
  try {
    const { refreshCouponSnapshot } = await import("./src/marketing/repository");
    await refreshCouponSnapshot();
  } catch {
    // Snapshot also warms at module load; checkout falls back safely.
  }
}
