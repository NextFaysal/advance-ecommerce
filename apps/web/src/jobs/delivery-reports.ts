/**
 * SMS delivery reports (DLR) — durable application (schema wave 2).
 *
 * Before this module, the DLR webhook (app/api/v1/public/sms/dlr)
 * could only acknowledge callbacks: NotificationLog had no provider
 * message id, so a callback could not be joined to the send it
 * reported on, and it answered recorded:false honestly. Now the send
 * paths record accepted sends with their provider message id
 * (recordSmsSendAccepted in notification-failures.ts), and this
 * module applies a normalised callback to the matching row.
 *
 * WHAT "RECORDED" MEANS NOW:
 *  - A callback whose providerMessageId matches a recorded send row
 *    (and whose provider agrees with the row's provider) is RECORDED:
 *    the match itself is the durable fact this module guarantees.
 *  - status "failed" additionally flips the row to FAILED with
 *    errorRef "DLR_DELIVERY_FAILED" — the provider has told us the
 *    message never arrived, and the row must not keep claiming SENT.
 *  - status "delivered" / "pending" / "unknown" do NOT mutate the
 *    row: NotificationStatus has no DELIVERED value (QUEUED / SENT /
 *    FAILED), the row's SENT is its terminal recorded state, and
 *    inventing a mutation would be worse than none. The callback's
 *    reported status is returned to the caller (and logged there,
 *    ids only) — the response is the record for those.
 *  - No matching row (a send this system never recorded — e.g. sent
 *    before this wave, or by another tool on the same gateway
 *    account) → recorded:false with reason NO_MATCHING_SEND_RECORD.
 *    Nothing is fabricated to fill the gap.
 */
import { prisma } from "@advance-ecommerce/db";

export type SmsDlrStatus = "delivered" | "failed" | "pending" | "unknown";

export type ApplyDlrResult =
  | {
      recorded: true;
      notificationLogId: string;
      /** The row's status after applying the report. */
      rowStatus: string;
      /** True when this call changed the row (a "failed" report). */
      mutated: boolean;
    }
  | {
      recorded: false;
      reason: "NO_MATCHING_SEND_RECORD" | "PROVIDER_MISMATCH";
    };

export async function applySmsDeliveryReport(input: {
  provider: string;
  providerMessageId: string;
  status: SmsDlrStatus;
}): Promise<ApplyDlrResult> {
  const row = await prisma.notificationLog.findFirst({
    where: { providerMessageId: input.providerMessageId, channel: "SMS" },
    orderBy: { createdAt: "asc" },
    select: { id: true, provider: true, status: true },
  });
  if (row === null) return { recorded: false, reason: "NO_MATCHING_SEND_RECORD" };
  if (row.provider !== null && row.provider !== input.provider) {
    // Same message id, different provider: message ids are only
    // unique per provider, so this is not our send's report.
    return { recorded: false, reason: "PROVIDER_MISMATCH" };
  }
  if (input.status === "failed" && row.status !== "FAILED") {
    await prisma.notificationLog.update({
      where: { id: row.id },
      data: { status: "FAILED", errorRef: "DLR_DELIVERY_FAILED" },
    });
    return { recorded: true, notificationLogId: row.id, rowStatus: "FAILED", mutated: true };
  }
  return {
    recorded: true,
    notificationLogId: row.id,
    rowStatus: row.status,
    mutated: false,
  };
}
