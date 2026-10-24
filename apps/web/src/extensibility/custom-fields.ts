/**
 * Custom-field value validation — Agent 17, Step 49 (A14).
 *
 * Definitions are merchant data (see types.ts). Every write of custom
 * values must pass through validateCustomFieldValues() against the
 * entity's definitions: unknown keys are rejected, required fields are
 * enforced, money fields must be integer poisha (a float is rejected,
 * never rounded), select values must be in the option list.
 */
import { z } from "zod";
import type { CustomFieldDefinition, CustomFieldValue } from "./types";

export type CustomFieldValidation =
  | { ok: true; values: Record<string, CustomFieldValue> }
  | { ok: false; errors: Array<{ key: string; message: string }> };

function validateOne(
  def: CustomFieldDefinition,
  value: CustomFieldValue,
): string | null {
  if (value === null || value === undefined) {
    return def.required ? "Required field is missing." : null;
  }
  switch (def.type) {
    case "text":
    case "textarea": {
      if (typeof value !== "string") return "Expected a string.";
      const max = def.maxLength ?? (def.type === "text" ? 255 : 5000);
      if (value.length > max) return `Too long (max ${max} characters).`;
      return null;
    }
    case "integer":
    case "number_poisha": {
      if (typeof value !== "number" || !Number.isInteger(value)) {
        return def.type === "number_poisha"
          ? "Money must be an integer number of poisha."
          : "Expected an integer.";
      }
      if (def.min !== undefined && value < def.min) return `Below minimum ${def.min}.`;
      if (def.max !== undefined && value > def.max) return `Above maximum ${def.max}.`;
      return null;
    }
    case "boolean":
      return typeof value === "boolean" ? null : "Expected true or false.";
    case "date": {
      if (typeof value !== "string") return "Expected an ISO date string.";
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? "Invalid date." : null;
    }
    case "select": {
      if (typeof value !== "string") return "Expected a single option.";
      return (def.options ?? []).includes(value) ? null : "Value is not one of the allowed options.";
    }
    case "multiselect": {
      if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
        return "Expected a list of options.";
      }
      const options = def.options ?? [];
      return value.every((v) => options.includes(v))
        ? null
        : "One or more values are not allowed options.";
    }
  }
}

export function validateCustomFieldValues(
  definitions: CustomFieldDefinition[],
  values: Record<string, CustomFieldValue>,
): CustomFieldValidation {
  const errors: Array<{ key: string; message: string }> = [];
  const byKey = new Map(definitions.map((d) => [d.key, d]));

  for (const key of Object.keys(values)) {
    if (!byKey.has(key)) errors.push({ key, message: "Unknown custom field." });
  }
  for (const def of definitions) {
    const message = validateOne(def, values[def.key] ?? null);
    if (message) errors.push({ key: def.key, message });
  }
  if (errors.length > 0) return { ok: false, errors };

  const clean: Record<string, CustomFieldValue> = {};
  for (const def of definitions) {
    const value = values[def.key];
    if (value !== undefined && value !== null) clean[def.key] = value;
  }
  return { ok: true, values: clean };
}

/**
 * Build a Zod schema for a definition list — for routes that prefer Zod
 * error shapes. Money fields become z.number().int(); floats fail.
 */
export function buildCustomFieldZodSchema(
  definitions: CustomFieldDefinition[],
): z.ZodType<Record<string, CustomFieldValue>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const def of definitions) {
    let field: z.ZodType<CustomFieldValue>;
    switch (def.type) {
      case "text":
      case "textarea":
        field = z.string().max(def.maxLength ?? 5000) as z.ZodType<CustomFieldValue>;
        break;
      case "integer":
      case "number_poisha": {
        let num = z.number().int();
        if (def.min !== undefined) num = num.min(def.min);
        if (def.max !== undefined) num = num.max(def.max);
        field = num as z.ZodType<CustomFieldValue>;
        break;
      }
      case "boolean":
        field = z.boolean() as z.ZodType<CustomFieldValue>;
        break;
      case "date":
        field = z.string().datetime() as z.ZodType<CustomFieldValue>;
        break;
      case "select":
        field = z.enum((def.options ?? []) as [string, ...string[]]) as z.ZodType<CustomFieldValue>;
        break;
      case "multiselect":
        field = z.array(z.enum((def.options ?? []) as [string, ...string[]])) as z.ZodType<CustomFieldValue>;
        break;
    }
    shape[def.key] = def.required ? field : field.nullable().optional();
  }
  return z.object(shape).strict() as z.ZodType<Record<string, CustomFieldValue>>;
}

/** Public (storefront-safe) definitions: adminOnly fields are stripped. */
export function publicFieldDefinitions(
  definitions: CustomFieldDefinition[],
): CustomFieldDefinition[] {
  return definitions.filter((d) => !d.adminOnly).sort((a, b) => a.sortOrder - b.sortOrder);
}
