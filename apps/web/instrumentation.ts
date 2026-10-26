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
 * - Call-center auto tasks: the order-event handler in
 *   src/callcenter/auto-tasks.ts is subscribed to the domain-event bus
 *   (fraud-review order -> confirmation task; FAILED/RETURNED delivery
 *   -> rescue task; idempotent per order+kind, flag-gated per event).
 *
 * Both are best-effort at boot: on a DB failure the app still starts
 * fail-closed (flags OFF = catalogue defaults; coupon snapshot warms
 * again on first module load / admin write), and the API routes that
 * need the DB answer 503 honestly.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // The two boot loads are independent — run them in parallel so a
  // cold instance pays max(flags, coupons) instead of their sum
  // before its first request. Each keeps its own try/catch: one
  // failing neither blocks the other nor crashes boot.
  await Promise.all([
    (async () => {
      try {
        const { ensureDbFeatureFlags } = await import("./src/lib/feature-flags-db");
        await ensureDbFeatureFlags();
      } catch {
        // Fail-closed: flags remain on the in-memory catalogue defaults.
      }
    })(),
    (async () => {
      try {
        const { refreshCouponSnapshot } = await import("./src/marketing/repository");
        await refreshCouponSnapshot();
      } catch {
        // Snapshot also warms at module load; checkout falls back safely.
      }
    })(),
  ]);
  try {
    // Call-center auto tasks: subscribe to the order event bus so
    // fraud-review orders and failed/returned deliveries create call
    // tasks without any manual step (src/callcenter/auto-tasks.ts).
    // The handler itself checks the module.call_center flag per event
    // and never throws; registration is globalThis-guarded.
    const { ensureCallTaskAutoGeneration } = await import("./src/callcenter/auto-tasks");
    ensureCallTaskAutoGeneration();
  } catch {
    // Auto-generation is additive — the manual call-center flow is
    // unaffected if this wiring ever fails to load.
  }
}
