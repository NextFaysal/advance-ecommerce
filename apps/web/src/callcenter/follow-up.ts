/**
 * Call Center C4 — Follow-up Automation Service.
 *
 * Automatically dispatches follow-up SMS to customers on unanswered calls,
 * scheduled callbacks, or cancellation attempts, ensuring higher confirmation rates.
 *
 * v2-merge note (PR #1): NOT wired into the outcome route. Main already
 * has a fuller C4 implementation — runOutcomeAutomations in
 * src/callcenter/automation.ts — which is flag-gated
 * (module.call_center_automation, OFF in production until the VPS
 * worker exists), settings-driven and deduped against the order SMS.
 * Wiring this direct-send variant alongside it would double-send and
 * bypass that gate. Kept for reference; do not wire without replacing
 * the automation.ts path.
 */
import { getActiveSmsProvider } from "@/integrations/sms-resolver";
import type { CallOutcome } from "./types";

export interface FollowUpOptions {
  customerPhone: string;
  customerName?: string;
  orderId?: string | null;
  outcome: CallOutcome;
  callbackDue?: string | null;
  storeName?: string;
}

export interface FollowUpResult {
  triggered: boolean;
  smsSent: boolean;
  message?: string;
  reason?: string;
}

/**
 * Evaluates whether an outcome triggers an automated SMS follow-up,
 * formats the appropriate Bangla message, and sends it via the SMS provider.
 */
export async function dispatchCallFollowUp(options: FollowUpOptions): Promise<FollowUpResult> {
  const { customerPhone, customerName, orderId, outcome, callbackDue, storeName = "আমাদের শপ" } = options;

  if (!customerPhone || customerPhone.includes("***")) {
    return {
      triggered: false,
      smsSent: false,
      reason: "Masked or missing phone number — cannot dispatch SMS.",
    };
  }

  let message: string | null = null;
  let templateKey: string | null = null;

  switch (outcome) {
    case "NO_ANSWER":
      templateKey = "call_center.unanswered_followup";
      message = `প্রিয় ${customerName || "গ্রাহক"}, ${storeName} থেকে আপনার অর্ডার ${
        orderId ? `#${orderId}` : ""
      } নিশ্চিত করার জন্য কল করা হয়েছিল কিন্তু সংযোগ পাওয়া যায়নি। বিস্তারিত জানতে কলব্যাক করুন অথবা মেসেজের উত্তর দিন। ধন্যবাদ!`;
      break;

    case "CALLBACK":
      templateKey = "call_center.callback_reminder";
      const timeStr = callbackDue ? new Date(callbackDue).toLocaleTimeString("bn-BD", { hour: "2-digit", minute: "2-digit" }) : "শীঘ্রই";
      message = `প্রিয় ${customerName || "গ্রাহক"}, ${storeName} থেকে আপনার অর্ডার সংক্রান্ত বিষয়ে ${timeStr}-এ পুনরায় কল করা হবে। ভালো থাকবেন!`;
      break;

    default:
      // Other outcomes (CONFIRMED, CANCELLED, WRONG_NUMBER) do not trigger an unanswered follow-up SMS here
      return {
        triggered: false,
        smsSent: false,
        reason: `Outcome ${outcome} does not require automated follow-up.`,
      };
  }

  try {
    const provider = getActiveSmsProvider();
    const result = await provider.send({
      toPhone: customerPhone,
      message,
      templateKey,
      orderId: orderId || null,
    });

    return {
      triggered: true,
      smsSent: result.status === "sent" || result.status === "queued",
      message,
    };
  } catch (e) {
    console.error("[CallCenter FollowUp] Failed to dispatch follow-up SMS:", e);
    return {
      triggered: true,
      smsSent: false,
      reason: e instanceof Error ? e.message : "SMS provider error",
    };
  }
}
