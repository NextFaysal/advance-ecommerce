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
 *  - confirm_order (schema wave 2) executes through the order
 *    funnel's applyOrderTransition — the advance/OTP confirm gate
 *    applies exactly as it does to a staff confirm, and a blocked
 *    gate is the recorded outcome, never bypassed.
 *  - add_tag / remove_tag (schema wave 2) write the real tag stores:
 *    OrderTag rows for order events, the Customer.tags array for
 *    customer.registered events.
 *  - assign_courier (schema wave 2) books the order's remaining
 *    lines through createSplitShipment — the SAME function the
 *    staff shipments route books with — carrying the assignment
 *    engine's recommendation as the decision record (the rule's
 *    courier wins; a divergence is recorded as an override with the
 *    rule as its reason). Only CONFIRMED / PROCESSING / PACKED
 *    orders are booked; anything else is a recorded skip.
 *  - notify_staff remains PLAN-ONLY: there is no staff notification
 *    channel in the system (no inbox, no staff push) — the run log
 *    entry itself is the only record, and the effect text says so
 *    instead of pretending a notification was delivered.
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
import { RENDERABLE_EMAIL_TEMPLATES } from "./types";
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
  if (event.customer) {
    return "স্বাগতম! আপনার অ্যাকাউন্ট সফলভাবে তৈরি হয়েছে। কেনাকাটা শুরু করতে আমাদের ওয়েবসাইটে যান — ধন্যবাদ!";
  }
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
  if (event.customer) return event.customer.customerPhone;
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
    if (!simulated) {
      // Durable DLR (schema wave 2): an accepted send from a REAL
      // provider leaves a NotificationLog row carrying the provider
      // message id, so the provider's delivery callback can be
      // matched to this send later. Sandbox ids are simulated and
      // are deliberately NOT recorded — no DLR will ever arrive
      // for them, and a row would invite a false match. The
      // recorder never throws; its failure changes nothing here.
      try {
        const failures = await import("../jobs/notification-failures");
        await failures.recordSmsSendAccepted({
          templateKey,
          recipientRef: phone,
          orderId: event.order?.id ?? null,
          provider: provider.name,
          providerMessageId: result.messageId,
          segments: result.segments,
        });
      } catch {
        // Bookkeeping only — the send already happened.
      }
    }
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
  // Automation-email fix (2026-10-30): validate BEFORE enqueueing.
  // The worker renders only RENDERABLE_EMAIL_TEMPLATES; anything else
  // used to queue happily and then SKIP silently at send time, so a
  // merchant's rule could "send" email that never existed (the
  // shipped example's payment_help did exactly this). A bad key is
  // now an honest skip HERE, in the run log, and nothing is queued.
  if (!(RENDERABLE_EMAIL_TEMPLATES as readonly string[]).includes(templateKey)) {
    return {
      ...effect,
      status: "skipped",
      description:
        `Send email (template ${templateKey}) — skipped, "${templateKey}" is not a renderable email template; ` +
        `nothing was queued. The email worker can only render: ${RENDERABLE_EMAIL_TEMPLATES.join(", ")}.`,
      reason: "template_not_renderable",
    };
  }
  const noticeSubject = effect.action.subject?.trim() ?? "";
  const noticeText = effect.action.message?.trim() ?? "";
  if (templateKey === "automation_notice" && (noticeSubject === "" || noticeText === "")) {
    return {
      ...effect,
      status: "skipped",
      description:
        "Send email (template automation_notice) — skipped, automation_notice needs a non-empty subject and message on the action; nothing was queued.",
      reason: "notice_content_missing",
    };
  }
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
      // automation_notice carries the merchant's own text on the job;
      // the worker renders it to the order's customer (the recipient
      // is resolved from the order, like order_confirmation).
      ...(templateKey === "automation_notice" ? { noticeSubject, noticeText } : {}),
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

/* ------------------------------------------------------------------ */
/* confirm_order — through the order funnel (schema wave 2). The      */
/* funnel's advance/OTP gate applies verbatim: a blocked confirm is  */
/* the recorded outcome. The funnel also emits order.status_changed  */
/* itself, so downstream rules see the confirm like any other.        */
/* ------------------------------------------------------------------ */

async function executeConfirmOrderEffect(
  effect: ActionEffect,
  event: AutomationEvent,
): Promise<ActionEffect> {
  if (effect.action.type !== "confirm_order") return effect;
  if (!event.order) {
    return {
      ...effect,
      status: "skipped",
      description: "Confirm order — skipped, this event carries no order.",
      reason: "no_order_context",
    };
  }
  const orderId = event.order.id;
  try {
    const current = await prisma.order.findUnique({
      where: { id: orderId },
      select: { status: true },
    });
    if (current === null) {
      return {
        ...effect,
        status: "skipped",
        description: "Confirm order — skipped, the order no longer exists.",
        reason: "order_not_found",
      };
    }
    if (current.status === "CONFIRMED") {
      return {
        ...effect,
        status: "skipped",
        description: "Confirm order — the order is already CONFIRMED; nothing was changed.",
        reason: "already_confirmed",
      };
    }
    const repository = await import("../orders/repository");
    const result = await repository.applyOrderTransition(
      orderId,
      "CONFIRMED",
      "automation",
      "Automation rule confirm_order",
    );
    if (result.kind === "ok") {
      return {
        ...effect,
        status: "applied",
        description: `Order confirmed by automation (${result.from} -> CONFIRMED) through the order funnel.`,
      };
    }
    if (result.kind === "blocked") {
      return {
        ...effect,
        status: "skipped",
        description:
          `Confirm order — the confirm gate refused (${result.code}): ${result.error} ` +
          "Automation never overrides the advance/OTP gate.",
        reason: result.code,
      };
    }
    return {
      ...effect,
      status: "skipped",
      description: `Confirm order — the state machine refused the transition (${result.kind === "invalid" ? result.error : "order not found"}).`,
      reason: result.kind === "invalid" ? "invalid_transition" : "order_not_found",
    };
  } catch (error) {
    const code = errorCodeOf(error);
    return {
      ...effect,
      status: "skipped",
      description: `Confirm order — execution failed (${code}); the order was not confirmed by this effect.`,
      reason: code,
    };
  }
}

/* ------------------------------------------------------------------ */
/* add_tag / remove_tag — the real tag stores (schema wave 2):        */
/* OrderTag rows for order events, Customer.tags for                  */
/* customer.registered events. Idempotent: adding a present tag or    */
/* removing an absent one is an applied no-op, described as such.     */
/* ------------------------------------------------------------------ */

async function executeTagEffect(
  effect: ActionEffect,
  event: AutomationEvent,
): Promise<ActionEffect> {
  if (effect.action.type !== "add_tag" && effect.action.type !== "remove_tag") return effect;
  const tag = effect.action.tag;
  const adding = effect.action.type === "add_tag";
  try {
    if (event.order) {
      const orderId = event.order.id;
      const existing = await prisma.orderTag.findFirst({
        where: { orderId, tag },
        select: { id: true },
      });
      if (adding) {
        if (existing !== null) {
          return {
            ...effect,
            status: "applied",
            description: `Tag "${tag}" was already on order ${event.order.orderNo} — no change needed.`,
          };
        }
        await prisma.orderTag.create({ data: { orderId, tag } });
        return {
          ...effect,
          status: "applied",
          description: `Tag "${tag}" added to order ${event.order.orderNo}.`,
        };
      }
      if (existing === null) {
        return {
          ...effect,
          status: "applied",
          description: `Tag "${tag}" was not on order ${event.order.orderNo} — nothing to remove.`,
        };
      }
      await prisma.orderTag.delete({ where: { id: existing.id } });
      return {
        ...effect,
        status: "applied",
        description: `Tag "${tag}" removed from order ${event.order.orderNo}.`,
      };
    }
    if (event.customer) {
      const customer = await prisma.customer.findUnique({
        where: { id: event.customer.id },
        select: { tags: true },
      });
      if (customer === null) {
        return {
          ...effect,
          status: "skipped",
          description: `Tag "${tag}" — skipped, the customer no longer exists.`,
          reason: "customer_not_found",
        };
      }
      const has = customer.tags.includes(tag);
      if (adding === has) {
        return {
          ...effect,
          status: "applied",
          description: adding
            ? `Tag "${tag}" was already on the customer — no change needed.`
            : `Tag "${tag}" was not on the customer — nothing to remove.`,
        };
      }
      await prisma.customer.update({
        where: { id: event.customer.id },
        data: {
          tags: adding
            ? { set: [...customer.tags, tag] }
            : { set: customer.tags.filter((t) => t !== tag) },
        },
      });
      return {
        ...effect,
        status: "applied",
        description: adding
          ? `Tag "${tag}" added to the customer.`
          : `Tag "${tag}" removed from the customer.`,
      };
    }
    return {
      ...effect,
      status: "skipped",
      description: `Tag "${tag}" — skipped, this event carries neither an order nor a customer.`,
      reason: "no_tag_context",
    };
  } catch (error) {
    const code = errorCodeOf(error);
    return {
      ...effect,
      status: "skipped",
      description: `Tag "${tag}" — execution failed (${code}); tags were not changed by this effect.`,
      reason: code,
    };
  }
}

/* ------------------------------------------------------------------ */
/* assign_courier — books the remaining lines (schema wave 2) via     */
/* createSplitShipment, the same function the staff shipments route   */
/* books with. The assignment engine's live recommendation is loaded  */
/* and recorded as the decision context: when the rule's courier      */
/* differs from the recommendation it is an OVERRIDE whose reason     */
/* names the automation rule; when no recommendation exists          */
/* (insufficient history) the booking still proceeds on the rule's    */
/* explicit instruction and says so.                                  */
/* ------------------------------------------------------------------ */

const BOOKABLE_FOR_COURIER = ["CONFIRMED", "PROCESSING", "PACKED"] as const;

async function executeAssignCourierEffect(
  effect: ActionEffect,
  event: AutomationEvent,
): Promise<ActionEffect> {
  if (effect.action.type !== "assign_courier") return effect;
  const courier = effect.action.courier;
  if (!event.order) {
    return {
      ...effect,
      status: "skipped",
      description: `Assign courier ${courier} — skipped, this event carries no order.`,
      reason: "no_order_context",
    };
  }
  const orderId = event.order.id;
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { status: true, orderNo: true },
    });
    if (order === null) {
      return {
        ...effect,
        status: "skipped",
        description: `Assign courier ${courier} — skipped, the order no longer exists.`,
        reason: "order_not_found",
      };
    }
    if (!(BOOKABLE_FOR_COURIER as readonly string[]).includes(order.status)) {
      return {
        ...effect,
        status: "skipped",
        description:
          `Assign courier ${courier} — skipped, order ${order.orderNo} is ${order.status}; ` +
          "automation books only CONFIRMED / PROCESSING / PACKED orders.",
        reason: "order_not_bookable",
      };
    }
    const shipments = await import("../shipments/split-shipments");
    const coverage = await shipments.getOrderShipmentCoverage(orderId);
    if (coverage === null) {
      return {
        ...effect,
        status: "skipped",
        description: `Assign courier ${courier} — skipped, shipment coverage could not be loaded.`,
        reason: "coverage_unavailable",
      };
    }
    const remaining = coverage.lines
      .filter((l) => l.remainingQuantity > 0)
      .map((l) => ({ orderItemId: l.orderItemId, quantity: l.remainingQuantity }));
    if (remaining.length === 0) {
      return {
        ...effect,
        status: "skipped",
        description: `Assign courier ${courier} — every line of order ${order.orderNo} is already booked; nothing was created.`,
        reason: "already_booked",
      };
    }
    let recommendedProvider: string | null = null;
    let recommendationStatus = "unavailable";
    try {
      const recommendation = await import("../shipments/assignment-recommendation");
      const rec = await recommendation.getBookingRecommendation(orderId);
      if (rec.ok) {
        recommendationStatus = rec.value.status;
        recommendedProvider = rec.value.recommended?.provider ?? null;
      }
    } catch {
      // The recommendation is decision CONTEXT, not a gate: its
      // failure never blocks the rule's explicit instruction.
    }
    const provider = courier.trim().toLowerCase();
    const isOverride = recommendedProvider !== null && recommendedProvider !== provider;
    const booked = await shipments.createSplitShipment(orderId, {
      items: remaining,
      provider,
      note: "Automation rule assign_courier",
      assignment: {
        recommendedProvider,
        ...(isOverride
          ? { overrideReason: `Automation rule assigned ${provider} over the engine recommendation (${recommendedProvider}).` }
          : {}),
      },
      decidedBy: "automation",
    });
    if (!booked.ok) {
      return {
        ...effect,
        status: "skipped",
        description: `Assign courier ${courier} — booking refused (${booked.code}): ${booked.error}`,
        reason: booked.code,
      };
    }
    return {
      ...effect,
      status: "applied",
      description:
        `Booked shipment ${booked.value.id} with ${booked.value.provider} for order ${order.orderNo} ` +
        `(tracking ${booked.value.trackingId ?? "—"}). Assignment engine: ${recommendationStatus}` +
        (recommendedProvider !== null
          ? `, recommended ${recommendedProvider}${isOverride ? " — rule's courier recorded as an override" : " — matches the rule's courier"}.`
          : " — no recommendation existed; booked on the rule's explicit instruction."),
    };
  } catch (error) {
    const code = errorCodeOf(error);
    return {
      ...effect,
      status: "skipped",
      description: `Assign courier ${courier} — execution failed (${code}); no booking was created by this effect.`,
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
    } else if (effect.action.type === "confirm_order") {
      effects.push(await executeConfirmOrderEffect(effect, event));
    } else if (effect.action.type === "add_tag" || effect.action.type === "remove_tag") {
      effects.push(await executeTagEffect(effect, event));
    } else if (effect.action.type === "assign_courier") {
      effects.push(await executeAssignCourierEffect(effect, event));
    } else {
      // notify_staff remains plan-only (see the header): there is
      // no staff notification channel to deliver through, so the
      // effect is re-labelled honestly instead of left "applied".
      effects.push({
        ...effect,
        status: "skipped",
        description:
          `Notify staff: ${effect.action.type === "notify_staff" ? effect.action.message : ""} — ` +
          "plan-only: no staff notification channel exists in this system, so nothing was delivered; " +
          "this run log entry is the only record.",
        reason: "plan_only_no_staff_channel",
      });
    }
  }
  return { ...log, effects };
}
