/**
 * POST /api/v1/admin/pharmacy/rx-queue/[orderId] — the pharmacist's
 * decision (ADV-22). Body: { decision: "APPROVED" | "REJECTED",
 * note: string (required — a decision without a recorded reason is
 * not a verification trail) }.
 *
 * Guard: orders.edit + pharmacy pack flag. The service writes the
 * new rx state tag + timeline note in one transaction; this route
 * adds the pharmacy.rx_decision audit row. A REJECTED order is NOT
 * cancelled here — cancellation stays a deliberate staff action
 * through the normal order flow, and the confirm gate keeps the
 * order un-confirmable meanwhile.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { pharmacyErr, pharmacyGuard } from "../../guard";
import { writeAudit } from "@/lib/audit";
import { decideRxReview, RxReviewError } from "@/business-modules/pharmacy-orders";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  note: z.string().trim().min(2, "A decision note is required.").max(500),
});

export async function POST(req: Request, { params }: { params: { orderId: string } }) {
  const auth = await pharmacyGuard("orders.edit");
  if ("error" in auth) return auth.error;
  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return pharmacyErr(
      "VALIDATION_ERROR",
      "Decision input invalid.",
      400,
    );
  }
  try {
    const result = await decideRxReview({
      orderId: params.orderId,
      decision: parsed.data.decision,
      note: parsed.data.note,
      actorId: auth.session.user.id,
    });
    await writeAudit({
      actorId: auth.session.user.id,
      action: "pharmacy.rx_decision",
      entityType: "Order",
      entityId: params.orderId,
      afterJson: { decision: parsed.data.decision, note: parsed.data.note },
    });
    return NextResponse.json({ data: { orderId: params.orderId, state: result.state } });
  } catch (e) {
    if (e instanceof RxReviewError) {
      return pharmacyErr(e.code, e.message, e.code === "ORDER_NOT_FOUND" ? 404 : 409);
    }
    throw e;
  }
}
