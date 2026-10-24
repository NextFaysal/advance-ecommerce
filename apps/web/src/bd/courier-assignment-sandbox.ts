/**
 * Sandbox rate cross-check for the courier assignment engine —
 * SERVER-ONLY. Split out of ./courier-assignment.ts because it calls
 * the sandbox providers (createSandboxCourierProvider), whose module
 * chain reaches node:crypto (deterministic.ts); the assignment engine
 * itself is imported by a client component and must stay client-safe.
 */
import type { ShippingZone } from "../integrations/courier";
import { createSandboxCourierProvider, SANDBOX_COURIER_PROVIDERS } from "../integrations/sandbox/courier-provider";

/**
 * The REAL sandbox rates (charge + ETA) straight from each sandbox
 * provider's getRates() — for callers/tests that want to verify the
 * sample stats table's estimatedDays and the engine's charges against
 * the sandbox source instead of trusting the copies.
 */
export async function getSandboxRates(
  zone: ShippingZone,
  weightGrams: number,
): Promise<Array<{ provider: string; chargePoisha: number; estimatedDays: number | null }>> {
  const out: Array<{ provider: string; chargePoisha: number; estimatedDays: number | null }> = [];
  for (const name of SANDBOX_COURIER_PROVIDERS) {
    const rates = await createSandboxCourierProvider(name).getRates({
      zone,
      district: "",
      weightGrams,
      orderValuePoisha: 0,
    });
    for (const rate of rates) {
      out.push({ provider: rate.provider, chargePoisha: rate.chargePoisha, estimatedDays: rate.estimatedDays });
    }
  }
  return out;
}
