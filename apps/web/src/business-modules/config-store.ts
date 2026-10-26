/**
 * Business-pack config persistence — ADV-22 (doc 22).
 *
 * Until ADV-22 the pack configs were VALIDATION-ONLY: the admin
 * modules route checked a submitted config against its zod schema and
 * threw it away (meta.persistence "none-pure-validation"), so every
 * consumer would have run on the code defaults forever. This store
 * persists a validated config as a JSON document in the Setting table
 * — the established saved-reports / marketing-docs pattern (the
 * generic settings API rejects unknown keys, and these documents are
 * machine-shaped, so they get their own zod-validated doc store over
 * prisma.setting). Keys: business_modules.<packId>.
 *
 * Read contract: a saved doc that fails validation falls back to the
 * pack's defaultConfig — a corrupt doc must never take the storefront
 * down or run a pack on half-parsed rules. `source` reports which one
 * was used so admin surfaces can show it honestly.
 */
import { getPack, isPackEnabled, validatePackConfig, type AnyPackConfig } from "./packs";
import type { BusinessPackId } from "./types";

export function packConfigKey(id: BusinessPackId): string {
  return `business_modules.${id}`;
}

export interface SavedPackConfig {
  config: AnyPackConfig;
  /** "saved" = merchant-saved doc; "default" = code defaults (no doc, or doc failed validation). */
  source: "saved" | "default";
}

/** Production store (prisma imported lazily, the marketing-docs pattern). */
async function readRawDoc(key: string): Promise<string | null> {
  const { prisma } = await import("@advance-ecommerce/db");
  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.value ?? null;
}

async function writeRawDoc(key: string, value: string, actorId: string): Promise<void> {
  const { prisma } = await import("@advance-ecommerce/db");
  await prisma.setting.upsert({
    where: { key },
    create: {
      key,
      value,
      valueEncrypted: false,
      isPublic: false,
      category: "general",
      description: "Business pack config document (JSON, ADV-22)",
      updatedById: actorId,
    },
    update: { value, valueEncrypted: false, updatedById: actorId },
  });
}

/** The pack's effective config: saved doc (validated) or code defaults. */
export async function getSavedPackConfig(id: BusinessPackId): Promise<SavedPackConfig> {
  const pack = getPack(id);
  if (!pack) throw new Error(`Unknown business pack: ${id}`);
  const raw = await readRawDoc(packConfigKey(id)).catch(() => null);
  if (raw) {
    try {
      const parsed = validatePackConfig(id, JSON.parse(raw));
      if (parsed.ok) return { config: parsed.config, source: "saved" };
    } catch {
      // Corrupt JSON — fall through to defaults (documented above).
    }
  }
  return { config: pack.defaultConfig, source: "default" };
}

/** Persist an already-validated config (the caller validates first). */
export async function savePackConfig(id: BusinessPackId, config: AnyPackConfig, actorId: string): Promise<void> {
  await writeRawDoc(packConfigKey(id), JSON.stringify(config), actorId);
}

/**
 * Convenience for wiring surfaces: the effective config when the pack
 * flag is ON, null when the pack is locked (a locked pack never runs).
 * Flag state comes from the unified store — callers that serve
 * requests hydrate it first (ensureDbFeatureFlags), exactly like the
 * other flag-gated reads in this codebase.
 */
export async function getEnabledPackConfig<T extends AnyPackConfig>(id: BusinessPackId): Promise<T | null> {
  if (!isPackEnabled(id)) return null;
  const { config } = await getSavedPackConfig(id);
  return config as T;
}
