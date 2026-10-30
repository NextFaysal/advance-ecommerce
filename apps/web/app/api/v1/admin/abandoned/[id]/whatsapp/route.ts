/**
 * Generate a WhatsApp 1-Click Recovery Link for an abandoned checkout —
 * POST /api/v1/admin/abandoned/[id]/whatsapp (Pillar 4 / Master Plan).
 *
 * Generates a wa.me URL with a prefilled, personalized Bengali recovery template
 * including customer name, cart item summary, and special recovery offer.
 * Audits the access to the customer's phone for security compliance.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "@advance-ecommerce/db";
import { validateSessionToken } from "@/lib/auth";
import { requirePermission, RbacError, type PermissionKey } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import { formatBdt } from "@/checkout/pricing";

function err(code: string, message: string, status: number, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

async function requireAdmin(permission: PermissionKey) {
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

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin("orders.view");
  if ("error" in auth) return auth.error;

  try {
    const row = await prisma.abandonedCheckout.findUnique({
      where: { id: params.id },
    });

    if (!row) {
      return err("NOT_FOUND", "এই ড্রপ-অফ চেকআউট রেকর্ডটি পাওয়া যায়নি।", 404);
    }

    if (row.status !== "OPEN") {
      return err("NOT_OPEN", `এই চেকআউটটির স্ট্যাটাস বর্তমানে ${row.status}।`, 409);
    }

    const digits = row.customerPhone.replace(/\D/g, "");
    const name = row.customerName || "সম্মানিত গ্রাহক";
    const bill = formatBdt(row.subtotalPoisha);

    // Prefilled Bangla Recovery Message
    const text = `আসসালামু আলাইকুম ${name}! আপনার কার্টে রাখা পণ্যগুলোর অর্ডার (${bill}) সম্পন্ন করার অপেক্ষায় আছে। এখনই অর্ডারটি কনফার্ম করতে এবং স্পেশাল ফ্রি ডেলিভারি পেতে আমাদের জানান। আমরা কি আপনার অর্ডারটি পাঠিয়ে দেব?`;

    const waUrl = `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;

    await writeAudit({
      actorId: auth.session.user.id,
      action: "abandoned.whatsapp_recovery",
      entityType: "AbandonedCheckout",
      entityId: params.id,
      afterJson: { waUrlGenerated: true },
      ip: req.headers.get("x-forwarded-for") ?? undefined,
      userAgent: req.headers.get("user-agent") ?? undefined,
    }).catch(() => null);

    return NextResponse.json({
      data: {
        ok: true,
        waUrl,
        customerName: name,
        subtotalText: bill,
      },
    });
  } catch (e: unknown) {
    return err("INTERNAL_ERROR", e instanceof Error ? e.message : "WhatsApp রিকভারি লিংক তৈরি করা যায়নি", 500);
  }
}
