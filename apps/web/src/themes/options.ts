/**
 * Theme instance options — storage + strict validation (doc 25 §1.5,
 * §3.2; wave S2).
 *
 * An INSTANCE (a row of the theme catalog) may carry merchant-chosen
 * option values for its PACKAGE's typed options schema. Values live
 * OUTSIDE the catalog blob, one Setting doc per instance:
 *
 *   key:   theme.options.<instanceId>
 *   value: JSON object { [optionKey]: value }  (validated entries only)
 *   row:   category "appearance", isPublic false (admin data — values
 *          reach the storefront only through server-side resolution)
 *
 * Validation discipline (doc 25 §1.5): options are DATA, never code.
 * `validateThemeOptions` is the strict write-path validator used by
 * the admin API (invalid known key → error, unknown key → dropped).
 * The per-field rules themselves live in registry.ts
 * (`coerceThemeOptionValue`) so the read-path overlay in
 * resolution.ts — which must stay Prisma-free for the client
 * ThemeView context — applies the exact same rules.
 *
 * SERVER-ONLY: imports Prisma. Never import from client components
 * (resolution.ts is the client-safe seam; this module is not).
 */
import { prisma } from "@advance-ecommerce/db";
import {
  coerceThemeOptionValue,
  type ThemeOptionValue,
  type ThemeOptions,
  type ThemePackage,
} from "./registry";

/* ------------------------------------------------------------------ */
/* Storage                                                            */
/* ------------------------------------------------------------------ */

/** Setting key holding one instance's stored option values. */
export function themeOptionsSettingKey(instanceId: string): string {
  return `theme.options.${instanceId}`;
}

/**
 * The instance's stored option values, exactly as persisted ({} when
 * no doc exists or the stored JSON is not an object). Callers must
 * treat the result as untrusted and overlay it through
 * overlayThemeOptions / a *WithOptions resolver before use — this
 * function deliberately does not validate, because validation needs
 * the package schema and happens at resolution time.
 */
export async function getThemeOptions(
  instanceId: string,
): Promise<Record<string, ThemeOptionValue>> {
  try {
    const row = await prisma.setting.findUnique({
      where: { key: themeOptionsSettingKey(instanceId) },
    });
    if (!row) return {};
    const parsed: unknown = JSON.parse(row.value);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, ThemeOptionValue>;
  } catch {
    return {};
  }
}

/**
 * Persist an instance's option values (already validated — the admin
 * API passes validateThemeOptions().values). Same Setting upsert
 * pattern as the theme catalog in src/lib/theme-repository.ts.
 */
export async function setThemeOptions(
  instanceId: string,
  values: ThemeOptions,
): Promise<void> {
  const key = themeOptionsSettingKey(instanceId);
  await prisma.setting.upsert({
    where: { key },
    update: { value: JSON.stringify(values) },
    create: {
      key,
      value: JSON.stringify(values),
      isPublic: false,
      category: "appearance",
    },
  });
}

/* ------------------------------------------------------------------ */
/* Strict validation (write path)                                     */
/* ------------------------------------------------------------------ */

export interface ThemeOptionsValidation {
  ok: boolean;
  /** Sanitised values: known keys only, every entry schema-valid. */
  values: ThemeOptions;
  /** One message per invalid known key (unknown keys are dropped). */
  errors: string[];
}

function invalidMessage(pkg: ThemePackage, key: string): string {
  const field = pkg.optionsSchema.find((f) => f.key === key);
  if (!field) return `Option "${key}" is invalid.`;
  switch (field.type) {
    case "boolean":
      return `Option "${key}" must be a boolean.`;
    case "number":
      return `Option "${key}" must be a finite number between ${field.min} and ${field.max}.`;
    case "select":
      return `Option "${key}" must be one of: ${field.choices
        .map((c) => c.value)
        .join(", ")}.`;
    case "color":
      return `Option "${key}" must be a hex colour (#rgb or #rrggbb).`;
    case "text":
      return `Option "${key}" must be a string of at most ${field.maxLength} characters.`;
  }
}

/**
 * Validate an untrusted options payload against a package schema.
 *
 * - Unknown keys are DROPPED silently (not an error): a payload may
 *   legitimately carry values written against a newer/older schema.
 * - A known key with an invalid value IS an error, and the key is
 *   excluded from `values` — the API answers 400 and persists nothing,
 *   so a bad value can never reach storage through this path.
 * - A non-object payload is a single error with empty values.
 */
export function validateThemeOptions(
  pkg: ThemePackage,
  input: unknown,
): ThemeOptionsValidation {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, values: {}, errors: ["Options must be a JSON object."] };
  }
  const fieldsByKey = new Map(pkg.optionsSchema.map((f) => [f.key, f]));
  const values: ThemeOptions = {};
  const errors: string[] = [];
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    const field = fieldsByKey.get(key);
    if (!field) continue; // unknown key → dropped, not an error
    const value = coerceThemeOptionValue(field, raw);
    if (value === undefined) {
      errors.push(invalidMessage(pkg, key));
    } else {
      values[key] = value;
    }
  }
  return { ok: errors.length === 0, values, errors };
}
