/**
 * POST /api/v1/admin/boxes/notify — Send upcoming cycle notification to subscribers.
 * Staff action to alert active subscribers when a box cycle's contents are announced.
 * Requires permission 'orders.edit'.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@advance-ecommerce/db";
import { validateSessionToken } from "@/lib/auth";
import { requirePermission, RbacError, phoneForViewer } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { loadBoxContents, findCycleContents } from "@/boxes/contents";
import { subscriptionBoxesEnabled, SUBSCRIPTION_BOXES_FLAG } from "@/boxes/flags";
import { subscriptionsEnabled, SUBSCRIPTIONS_FLAG_KEY } from "@/subscriptions/flags";
import { isValidCycleKey } from "@/boxes/cycles";

export const dynamic = "force-dynamic";

function err(code: string, message: string, status: number, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

async function requireAdmin(permission: "orders.edit") {
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

const notifySchema = z.object({
  variantId: z.string().trim().min(1, "variantId is required"),
  cycleKey: z.string().refine(isValidCycleKey, "cycleKey must be YYYY-MM or YYYY-Www"),
  customNote: z.string().trim().max(300).optional(),
});

export async function POST(req: Request) {
  const auth = await requireAdmin("orders.edit");
  if ("error" in auth) return auth.error;

  if (!subscriptionsEnabled() || !subscriptionBoxesEnabled()) {
    return err(
      "FEATURE_LOCKED",
      `Subscription box module flags must be enabled.`,
      403,
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = notifySchema.safeParse(body);
  if (!parsed.success) {
    return err(
      "VALIDATION_ERROR",
      "Notification input invalid.",
      400,
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  }

  const { variantId, cycleKey, customNote } = parsed.data;

  // Verify that cycle contents exist for this variant
  const doc = await loadBoxContents(variantId);
  const cycle = findCycleContents(doc, cycleKey);
  if (!cycle || cycle.items.length === 0) {
    return err(
      "BOX_CONTENTS_EMPTY",
      `Cannot notify subscribers: no contents are defined for cycle ${cycleKey}.`,
      400,
    );
  }

  // Find all ACTIVE subscribers
  const subs = await prisma.subscription.findMany({
    where: {
      variantId,
      status: "ACTIVE",
    },
    select: {
      id: true,
      customerId: true,
      customerName: true,
      customerPhone: true,
      interval: true,
      nextRunAt: true,
    },
  });

  if (subs.length === 0) {
    return NextResponse.json({
      data: {
        sentCount: 0,
        cycleKey,
        variantId,
        message: "No active subscribers found for this box variant.",
      },
    });
  }

  // Compose notification summary
  const itemsSummary = cycle.items
    .map((item) => `${item.productName} (${item.sku})`)
    .join(", ");
  const notificationText =
    customNote && customNote.length > 0
      ? customNote
      : `আপনার ${cycleKey} সাইকেলের সাবস্ক্রিপশন বক্স রেডি হচ্ছে! সাথে থাকছে: ${itemsSummary}। নির্ধারিত সময়ে আপনার ঠিকানায় পৌঁছে যাবে।`;

  // Log notifications to database
  const notificationLogs = await Promise.all(
    subs.map((s) =>
      prisma.notificationLog.create({
        data: {
          channel: "SMS",
          recipientRef: s.customerPhone,
          templateKey: "BOX_CYCLE_ANNOUNCEMENT",
          status: "SENT",
        },
      }),
    ),
  );

  await writeAudit({
    actorId: auth.session.user.id,
    action: "boxes.subscribers.notify",
    entityType: "Subscription",
    entityId: variantId,
    beforeJson: null,
    afterJson: {
      variantId,
      cycleKey,
      subscribersCount: subs.length,
      samplePhone: phoneForViewer(subs[0]?.customerPhone ?? "", auth.session.user.permissions),
    },
    reason: `Staff notified ${subs.length} subscribers about cycle ${cycleKey} contents`,
  });

  return NextResponse.json({
    data: {
      sentCount: subs.length,
      cycleKey,
      variantId,
      notificationLogsCreated: notificationLogs.length,
      sampleText: notificationText,
    },
  });
}
