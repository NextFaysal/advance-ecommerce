/**
 * Automation effect executor — ADV-7 (doc 22).
 *
 * The engine (src/automation/engine.ts) DESCRIBES a matched rule's
 * actions as effects; until this module existed nothing executed the
 * two customer-facing ones — send_sms / send_email run logs said
 * "applied" while no message ever left the building. The automation
 * runner (src/jobs/runners.ts) now calls executeAutomationEffects()
 * for every immediate "matched" run and persists the run log with
 * the REAL outcomes written back into the effects:
 *
 *  - send_sms executes through the platform SMS send path — the same
 *    provider resolver the sms-send queue uses (worker-deps injects
 *    its resolveSmsProvider: a Settings-configured real gateway when
 *    one exists, otherwise the sandbox simulator). The outcome
 *    records the provider name, its message id, the send status and
 *    segment count, and says SIMULATED whenever the provider ran in
 *    sandbox mode — a simulated send never reads as a real one.
 *  - send_email enqueues through the ADV-3 producer
 *    (src/email/send.ts enqueueEmailJob) onto the email-send queue;
 *    the outcome records the queue job id. Actual delivery is the
 *    email worker's step (configured transport sends, unconfigured
 *    transport SKIPs there) — the run log says "queued", never
 *    "sent".
 *
 * Failure discipline: a failing effect NEVER throws out of here and
 * never blocks its sibling effects. It is recorded on its own effect
 * entry (status "skipped", reason = the error CODE — first token of
 * the message, never payload data), so the admin run log explains
 * exactly what happened. The full phone is resolved server-side at
 * send time and is never written into a description (the masked form
 * the engine already produced is preserved in failures).
 *
 * Dry-run and scheduled runs never reach this module: dry runs
 * describe without executing (the engine's "planned" effects are the
 * truthful record), and scheduled runs execute when their delayed
 * re-invocation runs — see createAutomationRunner in runners.ts.
 */
import { prisma } from "@advance-ecommerce/db";
import { formatBdt } from "@advance-ecommerce/validators";
import type { EnqueueEmailResult } from "../email/send";
import type { SmsProvider } from "../integrations/sms";
import type { EmailJob } from "../jobs/queues";
import type {
  ActionEffect,
  AutomationEvent,
  AutomationRunLog,
} from "./types";

export interface AutomationEffectDeps {
  /**
   * The platform SMS resolver — worker-deps passes the SAME
   * resolveSmsProvider the sms-send queue's send paths use, so an
   * automation SMS and an OTP SMS travel identically. Absent (tests,
   * in-process callers) the sandbox simulator from handlers.ts is
   * used and the outcome is labelled simulated.
   */
  smsProvider?: (providerName: string | null) => Promise<SmsProvider>;
  /**
   * The ADV-3 email producer seam. Absent, enqueueEmailJob from
   * src/email/send.ts is loaded lazily (it reports its own outcome:
   * queued / not_queued + reason — enqueue failure is an outcome
   * here, never an exception).
   */
  emailEnqueue?: (job: EmailJob) => Promise<EnqueueEmailResult>;
}

/** First token of an error message — an error CODE, never payload data. */
function errorCodeOf(error: unknown): string {
  if (error instanceof Error) {
    const firstToken = error.message.split(":")[0]?.trim();
    return firstToken !== undefined && firstToken !== "" ? firstToken : error.name;
  }
  return "UNKNOWN_ERROR";
}

/* ------------------------------------------------------------------ */
/* SMS copy — composed here, per send path convention (each existing   */
/* send path composes its own message: otp.ts, return-notify.ts).      */
/* Automation templates are admin-chosen keys; known keys get specific */
/* copy, every other key gets the generic order-update line — the      */
/* message is never empty. Bangla-first, like the other send paths.    */
/* ------------------------------------------------------------------ */

const ORDER_STATUS_BN: Record<string, string> = {
  PENDING: "গৃহীত হয়েছে, নিশ্চিতকরণের অপেক্ষায়",
  CONFIRMED: "নিশ্চিত হয়েছে",
  PROCESSING: "প্রস্তুত করা হচ্ছে",
  PACKED: "প্যাক করা হয়েছে",
  SHIPPED: "কুরিয়ারে পাঠানো হয়েছে",
  DELIVERED: "ডেলিভারি সম্পন্ন হয়েছে",
  CANCELLED: "বাতিল হয়েছে",
  RETURNED: "ফেরত নেওয়া হয়েছে",
  REFUNDED: "রিফান্ড সম্পন্ন হয়েছে",
};

export function renderAutomationSms(templateKey: string, event: AutomationEvent): string {
  if (event.order) {
    const orderNo = event.order.orderNo;
    if (templateKey === "order_confirmation") {
      return `অর্ডার ${orderNo}: আপনার অর্ডারটি সফলভাবে গৃহীত হয়েছে। মোট ${formatBdt(event.order.totalPoisha)}। ধন্যবাদ!`;
    }
    const statusBn = ORDER_STATUS_BN[event.order.status] ?? event.order.status;
    return `অর্ডার ${orderNo}: আপনার অর্ডারের অবস্থা আপডেট হয়েছে — অর্ডারটি এখন ${statusBn}।`;
  }
  if (event.checkout) {
    return `আপনি ${formatBdt(event.checkout.totalPoisha)} মূল্যের পণ্য কার্টে রেখে গেছেন। স্টক শেষ হওয়ার আগেই অর্ডারটি সম্পূর্ণ করুন — আমাদের ওয়েবসাইটে ফিরে আসুন।`;
  }
  return "আপনার অর্ডারের অবস্থা আপডেট হয়েছে। বিস্তারিত জানতে আমাদের ওয়েবসাইটে অর্ডার ট্র্যাক করুন।";
}

/* ------------------------------------------------------------------ */
/* Recipient resolution — server-side only. The order/checkout ids on  */
/* the event are the only inputs; full numbers never enter a log.      */
/* ------------------------------------------------------------------ */

async function resolveSmsRecipient(event: AutomationEvent): Promise<string | null> {
  if (event.order) return event.order.customerPhone;
  if (event.checkout) {
    const capture = await prisma.abandonedCheckout.findUnique({
      where: { id: event.checkout.id },
      select: { customerPhone: true },
    });
    return capture?.customerPhone ?? null;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Effect execution                                                    */
/* ------------------------------------------------------------------ */

async function executeSmsEffect(
  effect: ActionEffect,
  event: AutomationEvent,
  deps: AutomationEffectDeps,
): Promise<ActionEffect> {
  if (effect.action.type !== "send_sms") return effect;
  const templateKey = effect.action.templateKey;
  const phone = await resolveSmsRecipient(event);
  if (phone === null || phone === "") {
    return {
      ...effect,
      status: "skipped",
      description: `Send SMS (template ${templateKey}) — skipped, no customer phone is attached to this event.`,
      reason: "no_recipient_context",
    };
  }
  try {
    const resolveProvider =
      deps.smsProvider ??
      (async () => {
        const handlers = await import("../jobs/handlers");
        return handlers.createSandboxSmsProvider();
      });
    const provider = await resolveProvider(null);
    const result = await provider.send({
      toPhone: phone,
      message: renderAutomationSms(templateKey, event),
      templateKey,
      orderId: event.order?.id ?? null,
    });
    if (result.status === "failed") {
      return {
        ...effect,
        status: "skipped",
        description: `Send SMS (template ${templateKey}) — the ${provider.name} provider reported failure; nothing was delivered.`,
        reason: "provider_failed",
      };
    }
    const simulated = provider.config.mode === "sandbox";
    return {
      ...effect,
      status: "applied",
      description:
        `SMS sent via ${provider.name}: messageId ${result.messageId}, status ${result.status}, ` +
        `${result.segments} segment(s)` +
        (simulated
          ? " — SIMULATED (sandbox provider; no real SMS gateway is configured in Settings)."
          : "."),
    };
  } catch (error) {
    const code = errorCodeOf(error);
    return {
      ...effect,
      status: "skipped",
      description: `Send SMS (template ${templateKey}) — send failed (${code}); nothing was delivered. The failure is recorded here, not hidden.`,
      reason: code,
    };
  }
}

async function executeEmailEffect(
  effect: ActionEffect,
  log: AutomationRunLog,
  event: AutomationEvent,
  index: number,
  deps: AutomationEffectDeps,
): Promise<ActionEffect> {
  if (effect.action.type !== "send_email") return effect;
  const templateKey = effect.action.templateKey;
  if (!event.order) {
    return {
      ...effect,
      status: "skipped",
      description: `Send email (template ${templateKey}) — skipped, email effects need an order in context.`,
      reason: "no_recipient_context",
    };
  }
  try {
    const enqueue =
      deps.emailEnqueue ??
      (async (job: EmailJob) => {
        const emailSend = await import("../email/send");
        return emailSend.enqueueEmailJob(job, "automation-email");
      });
    const job: EmailJob = {
      orderId: event.order.id,
      templateKey,
      recipientRef: event.order.id,
      idempotencyKey: `automation-email-${log.id}-${index}`,
    };
    const outcome = await enqueue(job);
    if (outcome.email === "queued") {
      return {
        ...effect,
        status: "applied",
        description:
          `Email queued on the email-send queue (job ${outcome.jobId}, template ${templateKey}) — ` +
          "the email worker renders the template and delivers through the configured transport; " +
          "an unconfigured transport SKIPs at send time. Queued is not sent.",
      };
    }
    return {
      ...effect,
      status: "skipped",
      description: `Send email (template ${templateKey}) — could not be queued (${outcome.reason}); nothing was sent.`,
      reason: outcome.reason,
    };
  } catch (error) {
    const code = errorCodeOf(error);
    return {
      ...effect,
      status: "skipped",
      description: `Send email (template ${templateKey}) — queueing failed (${code}); nothing was sent.`,
      reason: code,
    };
  }
}

/**
 * Execute the send effects of ONE matched, immediate, real (non-dry)
 * run and return the run log with outcomes written back. Every other
 * run shape (not matched, scheduled, dry-run) is returned untouched —
 * callers persist exactly what this returns.
 */
export async function executeAutomationEffects(
  log: AutomationRunLog,
  event: AutomationEvent,
  deps: AutomationEffectDeps = {},
): Promise<AutomationRunLog> {
  if (log.dryRun || log.status !== "matched" || !log.matched) return log;
  const effects: ActionEffect[] = [];
  for (const [index, effect] of log.effects.entries()) {
    if (effect.status !== "applied") {
      effects.push(effect);
    } else if (effect.action.type === "send_sms") {
      effects.push(await executeSmsEffect(effect, event, deps));
    } else if (effect.action.type === "send_email") {
      effects.push(await executeEmailEffect(effect, log, event, index, deps));
    } else {
      // confirm_order / assign_courier / tags / notify_staff remain
      // engine-described plan entries — no executor exists for them
      // yet, and this module does not pretend otherwise.
      effects.push(effect);
    }
  }
  return { ...log, effects };
}
