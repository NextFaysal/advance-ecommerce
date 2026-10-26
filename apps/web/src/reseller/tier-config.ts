/**
 * Tier config loader — reads the reseller.tiers.* Settings keys and
 * parses them through the pure engine (tiers.ts). The reader is
 * injectable for smokes; production reads the encrypted-Settings store
 * via src/lib/settings.ts getSetting (defaults are registered there,
 * so an untouched install gets DEFAULT_TIER_CONFIG verbatim).
 */
import { getSetting } from "../lib/settings";
import { parseTierConfig, type TierConfig } from "./tiers";

export interface TierSettingsReader {
  getSetting(key: string): Promise<string | null>;
}

const defaultReader: TierSettingsReader = { getSetting };

export async function loadTierConfig(reader: TierSettingsReader = defaultReader): Promise<TierConfig> {
  const [rates, thresholds] = await Promise.all([
    reader.getSetting("reseller.tiers.rates_bps"),
    reader.getSetting("reseller.tiers.thresholds_poisha"),
  ]);
  return parseTierConfig(rates, thresholds);
}
