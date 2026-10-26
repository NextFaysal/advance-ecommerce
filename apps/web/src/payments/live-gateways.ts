/**
 * Settings-driven LIVE payment gateway resolution — ADV-4 (doc 22).
 *
 * ONE resolver for the live adapters (SSLCommerz + Nagad; bKash has
 * its own slice). Nobody constructs a live gateway anywhere else.
 *
 * A method counts as CONFIGURED only when BOTH hold:
 *   - `payment.<method>.enabled` is "true" (the admin's on/off
 *     intent — the same gate the sandbox initiation applies), and
 *   - every required credential field is present in the encrypted
 *     Settings store (read via getIntegrationConfigWithSecrets, i.e.
 *     the raw `payment.<method>.*` rows, secrets decrypted):
 *
 *       sslcommerz: store_id, store_password
 *                   (store_password also accepts the generic
 *                   `password` field other admin tools have written)
 *       nagad:      merchant_id, account_number,
 *                   merchant_private_key, nagad_public_key
 *                   (PEM strings; merchant_private_key is encrypted
 *                   at rest by the settings store's secret rule)
 *
 * `payment.<method>.mode` selects the provider environment the
 * adapter points at ("sandbox" = the provider's own test
 * environment with test credentials, "live" = production). Mode
 * does NOT decide live-vs-simulated — src/payments/initiate.ts owns
 * that dispatch (its sandbox mode is this app's simulated gateway;
 * this resolver is only consulted for the live branch).
 *
 * When a method is not configured this returns null and the caller
 * keeps today's honest behaviour (initiation reports
 * not_configured) — a store without a merchant account behaves
 * exactly as before ADV-4.
 *
 * The settings store is injected as a reader so the module is
 * smoke-testable with a fake reader; reader failures degrade to
 * "not configured", never to a crash and never to a fake gateway.
 */
import { getIntegrationConfigWithSecrets, getSetting } from "../lib/settings";
import type { PaymentGateway } from "../integrations/payment";
import {
  createSslCommerzGateway,
  type SslCommerzAdapterOptions,
} from "../integrations/sslcommerz";
import { createNagadGateway, type NagadAdapterOptions } from "../integrations/nagad";

export type LivePaymentMethod = "sslcommerz" | "nagad";

export const LIVE_PAYMENT_METHODS: readonly LivePaymentMethod[] = ["sslcommerz", "nagad"];

export interface PaymentSettingsReader {
  /** Effective setting value (DB -> env -> default), or null. */
  getSetting(key: string): Promise<string | null>;
  /** All `payment.<method>.*` fields, secrets decrypted. Server-side only. */
  getProviderSecrets(method: LivePaymentMethod): Promise<Record<string, string>>;
}

const defaultReader: PaymentSettingsReader = {
  getSetting: (key) => getSetting(key),
  getProviderSecrets: (method) => getIntegrationConfigWithSecrets("payment", method),
};

export interface PaymentProviderDiagnosis {
  provider: LivePaymentMethod;
  enabled: boolean;
  mode: "sandbox" | "live";
  /** Required credential fields that are absent/empty. */
  missingFields: string[];
  configured: boolean;
}

/** Canonical credential field names per method (the registration of
 *  record — see the module header for the full key list). */
export const LIVE_PAYMENT_REQUIRED_FIELDS: Record<LivePaymentMethod, readonly string[]> = {
  sslcommerz: ["store_id", "store_password"],
  nagad: ["merchant_id", "account_number", "merchant_private_key", "nagad_public_key"],
};

/** Field lookup accepting the alternate spelling other admin tools
 *  have used for the SSLCommerz store password. */
function fieldValue(fields: Record<string, string>, field: string): string {
  const direct = (fields[field] ?? "").trim();
  if (direct !== "") return direct;
  if (field === "store_password") return (fields.password ?? "").trim();
  return "";
}

async function safeGet(reader: PaymentSettingsReader, key: string): Promise<string | null> {
  try {
    return await reader.getSetting(key);
  } catch {
    return null;
  }
}

async function safeSecrets(
  reader: PaymentSettingsReader,
  method: LivePaymentMethod,
): Promise<Record<string, string>> {
  try {
    return await reader.getProviderSecrets(method);
  } catch {
    return {};
  }
}

export async function diagnosePaymentProvider(
  reader: PaymentSettingsReader,
  method: LivePaymentMethod,
): Promise<PaymentProviderDiagnosis> {
  const enabled = (await safeGet(reader, `payment.${method}.enabled`)) === "true";
  const modeRaw = (await safeGet(reader, `payment.${method}.mode`)) ?? "sandbox";
  const mode = modeRaw === "live" ? "live" : "sandbox";
  const fields = await safeSecrets(reader, method);
  const missingFields = LIVE_PAYMENT_REQUIRED_FIELDS[method].filter(
    (f) => fieldValue(fields, f) === "",
  );
  return { provider: method, enabled, mode, missingFields, configured: enabled && missingFields.length === 0 };
}

/**
 * Build the REAL adapter for exactly this method when it is fully
 * configured (enabled + all credentials), else null. Used by the
 * initiate dispatch (parent wiring) and by the callback/IPN routes,
 * which must build the gateway for the method they serve — never a
 * different one.
 */
export async function buildConfiguredPaymentGateway(
  reader: PaymentSettingsReader,
  method: LivePaymentMethod,
  opts: { sslcommerz?: SslCommerzAdapterOptions; nagad?: NagadAdapterOptions } = {},
): Promise<PaymentGateway | null> {
  const diagnosis = await diagnosePaymentProvider(reader, method);
  if (!diagnosis.configured) return null;
  const fields = await safeSecrets(reader, method);
  if (method === "sslcommerz") {
    return createSslCommerzGateway(
      {
        storeId: fieldValue(fields, "store_id"),
        storePassword: fieldValue(fields, "store_password"),
      },
      { mode: diagnosis.mode, ...(opts.sslcommerz ?? {}) },
    );
  }
  return createNagadGateway(
    {
      merchantId: fieldValue(fields, "merchant_id"),
      accountNumber: fieldValue(fields, "account_number"),
      merchantPrivateKeyPem: fieldValue(fields, "merchant_private_key"),
      nagadPublicKeyPem: fieldValue(fields, "nagad_public_key"),
    },
    { mode: diagnosis.mode, ...(opts.nagad ?? {}) },
  );
}

/** Default-reader convenience for routes / the initiate dispatch. */
export async function buildConfiguredPaymentGatewayFromSettings(
  method: LivePaymentMethod,
): Promise<PaymentGateway | null> {
  return buildConfiguredPaymentGateway(defaultReader, method);
}

export async function diagnosePaymentProviderFromSettings(
  method: LivePaymentMethod,
): Promise<PaymentProviderDiagnosis> {
  return diagnosePaymentProvider(defaultReader, method);
}
