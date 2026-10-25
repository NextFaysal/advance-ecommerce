/**
 * Call-center scripts store — C3 (call-center advanced plan, phase C3).
 *
 * Per-source call scripts, stored exactly like CMS site content
 * (src/cms/site-content.ts): one JSON document per key in the Prisma
 * `Setting` table — there is no Script model in the schema and this
 * module may not migrate.
 *
 *   key "callcenter.script.<SOURCE>" -> StoredScriptDoc
 *   SOURCE in PENDING_ORDER | FAILED_DELIVERY | ABANDONED_CHECKOUT |
 *             MANUAL | DEFAULT
 *
 * Versioning: the built-in CONFIRMATION_SCRIPT (types.ts) is "v1".
 * A stored doc carries an integer version; the first save over the
 * built-in becomes v2, the next v3, and so on. The outcome route
 * stamps the version label ("v2") onto the call log, so a QA reviewer
 * can tell which script text an agent was shown.
 *
 * Fallback: a source with no saved doc — or a corrupted one — reads as
 * the built-in CONFIRMATION_SCRIPT steps with isDefault: true. The
 * built-in is confirmation-worded; for the other sources it is an
 * editing starting point, never passed off as a purpose-written script
 * (the editor shows the "built-in default" state honestly).
 *
 * Scripts are internal-only: rows are stored isPublic: false.
 */
import { prisma } from "@advance-ecommerce/db";
import { z } from "zod";
import { CONFIRMATION_SCRIPT, type CallQueueSource } from "./types";

export type CallScriptSource = CallQueueSource | "DEFAULT";

export const CALL_SCRIPT_SOURCES: readonly CallScriptSource[] = [
  "PENDING_ORDER",
  "FAILED_DELIVERY",
  "ABANDONED_CHECKOUT",
  "MANUAL",
  "DEFAULT",
];

export function scriptSettingKey(source: CallScriptSource): string {
  return `callcenter.script.${source}`;
}

export const scriptStepDocSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9][a-z0-9-_]*$/i, "step key must be a slug (letters, digits, - or _)"),
  promptBn: z.string().min(1).max(1000),
  promptEn: z.string().max(1000).optional(),
});

export type ScriptStepDoc = z.infer<typeof scriptStepDocSchema>;

export const scriptSaveInputSchema = z.object({
  steps: z.array(scriptStepDocSchema).min(1).max(20),
});

export interface StoredScriptDoc {
  version: number;
  steps: ScriptStepDoc[];
  updatedAt: string;
  updatedBy: string;
}

const storedScriptDocSchema = z.object({
  version: z.number().int().positive(),
  steps: z.array(scriptStepDocSchema).min(1).max(20),
  updatedAt: z.string(),
  updatedBy: z.string(),
});

export interface EffectiveScript {
  source: CallScriptSource;
  /** Integer version: 1 = the built-in CONFIRMATION_SCRIPT. */
  version: number;
  /** "v1", "v2", … — the label stamped onto call logs at outcome time. */
  versionLabel: string;
  /** True when nothing is saved for this source (built-in fallback). */
  isDefault: boolean;
  steps: ScriptStepDoc[];
  updatedAt?: string;
  updatedBy?: string;
}

export function scriptVersionLabel(version: number): string {
  return `v${version}`;
}

/** Built-in v1 steps in the stored-doc shape (outcomes hints dropped —
 *  they belong to the confirmation flow, not to stored script text). */
const BUILTIN_STEPS: ScriptStepDoc[] = CONFIRMATION_SCRIPT.map((s) => ({
  key: s.key,
  promptBn: s.promptBn,
  promptEn: s.promptEn,
}));

function builtinScript(source: CallScriptSource): EffectiveScript {
  return {
    source,
    version: 1,
    versionLabel: scriptVersionLabel(1),
    isDefault: true,
    steps: BUILTIN_STEPS.map((s) => ({ ...s })),
  };
}

function parseStoredDoc(raw: string | null): StoredScriptDoc | null {
  if (raw === null || raw.trim() === "") return null;
  try {
    const result = storedScriptDocSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

async function readStoredDoc(source: CallScriptSource): Promise<StoredScriptDoc | null> {
  const row = await prisma.setting.findUnique({ where: { key: scriptSettingKey(source) } });
  if (!row || row.valueEncrypted) return null;
  return parseStoredDoc(row.value);
}

/** Effective script for one source: saved doc, else the built-in v1. */
export async function getEffectiveScript(source: CallScriptSource): Promise<EffectiveScript> {
  const doc = await readStoredDoc(source);
  if (!doc) return builtinScript(source);
  return {
    source,
    version: doc.version,
    versionLabel: scriptVersionLabel(doc.version),
    isDefault: false,
    steps: doc.steps,
    updatedAt: doc.updatedAt,
    updatedBy: doc.updatedBy,
  };
}

/** All sources with their effective scripts (editor + API list view). */
export async function listEffectiveScripts(): Promise<EffectiveScript[]> {
  return Promise.all(CALL_SCRIPT_SOURCES.map((s) => getEffectiveScript(s)));
}

/**
 * Save a source's script. The version increments from whatever is
 * currently effective (built-in v1 → first save is v2). Input MUST
 * already be validated with scriptSaveInputSchema (the route does).
 * Returns the new effective script.
 */
export async function saveScript(
  source: CallScriptSource,
  steps: ScriptStepDoc[],
  actorId: string,
): Promise<EffectiveScript> {
  const current = await readStoredDoc(source);
  const doc: StoredScriptDoc = {
    version: (current?.version ?? 1) + 1,
    steps,
    updatedAt: new Date().toISOString(),
    updatedBy: actorId,
  };
  const key = scriptSettingKey(source);
  await prisma.setting.upsert({
    where: { key },
    create: {
      key,
      value: JSON.stringify(doc),
      valueEncrypted: false,
      isPublic: false,
      description: `Call-center script for ${source} (JSON, versioned — C3)`,
      category: "general",
      updatedById: actorId,
    },
    update: { value: JSON.stringify(doc), valueEncrypted: false, isPublic: false, updatedById: actorId },
  });
  return {
    source,
    version: doc.version,
    versionLabel: scriptVersionLabel(doc.version),
    isDefault: false,
    steps: doc.steps,
    updatedAt: doc.updatedAt,
    updatedBy: doc.updatedBy,
  };
}
