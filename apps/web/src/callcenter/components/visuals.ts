/**
 * Call-center visual language — CD0 (doc 20 §2).
 *
 * The call-center counterpart of OD0's order status language
 * (src/orders/components/labels.ts): every call outcome, disposition,
 * task source, task status and SLA state resolves to ONE
 * { tone, icon, labelBn, labelEn } entry here, in the exact
 * StatusVisual shape OD0 established, so badges, chips, queue cards
 * and the supervisor board all read in the same vocabulary. `tone` is
 * the ui Badge variant set; `icon` is a verified kebab-case IconName
 * from src/components/ui/icon.tsx. Status is never colour-only:
 * tone + icon + text travel together.
 *
 * Label sources (no second vocabulary invented):
 *  - Disposition Bn/En labels come from CALL_DISPOSITIONS itself —
 *    this file only adds tone + icon per code.
 *  - Outcome / source Bn wording follows the existing workbench
 *    (OUTCOME_BUTTONS / SOURCE_LABEL in app/admin/call-center/
 *    workbench.tsx), shortened to badge length.
 */
import type { IconName } from "../../components/ui/icon";
import type { StatusTone, StatusVisual } from "../../orders/components/labels";
import { CALL_DISPOSITIONS, type CallDisposition } from "../dispositions";
import type { CallOutcome, CallQueueSource, CallTaskStatus } from "../types";
import type { SlaState } from "./sla";

export type { StatusTone, StatusVisual };

/* ------------------------------------------------------------------ */
/* Call outcomes (types.ts CALL_OUTCOMES — the five human outcomes;   */
/* supervisor/automation log rows are not call outcomes and get none) */
/* ------------------------------------------------------------------ */

export const OUTCOME_VISUAL: Record<CallOutcome, StatusVisual> = {
  CONFIRMED: { tone: "success", icon: "check", labelBn: "কনফার্ম হয়েছে", labelEn: "Confirmed" },
  CALLBACK: { tone: "warning", icon: "clock", labelBn: "কলব্যাক", labelEn: "Callback" },
  CANCELLED: { tone: "danger", icon: "x", labelBn: "বাতিল হয়েছে", labelEn: "Cancelled" },
  NO_ANSWER: { tone: "neutral", icon: "phone", labelBn: "ফোন ধরেননি", labelEn: "No answer" },
  WRONG_NUMBER: { tone: "neutral", icon: "alert", labelBn: "ভুল নম্বর", labelEn: "Wrong number" },
};

/* ------------------------------------------------------------------ */
/* Dispositions (dispositions.ts CALL_DISPOSITIONS). Fraud-signal     */
/* codes (fraudSignal: true — FAKE_ORDER, WRONG_NUMBER_CONFIRMED) get */
/* the security treatment: danger tone + shield icon, so a chip that  */
/* fed the fraud blacklist is unmistakable in logs and QA views.      */
/* ------------------------------------------------------------------ */

const DISPOSITION_TONE_ICON: Record<CallDisposition, { tone: StatusTone; icon: IconName }> = {
  PRICE: { tone: "warning", icon: "tag" },
  DELIVERY_CHARGE: { tone: "warning", icon: "truck" },
  CHANGED_MIND: { tone: "neutral", icon: "refresh-ccw" },
  DUPLICATE_ORDER: { tone: "info", icon: "package" },
  FAKE_ORDER: { tone: "danger", icon: "shield" },
  WRONG_NUMBER_CONFIRMED: { tone: "danger", icon: "shield" },
  OTHER: { tone: "neutral", icon: "info" },
};

export const DISPOSITION_VISUAL: Record<CallDisposition, StatusVisual> = Object.fromEntries(
  CALL_DISPOSITIONS.map((def) => [
    def.code,
    {
      tone: DISPOSITION_TONE_ICON[def.code].tone,
      icon: DISPOSITION_TONE_ICON[def.code].icon,
      labelBn: def.labelBn,
      labelEn: def.labelEn,
    },
  ]),
) as Record<CallDisposition, StatusVisual>;

/* ------------------------------------------------------------------ */
/* Task sources (types.ts CallQueueSource)                            */
/* ------------------------------------------------------------------ */

export const SOURCE_VISUAL: Record<CallQueueSource, StatusVisual> = {
  PENDING_ORDER: { tone: "info", icon: "clock", labelBn: "অর্ডার কনফার্মেশন", labelEn: "Pending order" },
  FAILED_DELIVERY: { tone: "danger", icon: "truck", labelBn: "রেসকিউ কল", labelEn: "Failed delivery" },
  ABANDONED_CHECKOUT: { tone: "warning", icon: "cart", labelBn: "ছেড়ে যাওয়া চেকআউট", labelEn: "Abandoned checkout" },
  MANUAL: { tone: "neutral", icon: "user", labelBn: "ম্যানুয়াল", labelEn: "Manual" },
};

/* ------------------------------------------------------------------ */
/* Task statuses (types.ts CallTaskStatus) — the queue/board lifecycle */
/* ------------------------------------------------------------------ */

export const TASK_STATUS_VISUAL: Record<CallTaskStatus, StatusVisual> = {
  QUEUED: { tone: "warning", icon: "clock", labelBn: "কিউতে আছে", labelEn: "Queued" },
  IN_CALL: { tone: "brand", icon: "phone", labelBn: "কল চলছে", labelEn: "In call" },
  DONE: { tone: "success", icon: "check", labelBn: "সম্পন্ন", labelEn: "Done" },
  SKIPPED: { tone: "neutral", icon: "x", labelBn: "বাদ দেওয়া", labelEn: "Skipped" },
};

/* ------------------------------------------------------------------ */
/* SLA states (components/sla.ts slaStateForTask)                     */
/* ------------------------------------------------------------------ */

export const SLA_VISUAL: Record<SlaState, StatusVisual> = {
  ok: { tone: "success", icon: "check", labelBn: "SLA ঠিক আছে", labelEn: "Within SLA" },
  due: { tone: "warning", icon: "clock", labelBn: "সময় ঘনিয়ে এসেছে", labelEn: "Due soon" },
  overdue: { tone: "danger", icon: "alert", labelBn: "সময় পেরিয়ে গেছে", labelEn: "Overdue" },
};
