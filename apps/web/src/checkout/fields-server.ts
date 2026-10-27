/**
 * Checkout fields config — server side (doc 28).
 *
 * Storage: ONE Setting document, key `checkout.fields`, holding the
 * CheckoutFieldsConfig JSON from src/checkout/fields.ts (the PURE
 * contract module). Written with the established doc-store mechanism
 * (direct prisma.setting.upsert + invalidateSettingCache — the
 * generic setSetting() path rejects keys outside SETTING_DEFAULTS,
 * the same reason restaurant.config / templates.* docs have their
 * own stores).
 *
 * FAIL-SOFT READS (the restaurant config-store contract): a missing
 * doc, a corrupt doc, or a DB error resolves to
 * DEFAULT_CHECKOUT_FIELDS_CONFIG — the original hardcoded checkout
 * form. A corrupt config must never take checkout down, and with no
 * saved doc the storefront behaves exactly as it did before doc 28.
 */
import { prisma } from "@advance-ecommerce/db";
import { getSetting, invalidateSettingCache } from "@/lib/settings";
import {
  coerceCheckoutFieldsConfig,
  type CheckoutFieldsConfig,
} from "./fields";

export const CHECKOUT_FIELDS_KEY = "checkout.fields";

/** The stored config, coerced — never throws. */
export async function getCheckoutFieldsConfig(): Promise<CheckoutFieldsConfig> {
  let raw: string | null = null;
  try {
    raw = await getSetting(CHECKOUT_FIELDS_KEY);
  } catch {
    raw = null;
  }
  if (raw) {
    try {
      return coerceCheckoutFieldsConfig(JSON.parse(raw));
    } catch {
      // Corrupt JSON — fall through to the defaults (documented above).
    }
  }
  return coerceCheckoutFieldsConfig(null);
}

/** Persist a config (the admin route coerces first; coercion is
 *  re-applied here so a hand-built caller cannot store an invalid
 *  document). Throws on DB failure — the route reports 503 rather
 *  than claiming a save that did not happen. */
export async function saveCheckoutFieldsConfig(
  config: CheckoutFieldsConfig,
  actorId: string,
): Promise<void> {
  const value = JSON.stringify(coerceCheckoutFieldsConfig(config));
  await prisma.setting.upsert({
    where: { key: CHECKOUT_FIELDS_KEY },
    create: {
      key: CHECKOUT_FIELDS_KEY,
      value,
      valueEncrypted: false,
      isPublic: false,
      category: "general",
      description: "Checkout fields config document (JSON, doc 28)",
      updatedById: actorId,
    },
    update: { value, valueEncrypted: false, updatedById: actorId },
  });
  invalidateSettingCache(CHECKOUT_FIELDS_KEY);
}
