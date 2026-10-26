/**
 * Admin subscription-box cycle contents API —
 * /api/v1/admin/boxes/contents (ADV-23 vertical 4, wave 56).
 *
 *   GET (no query)        -> the configured box variants with
 *                            display names + the cycle keys that
 *                            already have contents (editor picker).
 *   GET ?variantId=<id>   -> that box's contents document
 *                            (doc: null when none saved yet).
 *   PUT { variantId, cycles: [{ cycleKey, noteBn?, noteEn?,
 *          items: [{ variantId, quantity }] }], reason }
 *       -> whole-document replace for ONE box variant. The client
 *          sends variant ids + quantities ONLY; the server
 *          resolves each item against the real catalog and
 *          SNAPSHOTS product name / SKU / variant label into the
 *          stored doc, so a later rename or delete never rewrites
 *          what a cycle contained.
 *
 * Guards: settings.view for reads, settings.edit + mandatory
 * `reason` for the write, audited (boxes.contents.update) with
 * before/after documents — the sibling config-route discipline.
 * Contents can only be saved for a variant listed in
 * boxes.config.boxVariantIds (400 NOT_A_BOX_VARIANT otherwise):
 * a contents doc for an unlisted variant would never be read by
 * the generator, and saving one must not pretend otherwise.
 * Like the config route, no module flag is required here — the
 * merchant prepares contents before enabling the module.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { validateSessionToken } from "@/lib/auth";
import { requirePermission, RbacError } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { isValidQtyNumber } from "@/lib/quantity";
import { isBoxVariantId, loadBoxesConfig } from "@/boxes/config";
import {
  boxContentsKey,
  loadBoxContents,
  saveBoxContents,
  type BoxContentsDoc,
  type BoxCycleContents,
} from "@/boxes/contents";
import { isValidCycleKey } from "@/boxes/cycles";
import { listBoxVariantSummaries, snapshotContentItems } from "@/boxes/service";

export const dynamic = "force-dynamic";

function err(code: string, message: string, status: number, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

async function requireAdmin(permission: "settings.view" | "settings.edit") {
  const token = cookies().get("admin_session")?.value;
  if (!token) return { error: err("UNAUTHENTICATED", "Admin login required.", 401) };
  try {
    const session = await validateSessionToken(token);
    if (!session) return { error: err("UNAUTHENTICATED", "Session expired or revoked.", 401) };
    requirePermission(session.user.permissions, permission);
    return { session };
  } catch (e) {
    if (e instanceof RbacError) return { error: err("FORBIDDEN", e.message, 403) };
    return { error: err("DB_NOT_READY", "Session check needs a working database.", 503) };
  }
}

export async function GET(req: Request) {
  const auth = await requireAdmin("settings.view");
  if ("error" in auth) return auth.error;

  const variantId = new URL(req.url).searchParams.get("variantId");
  if (variantId === null) {
    const boxes = await listBoxVariantSummaries();
    return NextResponse.json({ data: { boxes }, meta: { persistence: "setting-doc" } });
  }

  const loaded = await loadBoxesConfig();
  if (!isBoxVariantId(loaded.config, variantId)) {
    return err(
      "NOT_A_BOX_VARIANT",
      "This variant is not listed as a subscription box in boxes.config.",
      400,
    );
  }
  const doc = await loadBoxContents(variantId);
  return NextResponse.json({
    data: {
      docKey: boxContentsKey(variantId),
      variantId,
      doc,
      source: doc !== null ? "saved" : "default",
    },
    meta: { persistence: "setting-doc" },
  });
}

const putSchema = z.object({
  variantId: z.string().trim().min(1),
  cycles: z
    .array(
      z.object({
        cycleKey: z.string().refine(isValidCycleKey, "cycleKey must be YYYY-MM or YYYY-Www"),
        noteBn: z.string().trim().max(300).optional(),
        noteEn: z.string().trim().max(300).optional(),
        items: z
          .array(
            z.object({
              variantId: z.string().trim().min(1),
              quantity: z
                .number()
                .refine(
                  (v) => isValidQtyNumber(v) && v <= 999,
                  "Quantity must be positive (max 999, up to 3 decimals)",
                ),
            }),
          )
          .max(50),
      }),
    )
    .max(60),
  reason: z.string().trim().min(1, "Reason is required."),
});

export async function PUT(req: Request) {
  const auth = await requireAdmin("settings.edit");
  if ("error" in auth) return auth.error;

  const body = await req.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return err(
      "VALIDATION_ERROR",
      "Box contents input invalid.",
      400,
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  }
  const { variantId, cycles, reason } = parsed.data;

  const keys = cycles.map((c) => c.cycleKey);
  if (new Set(keys).size !== keys.length) {
    return err("VALIDATION_ERROR", "Duplicate cycleKey in one document.", 400, [
      "cycles: each cycleKey may appear once",
    ]);
  }

  const loaded = await loadBoxesConfig();
  if (!isBoxVariantId(loaded.config, variantId)) {
    return err(
      "NOT_A_BOX_VARIANT",
      "Contents can only be saved for a variant listed as a subscription box in boxes.config.",
      400,
    );
  }

  // Snapshot every item against the real catalog before saving.
  const resolvedCycles: BoxCycleContents[] = [];
  for (const cycle of cycles) {
    const snapped = await snapshotContentItems(cycle.items);
    if (!snapped.ok) {
      return err(
        "VARIANT_NOT_FOUND",
        `Content variant not found (or deleted): ${snapped.missingVariantId}`,
        400,
        [`cycle ${cycle.cycleKey}: variantId ${snapped.missingVariantId}`],
      );
    }
    resolvedCycles.push({
      cycleKey: cycle.cycleKey,
      ...(cycle.noteBn ? { noteBn: cycle.noteBn } : {}),
      ...(cycle.noteEn ? { noteEn: cycle.noteEn } : {}),
      items: snapped.items,
    });
  }

  const before = await loadBoxContents(variantId);
  const doc: BoxContentsDoc = { variantId, cycles: resolvedCycles };
  try {
    await saveBoxContents(doc, auth.session.user.id);
  } catch {
    return err("DB_NOT_READY", "Box contents could not be saved (database error).", 503);
  }
  const after = await loadBoxContents(variantId);
  await writeAudit({
    actorId: auth.session.user.id,
    action: "boxes.contents.update",
    entityType: "Setting",
    entityId: boxContentsKey(variantId),
    beforeJson: before as unknown as Record<string, unknown> | null,
    afterJson: after as unknown as Record<string, unknown> | null,
    reason,
  });

  return NextResponse.json({
    data: { docKey: boxContentsKey(variantId), variantId, doc: after },
    meta: { persistence: "setting-doc" },
  });
}
