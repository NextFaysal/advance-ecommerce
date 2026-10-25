/**
 * Attribute-set admin — the ProductAttribute library (Wave 13-2,
 * doc 16 §P2 remainder).
 *
 * The ProductAttribute table (id / key @unique / labelBn / labelEn /
 * values String[]) existed since the catalog schema landed but was
 * ORPHANED — nothing read or wrote it; the product editor parses
 * free-text "key: v1, v2" lines per product instead. This module is
 * the data layer for the new /admin/attributes page and the
 * /api/v1/admin/attributes routes: a managed LIBRARY of reusable
 * attribute sets (e.g. key "size" → S/M/L/XL). Wiring the library
 * into the product editor is a later wave — this module manages the
 * sets only, and the admin page says so.
 *
 * Like taxonomy-admin.ts it talks to Prisma directly (service.ts is
 * the catalog service's own module) and reuses the products
 * permission family at the route layer.
 *
 * Keys: normalized to a slug-like token (trim → lowercase →
 * whitespace runs become "-") and validated, so a set key always
 * matches the key a merchant would type in the editor's attribute
 * lines ("Size" in a line, "size" in the library — same set).
 *
 * Delete semantics: ProductAttribute has NO deletedAt column, and
 * products never reference a set by FK — variant attributes are free
 * JSON keyed by the attribute key string, captured at product-save
 * time. Deleting a set is therefore a HARD delete that cannot break
 * existing products; it only removes the library entry.
 */
import { prisma } from "@advance-ecommerce/db";
import { z } from "zod";

export class AttributeError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "AttributeError";
  }
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "P2002";
}

/** P2002 backstop → the same 409 shape the pre-checks produce. */
export function rethrowAttribute(e: unknown): never {
  if (e instanceof AttributeError) throw e;
  if (isUniqueViolation(e)) {
    throw new AttributeError("KEY_TAKEN", "Attribute key already in use.", 409);
  }
  throw e;
}

/* ------------------------------------------------------------------ */
/* Schemas                                                             */
/* ------------------------------------------------------------------ */

const attributeValuesSchema = z
  .array(z.string().trim().min(1, "Values cannot be empty strings.").max(80))
  .min(1, "At least one value is required.")
  .max(50, "At most 50 values per attribute set.");

export const attributeCreateSchema = z.object({
  key: z.string().trim().min(1, "Key is required.").max(80),
  labelBn: z.string().trim().min(1, "Bangla label is required.").max(120),
  labelEn: z.string().trim().min(1, "English label is required.").max(120),
  values: attributeValuesSchema,
});
export type AttributeCreateInput = z.infer<typeof attributeCreateSchema>;

export const attributeUpdateSchema = attributeCreateSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  { message: "Nothing to update." },
);
export type AttributeUpdateInput = z.infer<typeof attributeUpdateSchema>;

/* ------------------------------------------------------------------ */
/* Shape                                                               */
/* ------------------------------------------------------------------ */

export interface AdminAttributeSet {
  id: string;
  key: string;
  labelBn: string;
  labelEn: string;
  values: string[];
  createdAt: string;
  updatedAt: string;
}

function mapAttributeSet(row: {
  id: string;
  key: string;
  labelBn: string;
  labelEn: string;
  values: string[];
  createdAt: Date;
  updatedAt: Date;
}): AdminAttributeSet {
  return {
    id: row.id,
    key: row.key,
    labelBn: row.labelBn,
    labelEn: row.labelEn,
    values: row.values,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Normalization                                                       */
/* ------------------------------------------------------------------ */

const KEY_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

export function normalizeAttributeKey(raw: string): string {
  const key = raw.trim().toLowerCase().replace(/\s+/g, "-");
  if (!KEY_PATTERN.test(key)) {
    throw new AttributeError(
      "INVALID_KEY",
      "Key must be lowercase letters, digits, hyphens or underscores (e.g. size, color, shoe-size).",
      400,
    );
  }
  return key;
}

/** Trim, drop empties, dedupe preserving first-seen order. */
export function normalizeAttributeValues(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const v = value.trim();
    if (v === "" || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  if (out.length === 0) {
    throw new AttributeError("INVALID_VALUES", "At least one non-empty value is required.", 400);
  }
  return out;
}

async function assertKeyFree(key: string, excludeId?: string): Promise<void> {
  const existing = await prisma.productAttribute.findUnique({ where: { key }, select: { id: true } });
  if (existing && existing.id !== excludeId) {
    throw new AttributeError("KEY_TAKEN", `Attribute key already in use: ${key}`, 409);
  }
}

/* ------------------------------------------------------------------ */
/* CRUD                                                                */
/* ------------------------------------------------------------------ */

export async function listAttributeSetsAdmin(): Promise<AdminAttributeSet[]> {
  const rows = await prisma.productAttribute.findMany({
    orderBy: [{ labelEn: "asc" }, { key: "asc" }],
  });
  return rows.map(mapAttributeSet);
}

export async function getAttributeSetAdmin(id: string): Promise<AdminAttributeSet | null> {
  const row = await prisma.productAttribute.findUnique({ where: { id } });
  return row ? mapAttributeSet(row) : null;
}

export async function createAttributeSetAdmin(input: AttributeCreateInput): Promise<AdminAttributeSet> {
  const key = normalizeAttributeKey(input.key);
  await assertKeyFree(key);
  try {
    const row = await prisma.productAttribute.create({
      data: {
        key,
        labelBn: input.labelBn,
        labelEn: input.labelEn,
        values: normalizeAttributeValues(input.values),
      },
    });
    return mapAttributeSet(row);
  } catch (e) {
    rethrowAttribute(e);
  }
}

export async function updateAttributeSetAdmin(
  id: string,
  input: AttributeUpdateInput,
): Promise<AdminAttributeSet> {
  const existing = await prisma.productAttribute.findUnique({ where: { id } });
  if (!existing) throw new AttributeError("NOT_FOUND", "Attribute set not found.", 404);
  const data: { key?: string; labelBn?: string; labelEn?: string; values?: string[] } = {};
  if (input.key !== undefined) {
    const key = normalizeAttributeKey(input.key);
    if (key !== existing.key) await assertKeyFree(key, id);
    data.key = key;
  }
  if (input.labelBn !== undefined) data.labelBn = input.labelBn;
  if (input.labelEn !== undefined) data.labelEn = input.labelEn;
  if (input.values !== undefined) data.values = normalizeAttributeValues(input.values);
  try {
    const row = await prisma.productAttribute.update({ where: { id }, data });
    return mapAttributeSet(row);
  } catch (e) {
    rethrowAttribute(e);
  }
}

export async function deleteAttributeSetAdmin(id: string): Promise<{ id: string; deleted: true }> {
  const existing = await prisma.productAttribute.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new AttributeError("NOT_FOUND", "Attribute set not found.", 404);
  // Hard delete — the model has no deletedAt, and no product rows
  // reference a set (variant attributes are self-contained JSON), so
  // nothing else needs cleanup.
  await prisma.productAttribute.delete({ where: { id } });
  return { id, deleted: true };
}
