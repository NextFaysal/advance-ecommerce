/**
 * Custom-fields storage — ADV-26 wiring (doc 23, wave 53).
 *
 * The engine in ./custom-fields.ts + ./types.ts defines the shapes
 * and the validator but deliberately ships NO storage (see the
 * drift note in ./store.ts: definitions are merchant configuration
 * data, and the core entities have no JSON extras column). This
 * module is that storage, following the established Setting-doc
 * pattern (security.ip_rules / support.* docs): machine-shaped JSON
 * docs over prisma.setting, read through getSetting (memo + Redis
 * layer), written by direct upsert + invalidateSettingCache from
 * the admin routes, which own guard + audit.
 *
 * Docs:
 *   custom_fields.definitions  = { definitions: CustomFieldDefinition[] }
 *   custom_fields.values.<entity> = { values: { [entityId]: { [key]: value } } }
 *     one doc per WIRED entity ("product" | "customer" | "order").
 *     The engine also names a "variant" entity — it is NOT wired in
 *     this wave (no admin surface edits variant-level extras), and
 *     the definitions API refuses variant definitions until it is.
 *
 * Rules enforced here (single choke point — no caller can bypass):
 *  - Every values write passes the engine's
 *    validateCustomFieldValues() against the entity's CURRENT
 *    definitions; failures return the engine's { ok:false, errors }
 *    shape untouched so routes surface it verbatim.
 *  - Only entities with at least one stored value keep an entry;
 *    saving an empty value set removes the entity's entry, so
 *    "no values" and "never touched" read identically (null).
 *  - Reads NEVER throw and never fabricate: a missing/corrupt doc
 *    reads as empty; invalid stored entries are dropped on read.
 *
 * When no definitions exist for an entity, every consumer treats
 * the feature as absent — checkout, order create and the admin
 * screens behave byte-identically (nothing here is on their path).
 */
import { prisma } from "@advance-ecommerce/db";
import { getSetting, invalidateSettingCache } from "@/lib/settings";
import {
  customFieldDefinitionSchema,
  type CustomFieldDefinition,
  type CustomFieldValue,
} from "./types";
import { validateCustomFieldValues, type CustomFieldValidation } from "./custom-fields";

export const CUSTOM_FIELD_DEFINITIONS_DOC_KEY = "custom_fields.definitions";
export const CUSTOM_FIELD_VALUES_DOC_PREFIX = "custom_fields.values.";

/** Entities wired in wave 53 (the engine's "variant" is not). */
export const WIRED_CUSTOM_FIELD_ENTITIES = ["product", "customer", "order"] as const;
export type WiredCustomFieldEntity = (typeof WIRED_CUSTOM_FIELD_ENTITIES)[number];

export function isWiredCustomFieldEntity(value: string): value is WiredCustomFieldEntity {
  return (WIRED_CUSTOM_FIELD_ENTITIES as readonly string[]).includes(value);
}

/** Total definition cap across all entities (house doc caps: KB 200,
 *  canned replies 100 — definitions are configuration, 100 is ample). */
export const CUSTOM_FIELD_DEFINITIONS_CAP = 100;

export type CustomFieldValuesRecord = Record<string, CustomFieldValue>;

function valuesDocKey(entity: WiredCustomFieldEntity): string {
  return `${CUSTOM_FIELD_VALUES_DOC_PREFIX}${entity}`;
}

/* ------------------------------------------------------------------ */
/* Definitions                                                          */
/* ------------------------------------------------------------------ */

/** All definitions, valid subset only, sorted by entity + sortOrder.
 *  A missing/corrupt doc reads as []. */
export async function loadCustomFieldDefinitions(): Promise<CustomFieldDefinition[]> {
  try {
    const raw = await getSetting(CUSTOM_FIELD_DEFINITIONS_DOC_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { definitions?: unknown };
    if (!Array.isArray(parsed.definitions)) return [];
    const valid: CustomFieldDefinition[] = [];
    for (const item of parsed.definitions) {
      const result = customFieldDefinitionSchema.safeParse(item);
      if (result.success && isWiredCustomFieldEntity(result.data.entity)) {
        valid.push(result.data);
      }
    }
    return valid.sort(
      (a, b) => a.entity.localeCompare(b.entity) || a.sortOrder - b.sortOrder || a.key.localeCompare(b.key),
    );
  } catch {
    return [];
  }
}

export function definitionsForEntity(
  definitions: CustomFieldDefinition[],
  entity: WiredCustomFieldEntity,
): CustomFieldDefinition[] {
  return definitions.filter((d) => d.entity === entity);
}

async function saveDoc(key: string, value: unknown, actorId: string, description: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    create: {
      key,
      value: JSON.stringify(value),
      valueEncrypted: false,
      isPublic: false,
      category: "integrations",
      description,
      updatedById: actorId,
    },
    update: { value: JSON.stringify(value), valueEncrypted: false, updatedById: actorId },
  });
  invalidateSettingCache(key);
}

/** Whole-list replace (the definitions route validates first). */
export async function saveCustomFieldDefinitions(
  definitions: CustomFieldDefinition[],
  actorId: string,
): Promise<void> {
  await saveDoc(
    CUSTOM_FIELD_DEFINITIONS_DOC_KEY,
    { definitions },
    actorId,
    "Custom-field definitions (JSON, ADV-26)",
  );
}

/* ------------------------------------------------------------------ */
/* Values                                                               */
/* ------------------------------------------------------------------ */

/** The whole values doc for one entity: { [entityId]: valuesRecord }.
 *  Entries whose value record is not a plain object are dropped. */
export async function loadCustomFieldValues(
  entity: WiredCustomFieldEntity,
): Promise<Record<string, CustomFieldValuesRecord>> {
  try {
    const raw = await getSetting(valuesDocKey(entity));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { values?: unknown };
    if (!parsed.values || typeof parsed.values !== "object" || Array.isArray(parsed.values)) {
      return {};
    }
    const out: Record<string, CustomFieldValuesRecord> = {};
    for (const [entityId, record] of Object.entries(parsed.values as Record<string, unknown>)) {
      if (record && typeof record === "object" && !Array.isArray(record)) {
        out[entityId] = record as CustomFieldValuesRecord;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** One entity's stored values, or null when it has none — the
 *  "include customFields only when values exist" test every read
 *  surface (admin GETs, partner API) applies. */
export async function getEntityCustomFieldValues(
  entity: WiredCustomFieldEntity,
  entityId: string,
): Promise<CustomFieldValuesRecord | null> {
  const all = await loadCustomFieldValues(entity);
  const record = all[entityId];
  if (!record || Object.keys(record).length === 0) return null;
  return record;
}

/** Attach-helper for list serialisers: returns a Map of entityId →
 *  values for the given ids, containing ONLY ids with values. One
 *  doc read per call, not one per row. */
export async function getCustomFieldValuesForIds(
  entity: WiredCustomFieldEntity,
  entityIds: string[],
): Promise<Map<string, CustomFieldValuesRecord>> {
  const map = new Map<string, CustomFieldValuesRecord>();
  if (entityIds.length === 0) return map;
  const all = await loadCustomFieldValues(entity);
  for (const id of entityIds) {
    const record = all[id];
    if (record && Object.keys(record).length > 0) map.set(id, record);
  }
  return map;
}

/**
 * Validate + persist one entity's values. Validation runs through
 * the engine against the entity's current definitions — unknown
 * keys, missing required fields and type errors all come back in
 * the engine's error shape, unwritten. On success the CLEANED value
 * set is stored (an empty cleaned set removes the entity's entry).
 */
export async function validateAndSetEntityCustomFieldValues(
  entity: WiredCustomFieldEntity,
  entityId: string,
  rawValues: Record<string, unknown>,
  actorId: string,
): Promise<CustomFieldValidation> {
  const definitions = definitionsForEntity(await loadCustomFieldDefinitions(), entity);
  const result = validateCustomFieldValues(
    definitions,
    rawValues as Record<string, CustomFieldValue>,
  );
  if (!result.ok) return result;

  const all = await loadCustomFieldValues(entity);
  if (Object.keys(result.values).length === 0) {
    delete all[entityId];
  } else {
    all[entityId] = result.values;
  }
  await saveDoc(
    valuesDocKey(entity),
    { values: all },
    actorId,
    `Custom-field values: ${entity} (JSON, ADV-26)`,
  );
  return result;
}
