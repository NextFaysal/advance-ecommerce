/**
 * Custom order workflow stages — ADV-26 remainder, BUILD-LITE
 * (assessment: ~/workspace/.push-tmp/adv26-assessment.md §1).
 *
 * WHAT THIS IS: merchant-defined workflow LABELS ("quality check",
 * "waiting for courier pickup confirmation") that sit AT one canonical
 * order status. A stage is a sub-step display + handling concept only.
 *
 * WHAT THIS IS NOT: custom order statuses. The canonical OrderStatus
 * enum, `Order.status`, the state machine, every money/stock/ERP/
 * courier gate keyed on canonical statuses — none of them know stages
 * exist. A stage can never gate a transition, move stock, or post
 * money; it is set/cleared by a separate admin action and rendered as
 * a chip next to the canonical status badge.
 *
 * STORAGE — two established mechanisms, no schema change:
 *  1. Definitions: ONE Setting document, key `orders.workflow_stages`,
 *     holding { stages: WorkflowStage[] }, written through the
 *     doc-store pattern (direct prisma.setting.upsert +
 *     invalidateSettingCache — the generic setSetting() rejects keys
 *     outside SETTING_DEFAULTS; the restaurant.config /
 *     custom_fields.* precedent).
 *  2. Per-order assignment: a namespaced OrderTag, `stage:<stageId>`
 *     — the pharmacy queue's `rx:pending` precedent (real table,
 *     @@index([tag]) so stage filtering is a SQL condition, one row
 *     per order enforced by this module's write path: delete the
 *     order's `stage:` tags, then insert at most one). Chosen over
 *     OrderNote `[marker]` text because note text is not queryable
 *     for list filtering, and over a dedicated column because the
 *     stage layer must not touch the Order schema. Assignment is
 *     auditable through the route-level writeAudit on every set/
 *     clear (orders.workflow_stage.set), exactly like tag edits via
 *     orders.management.
 *
 * ANCHOR RULE: a stage may only be set on an order whose CURRENT
 * canonical status equals the stage's anchorStatus (else 400
 * STAGE_ANCHOR_MISMATCH). When a canonical transition commits (either
 * funnel — applyOrderTransition or saveOrder), the stage auto-clears
 * if its anchor no longer matches the new status
 * (reconcileOrderStageAfterTransition, never throws, dynamic-import
 * discipline identical to the vertical cancel hooks).
 *
 * FLAG: `module.workflow_stages` (default OFF — the parent registers
 * it in seed.ts + feature-flags.ts). Flag OFF = the whole layer is
 * inert: assignment/display/reconcile no-op; the config document can
 * still be prepared (the vertical config-prep precedent — the config
 * routes deliberately do not flag-gate).
 *
 * FAIL-SOFT READS (the config-store contract): a missing/corrupt doc
 * or a DB error resolves to the empty default — a broken stage config
 * must never take the orders list or checkout down.
 */
import { z } from "zod";
import { prisma } from "@advance-ecommerce/db";
import { getSetting, invalidateSettingCache } from "@/lib/settings";
import { isFeatureEnabled } from "@/lib/feature-flags";
import type { OrderStatus } from "./types";

export const WORKFLOW_STAGES_FLAG = "module.workflow_stages";
export const WORKFLOW_STAGES_DOC_KEY = "orders.workflow_stages";

/** Namespace prefix on OrderTag values owned by this module. The
 *  generic tag editor (src/orders/management.ts) hides these from
 *  staff and preserves them across tag saves — stage state is only
 *  ever written through setOrderStage(). */
export const STAGE_TAG_PREFIX = "stage:";

export function isWorkflowStagesEnabled(): boolean {
  return isFeatureEnabled(WORKFLOW_STAGES_FLAG);
}

/* ------------------------------------------------------------------ */
/* Definitions                                                         */
/* ------------------------------------------------------------------ */

/** Chip tones — deliberately the shared Badge/StatusTone vocabulary
 *  (src/orders/components/labels.ts), NOT free hex: status is never
 *  colour-only in this codebase, and a stage chip must read in the
 *  same language as the canonical badge beside it. */
export const WORKFLOW_STAGE_TONES = [
  "brand",
  "success",
  "warning",
  "danger",
  "info",
  "neutral",
] as const;
export type WorkflowStageTone = (typeof WORKFLOW_STAGE_TONES)[number];

/** The canonical status set, restated for validation (the [id] route's
 *  patchSchema does the same for transitions). types.ts is the
 *  authority; this list must match it exactly. */
const CANONICAL_ORDER_STATUSES: [
  "PENDING",
  "CONFIRMED",
  "PROCESSING",
  "PACKED",
  "SHIPPED",
  "DELIVERED",
  "FAILED",
  "RETURN_REQUESTED",
  "RETURNING",
  "RETURNED",
  "CANCELLED",
  "REFUNDED",
  "EXCHANGED",
] = [
  "PENDING",
  "CONFIRMED",
  "PROCESSING",
  "PACKED",
  "SHIPPED",
  "DELIVERED",
  "FAILED",
  "RETURN_REQUESTED",
  "RETURNING",
  "RETURNED",
  "CANCELLED",
  "REFUNDED",
  "EXCHANGED",
];

export const MAX_WORKFLOW_STAGES = 20;

export const workflowStageSchema = z.object({
  /** Slug: the value frozen into the order's `stage:<id>` tag, so it
   *  is locked once orders carry it (renaming a label is free; the
   *  settings UI locks ids of saved stages for the same reason the
   *  pickup-points editor locks its ids). */
  id: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Stage id must be a lowercase slug (a-z, 0-9, single hyphens)."),
  labelBn: z.string().trim().min(1).max(60),
  labelEn: z.string().trim().min(1).max(60),
  anchorStatus: z.enum(CANONICAL_ORDER_STATUSES),
  color: z.enum(WORKFLOW_STAGE_TONES).optional(),
  sortOrder: z.number().int().min(0).max(999).default(0),
});

export type WorkflowStage = z.infer<typeof workflowStageSchema>;

/** Stage ids are unique within the document — one id, one meaning
 *  (an id is frozen into order tags; two stages sharing it would be
 *  indistinguishable on every order carrying either). */
function refineUniqueStageIds(doc: { stages: WorkflowStage[] }, ctx: z.RefinementCtx): void {
  const seen = new Set<string>();
  doc.stages.forEach((stage, i) => {
    if (seen.has(stage.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stages", i, "id"],
        message: `Duplicate stage id: ${stage.id}`,
      });
    }
    seen.add(stage.id);
  });
}

export const workflowStagesConfigSchema = z
  .object({
    stages: z.array(workflowStageSchema).max(MAX_WORKFLOW_STAGES).default([]),
  })
  .superRefine(refineUniqueStageIds);

export type WorkflowStagesConfig = z.infer<typeof workflowStagesConfigSchema>;

/** The config PUT body ({ stages, reason }) — a sibling schema rather
 *  than `.extend()` on the refined config schema (ZodEffects has no
 *  extend); both share the stage schema + the uniqueness refine, so
 *  the route and the store can never validate differently. */
export const workflowStagesPutBodySchema = z
  .object({
    stages: z.array(workflowStageSchema).max(MAX_WORKFLOW_STAGES),
    reason: z.string().trim().min(1, "Reason is required."),
  })
  .superRefine(refineUniqueStageIds);

export const DEFAULT_WORKFLOW_STAGES_CONFIG: WorkflowStagesConfig = { stages: [] };

export interface LoadedWorkflowStagesConfig {
  /** The stored (or default) document, stages sorted for display. */
  config: WorkflowStagesConfig;
  /** "saved" = merchant doc; "default" = code defaults (no doc, or doc failed validation). */
  source: "saved" | "default";
}

function sortedStages(stages: WorkflowStage[]): WorkflowStage[] {
  return [...stages].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}

function toLoaded(config: WorkflowStagesConfig, source: "saved" | "default"): LoadedWorkflowStagesConfig {
  return { config: { stages: sortedStages(config.stages) }, source };
}

/** The stored config with defaults fallback — never throws. */
export async function loadWorkflowStagesConfig(): Promise<LoadedWorkflowStagesConfig> {
  let raw: string | null = null;
  try {
    raw = await getSetting(WORKFLOW_STAGES_DOC_KEY);
  } catch {
    raw = null;
  }
  if (raw) {
    try {
      const parsed = workflowStagesConfigSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return toLoaded(parsed.data, "saved");
    } catch {
      // Corrupt JSON — fall through to defaults (documented above).
    }
  }
  return toLoaded(DEFAULT_WORKFLOW_STAGES_CONFIG, "default");
}

/** Persist a validated config (the admin route validates first).
 *  Throws on DB failure — the route reports 503 rather than
 *  claiming a save that did not happen. */
export async function saveWorkflowStagesConfig(config: WorkflowStagesConfig, actorId: string): Promise<void> {
  const value = JSON.stringify({ stages: sortedStages(config.stages) });
  await prisma.setting.upsert({
    where: { key: WORKFLOW_STAGES_DOC_KEY },
    create: {
      key: WORKFLOW_STAGES_DOC_KEY,
      value,
      valueEncrypted: false,
      isPublic: false,
      category: "general",
      description: "Custom order workflow stages document (JSON, ADV-26)",
      updatedById: actorId,
    },
    update: { value, valueEncrypted: false, updatedById: actorId },
  });
  invalidateSettingCache(WORKFLOW_STAGES_DOC_KEY);
}

/* ------------------------------------------------------------------ */
/* Per-order assignment (namespaced OrderTag)                          */
/* ------------------------------------------------------------------ */

export function stageTagValue(stageId: string): string {
  return `${STAGE_TAG_PREFIX}${stageId}`;
}

/** The stage id carried by a tag value, or null when the tag is not
 *  a stage tag. */
export function parseStageTag(tag: string): string | null {
  if (!tag.startsWith(STAGE_TAG_PREFIX)) return null;
  const id = tag.slice(STAGE_TAG_PREFIX.length);
  return id === "" ? null : id;
}

/** The order's current stage id from its tags — pure helper for
 *  surfaces that already hold the tag list (list rows carry tags). */
export function stageIdFromTags(tags: readonly string[]): string | null {
  for (const tag of tags) {
    const id = parseStageTag(tag);
    if (id) return id;
  }
  return null;
}

async function findStageTagRow(orderId: string): Promise<{ id: string; tag: string } | null> {
  const row = await prisma.orderTag.findFirst({
    where: { orderId, tag: { startsWith: STAGE_TAG_PREFIX } },
    select: { id: true, tag: true },
  });
  return row;
}

/** Serializable per-order stage projection for admin + tracking
 *  surfaces. `anchorStatus` is null when the stage definition was
 *  removed from the config after assignment — the labels then fall
 *  back to the stage id itself (honest degradation, never a guess). */
export interface OrderWorkflowStageView {
  stageId: string;
  labelBn: string;
  labelEn: string;
  tone: WorkflowStageTone;
  anchorStatus: OrderStatus | null;
}

function toStageView(stageId: string, def: WorkflowStage | undefined): OrderWorkflowStageView {
  return {
    stageId,
    labelBn: def?.labelBn ?? stageId,
    labelEn: def?.labelEn ?? stageId,
    tone: def?.color ?? "neutral",
    anchorStatus: def ? (def.anchorStatus as OrderStatus) : null,
  };
}

/** The order's stage view, or null when the flag is OFF, the order
 *  carries no stage, or anything fails (fail-soft: display only). */
export async function getOrderWorkflowStageView(orderId: string): Promise<OrderWorkflowStageView | null> {
  if (!isWorkflowStagesEnabled()) return null;
  try {
    const row = await findStageTagRow(orderId);
    if (!row) return null;
    const stageId = parseStageTag(row.tag);
    if (!stageId) return null;
    const { config } = await loadWorkflowStagesConfig();
    return toStageView(stageId, config.stages.find((s) => s.id === stageId));
  } catch {
    return null;
  }
}

export type SetOrderStageResult =
  | { ok: true; before: string | null; after: string | null; orderStatus: OrderStatus }
  | { ok: false; code: "ORDER_NOT_FOUND" | "STAGE_NOT_FOUND" | "STAGE_ANCHOR_MISMATCH"; error: string };

/**
 * Set (or clear, with stageId null) an order's workflow stage.
 * The write is one transaction: every `stage:` tag on the order is
 * removed, then at most one is inserted — one-per-order is enforced
 * here, not by a schema constraint (the tag table is shared).
 * The anchor rule is checked against the order's CURRENT canonical
 * status; `Order.status` itself is never written by this function.
 */
export async function setOrderStage(orderId: string, stageId: string | null): Promise<SetOrderStageResult> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, deletedAt: null },
    select: { id: true, status: true },
  });
  if (!order) {
    return { ok: false, code: "ORDER_NOT_FOUND", error: "অর্ডার পাওয়া যায়নি / Order not found." };
  }
  const currentStatus = order.status as OrderStatus;

  let def: WorkflowStage | undefined;
  if (stageId !== null) {
    const { config } = await loadWorkflowStagesConfig();
    def = config.stages.find((s) => s.id === stageId);
    if (!def) {
      return {
        ok: false,
        code: "STAGE_NOT_FOUND",
        error: "এই ওয়ার্কফ্লো ধাপটি সেটিংসে নেই / This workflow stage is not defined in settings.",
      };
    }
    if (def.anchorStatus !== currentStatus) {
      return {
        ok: false,
        code: "STAGE_ANCHOR_MISMATCH",
        error:
          `এই ধাপটি শুধু ${def.anchorStatus} স্ট্যাটাসের অর্ডারে বসানো যায় — অর্ডারটি এখন ${currentStatus} / ` +
          `This stage is anchored to ${def.anchorStatus}; the order is currently ${currentStatus}.`,
      };
    }
  }

  const beforeRow = await findStageTagRow(order.id);
  const before = beforeRow ? parseStageTag(beforeRow.tag) : null;
  if (before === stageId) {
    return { ok: true, before, after: stageId, orderStatus: currentStatus };
  }
  await prisma.$transaction(async (tx) => {
    await tx.orderTag.deleteMany({
      where: { orderId: order.id, tag: { startsWith: STAGE_TAG_PREFIX } },
    });
    if (stageId !== null) {
      await tx.orderTag.create({ data: { orderId: order.id, tag: stageTagValue(stageId) } });
    }
  });
  return { ok: true, before, after: stageId, orderStatus: currentStatus };
}

/**
 * Post-transition reconcile — called by BOTH status funnels
 * (applyOrderTransition and saveOrder) after a canonical transition
 * commits, with the same dynamic-import / never-throws discipline as
 * the vertical cancel hooks beside them. If the order's stage anchor
 * no longer matches the new status (or the stage definition is gone),
 * the stage tag is removed: a stage is a label for a moment in the
 * canonical flow, and a stale label would lie. Flag OFF = no-op (the
 * layer is inert; a stage set before the flag was turned off simply
 * waits, invisible, and re-validates here when the flag returns).
 */
export async function reconcileOrderStageAfterTransition(orderId: string, newStatus: OrderStatus): Promise<void> {
  try {
    if (!isWorkflowStagesEnabled()) return;
    const row = await findStageTagRow(orderId);
    if (!row) return;
    const stageId = parseStageTag(row.tag);
    const { config } = await loadWorkflowStagesConfig();
    const def = stageId ? config.stages.find((s) => s.id === stageId) : undefined;
    if (!def || def.anchorStatus !== newStatus) {
      await prisma.orderTag.delete({ where: { id: row.id } });
    }
  } catch {
    // Never throws by contract — a reconcile failure must not fail
    // or appear to fail a transition that already committed.
  }
}

/** Prisma where-fragment for "orders currently at this stage" —
 *  shared by the list rows query and the list-v2 counts so the two
 *  can never disagree about what the stage filter matches. */
export function stageTagWhere(stageId: string): { tags: { some: { tag: string } } } {
  return { tags: { some: { tag: stageTagValue(stageId) } } };
}
