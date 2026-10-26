/**
 * F-commerce order bot v1 — doc 22 ADV-6 part 3.
 *
 * WHAT THIS IS: a parser-and-rules assistant over the EXISTING inbox
 * machinery. Given a conversation, it runs the same pieces the staff
 * conversion flow uses — phone extraction (extractPhoneFromMessages),
 * the Bangla address parser (src/bd parseAddress) and buildOrderDraft()
 * — and produces a BotDraft: the parsed phone / address / items, the
 * parser's confidence, and an explicit list of what is still missing.
 * A staff member confirms a good draft with one tap and the order is
 * created through the SAME shared service as the manual inbox
 * conversion (createManualOrder, source "inbox-bot").
 *
 * WHAT THIS IS NOT: there is NO LLM anywhere in v1 (doc 22 is explicit:
 * bot v1 = parser + rules, honestly labelled). Nothing is sent to the
 * customer from here, and the bot NEVER creates an order on its own —
 * confirm is always a staff action behind RBAC.
 *
 * PERSISTENCE: none, deliberately. Order drafts are pure logic in this
 * codebase (the sibling draft route reports meta.persistence
 * "none-pure-logic"); a BotDraft is COMPUTED ON READ from the stored
 * conversation + messages, so it can never go stale against the thread.
 * The only state kept here is a process-local dismissal marker (per
 * conversation thread fingerprint) so a dismissed draft stays dismissed
 * until a NEW message arrives — labelled in-memory wherever surfaced.
 *
 * GATING (both evaluated server-side, in this order):
 *   1. feature flag `module.f_commerce` (the inbox module itself), and
 *   2. Settings key `f_commerce.bot_enabled` === "true" (default OFF —
 *      registered in src/lib/settings.ts SETTING_DEFAULTS).
 * When either is off the bot does nothing and the API routes answer
 * 403 (FEATURE_LOCKED / BOT_DISABLED) — never a silent empty success.
 */
import { foldBanglaDigits, parseAddress } from "../bd/address-parser";
import { maskPhone, type BdAddress } from "../checkout/validation";
import { getSetting } from "../lib/settings";
import {
  createManualOrder,
  type ManualCreateInput,
  type ManualCreateResult,
  type ManualOrderActor,
  type ManualCreatePricing,
} from "../orders/manual-create";
import { getVariantSnapshots } from "../orders/repository";
import {
  buildOrderDraft,
  extractPhoneFromMessages,
  type OrderDraft,
} from "./conversion";
import { demoInboxFlags, isInboxEnabled } from "./flags";
import { getConversationDb } from "./store";
import type { Conversation, InboxMessage } from "./types";

/** Settings key for the bot sub-toggle (default "false"). */
export const BOT_SETTING_KEY = "f_commerce.bot_enabled";
/** Engine label surfaced in API meta + order notes — v1 is rules only. */
export const BOT_ENGINE = "parser-rules-v1";
/**
 * Minimum address-parser confidence for a one-tap confirm. Mirrors the
 * threshold buildOrderDraft itself uses for needsStaffConfirmation
 * (confidence < 0.8 = staff must look). Below it, confirm is REJECTED
 * and the draft stays editable in the existing conversion panel.
 */
export const BOT_MIN_CONFIRM_CONFIDENCE = 0.8;

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface BotDraftItem {
  variantId: string;
  quantity: number;
}

export interface BotDraft {
  /** Always BOT_ENGINE — the draft is parser output, never an LLM guess. */
  engine: string;
  /** A draft is NOT an order. */
  isOrder: false;
  conversationId: string;
  channel: Conversation["channel"];
  customerName: string;
  /** Normalized +8801XXXXXXXXX when captured, else null. Staff-gated
   *  surfaces only — display via phoneMasked. */
  phone: string | null;
  phoneMasked: string | null;
  /** The inbound free text the address parser ran over. */
  addressText: string;
  /** Best-effort parsed address; fields the parser missed are absent. */
  address: Partial<BdAddress>;
  /** Address parser confidence 0–1 — surfaced, never hidden. */
  addressConfidence: number;
  items: BotDraftItem[];
  /**
   * Machine-readable gaps, e.g. "phone", "items", "address.district".
   * Empty means every required piece was found in the thread.
   */
  missingFields: string[];
  /** buildOrderDraft()'s errors when it could not assemble a valid draft. */
  errors: string[];
  /** A fully valid draft could be assembled (buildOrderDraft ok). */
  ready: boolean;
  /** ready AND confidence >= BOT_MIN_CONFIRM_CONFIDENCE — one-tap confirm allowed. */
  confirmable: boolean;
  /** The assembled draft when ready, else null. */
  draft: OrderDraft | null;
  /** Thread state this draft was computed from; a new message changes it. */
  threadFingerprint: string;
  generatedAt: string;
}

/* ------------------------------------------------------------------ */
/* Dependencies (injectable for tests; defaults are the real wiring)   */
/* ------------------------------------------------------------------ */

export interface BotDeps {
  loadConversation(
    conversationId: string,
  ): Promise<{ conversation: Conversation; messages: InboxMessage[] } | null>;
  isModuleEnabled(): boolean;
  isBotEnabled(): Promise<boolean>;
  /** Catalog unit price (poisha) for a variant, null when unknown. */
  variantPrice(variantId: string): Promise<number | null>;
  createOrder(
    input: ManualCreateInput,
    actor: ManualOrderActor,
  ): Promise<ManualCreateResult>;
}

export const defaultBotDeps: BotDeps = {
  loadConversation: (id) => getConversationDb(id),
  isModuleEnabled: () => isInboxEnabled(demoInboxFlags),
  isBotEnabled: async () => (await getSetting(BOT_SETTING_KEY)) === "true",
  variantPrice: async (variantId) => {
    const snapshots = await getVariantSnapshots([variantId]);
    return snapshots.get(variantId)?.unitPricePoisha ?? null;
  },
  createOrder: (input, actor) => createManualOrder(input, actor),
};

/* ------------------------------------------------------------------ */
/* Gating                                                              */
/* ------------------------------------------------------------------ */

export type BotGate =
  | { ok: true }
  | { ok: false; code: "FEATURE_LOCKED" | "BOT_DISABLED"; message: string };

export async function botGate(deps: BotDeps = defaultBotDeps): Promise<BotGate> {
  if (!deps.isModuleEnabled()) {
    return {
      ok: false,
      code: "FEATURE_LOCKED",
      message:
        "F-commerce inbox is locked for this install (module.f_commerce is OFF). / F-commerce ইনবক্স বন্ধ আছে (module.f_commerce OFF)।",
    };
  }
  if (!(await deps.isBotEnabled())) {
    return {
      ok: false,
      code: "BOT_DISABLED",
      message:
        "The order bot is OFF (Settings f_commerce.bot_enabled). / অর্ডার বট বন্ধ আছে (Settings f_commerce.bot_enabled)।",
    };
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Extraction helpers (pure)                                           */
/* ------------------------------------------------------------------ */

/**
 * Quantity mentioned anywhere in the inbound text: "২টা", "2 pcs",
 * "x3", "2 ta". Bangla digits are folded first (the address parser's
 * own helper). Null when the customer never stated a quantity.
 */
export function extractQuantityFromMessages(
  messages: readonly InboxMessage[],
): number | null {
  for (const m of messages) {
    if (m.direction !== "INBOUND" || !m.text) continue;
    const text = foldBanglaDigits(m.text);
    const hit =
      text.match(/(\d+)\s*(?:টা|টি|পিস|পিছ|pcs?|pieces?)/i) ??
      text.match(/(?:x|×)\s*(\d+)/i) ??
      text.match(/(\d+)\s*(?:ta|ti)\b/i);
    if (hit) {
      const qty = Number.parseInt(hit[1], 10);
      if (Number.isFinite(qty) && qty > 0) return qty;
    }
  }
  return null;
}

/**
 * Items the conversation is about: the variant the conversation
 * started from (productRefId) plus every PRODUCT_CARD ref in the
 * thread, de-duplicated, each with the stated quantity (default 1).
 */
export function extractBotItems(
  conversation: Conversation,
  messages: readonly InboxMessage[],
): BotDraftItem[] {
  const ids: string[] = [];
  const push = (id?: string) => {
    if (id && !ids.includes(id)) ids.push(id);
  };
  push(conversation.productRefId);
  for (const m of messages) {
    if (m.kind === "PRODUCT_CARD") push(m.refId);
  }
  const quantity = extractQuantityFromMessages(messages) ?? 1;
  return ids.map((variantId) => ({ variantId, quantity }));
}

function threadFingerprint(
  conversation: Conversation,
  messages: readonly InboxMessage[],
): string {
  return `${conversation.lastMessageAt}:${messages.length}`;
}

/* ------------------------------------------------------------------ */
/* Draft analysis (pure)                                               */
/* ------------------------------------------------------------------ */

/**
 * Compute the bot draft for a loaded conversation. Pure: same thread
 * in, same draft out (generatedAt aside). Runs buildOrderDraft() with
 * exactly the inputs the staff draft route would use — conversation
 * phone first, then thread extraction; the conversation's display
 * name as the customer name — so bot and staff paths can never drift.
 */
export function analyzeBotDraft(
  conversation: Conversation,
  messages: readonly InboxMessage[],
): BotDraft {
  const phone =
    conversation.customerPhone ?? extractPhoneFromMessages(messages);
  const addressText = messages
    .filter((m) => m.direction === "INBOUND" && m.text)
    .map((m) => m.text as string)
    .join("\n");
  const parsed = parseAddress(addressText);
  const address: Partial<BdAddress> = {
    division: parsed.division ?? undefined,
    district: parsed.district ?? undefined,
    upazila: parsed.upazila ?? parsed.area ?? undefined,
    addressLine: parsed.addressLine ? parsed.addressLine : undefined,
  };
  const items = extractBotItems(conversation, messages);

  const missingFields: string[] = [];
  if (!phone) missingFields.push("phone");
  if (items.length === 0) missingFields.push("items");
  if (!parsed.division) missingFields.push("address.division");
  if (!parsed.district) missingFields.push("address.district");
  if (!parsed.upazila && !parsed.area) missingFields.push("address.upazila");
  if (!parsed.addressLine || parsed.addressLine.trim().length < 5) {
    missingFields.push("address.addressLine");
  }
  if (conversation.customerDisplayName.trim().length < 2) {
    missingFields.push("customerName");
  }

  const result = buildOrderDraft({
    conversation,
    customerName: conversation.customerDisplayName,
    phoneRaw: phone ?? "",
    addressText,
    items,
  });

  return {
    engine: BOT_ENGINE,
    isOrder: false,
    conversationId: conversation.id,
    channel: conversation.channel,
    customerName: conversation.customerDisplayName.trim(),
    phone,
    phoneMasked: phone ? maskPhone(phone) : null,
    addressText,
    address,
    addressConfidence: parsed.confidence,
    items,
    missingFields,
    errors: result.ok ? [] : result.errors,
    ready: result.ok,
    confirmable: result.ok && parsed.confidence >= BOT_MIN_CONFIRM_CONFIDENCE,
    draft: result.ok ? result.draft : null,
    threadFingerprint: threadFingerprint(conversation, messages),
    generatedAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Dismissal (process-local, per thread fingerprint)                   */
/* ------------------------------------------------------------------ */

const dismissedThreads = new Map<string, string>();

/** True when staff dismissed the draft for the thread's CURRENT state. */
export function isBotDraftDismissed(draft: BotDraft): boolean {
  return dismissedThreads.get(draft.conversationId) === draft.threadFingerprint;
}

/**
 * Dismiss the conversation's current draft. A later inbound message
 * changes the thread fingerprint and the draft reappears — a dismissal
 * never swallows a customer's new information.
 */
export async function dismissBotDraft(
  conversationId: string,
  deps: BotDeps = defaultBotDeps,
): Promise<boolean> {
  const found = await deps.loadConversation(conversationId);
  if (!found) return false;
  dismissedThreads.set(
    conversationId,
    threadFingerprint(found.conversation, found.messages),
  );
  return true;
}

/* ------------------------------------------------------------------ */
/* Trigger seam + confirm                                              */
/* ------------------------------------------------------------------ */

export type BotDraftOutcome =
  | { status: "disabled"; code: "FEATURE_LOCKED" | "BOT_DISABLED"; message: string }
  | { status: "not_found" }
  | { status: "dismissed"; conversationId: string }
  | { status: "created"; draft: BotDraft };

/**
 * TRIGGER SEAM for channel ingestion (ADV-6 part 1): call after a new
 * inbound message has been ingested —
 *   await maybeCreateBotDraft(conversationId)
 * It is safe to call unconditionally: with the module flag or the bot
 * setting OFF it returns { status: "disabled" } and touches nothing.
 * "Created" means COMPUTED (drafts are not persisted — see header);
 * the returned draft is the value to surface/log. `force: true`
 * (staff regenerate) clears any dismissal first.
 */
export async function maybeCreateBotDraft(
  conversationId: string,
  deps: BotDeps = defaultBotDeps,
  opts?: { force?: boolean },
): Promise<BotDraftOutcome> {
  const gate = await botGate(deps);
  if (!gate.ok) return { status: "disabled", code: gate.code, message: gate.message };
  const found = await deps.loadConversation(conversationId);
  if (!found) return { status: "not_found" };
  if (opts?.force) dismissedThreads.delete(conversationId);
  const draft = analyzeBotDraft(found.conversation, found.messages);
  if (!opts?.force && isBotDraftDismissed(draft)) {
    return { status: "dismissed", conversationId };
  }
  return { status: "created", draft };
}

export type BotConfirmOutcome =
  | { status: "disabled"; code: "FEATURE_LOCKED" | "BOT_DISABLED"; message: string }
  | { status: "not_found" }
  | {
      status: "rejected";
      httpStatus: number;
      code: string;
      message: string;
      details?: unknown;
    }
  | {
      status: "created";
      orderId: string;
      orderNo: string;
      totalPoisha: number | null;
      pricing: ManualCreatePricing | null;
    };

/**
 * Staff one-tap confirm: re-computes the draft from the CURRENT thread
 * (never trusts a client copy) and creates the REAL order through
 * createManualOrder with source "inbox-bot" and an internal note that
 * names the bot engine + conversation, so the order's history is
 * truthful about its origin.
 *
 * Rejections (the draft stays editable in the existing conversion
 * panel in every case):
 *   - no usable phone            -> 422 BOT_PHONE_MISSING
 *   - any missing field          -> 422 BOT_DRAFT_INCOMPLETE
 *   - draft fails validation     -> 422 BOT_DRAFT_INVALID
 *   - confidence < 0.8           -> 422 BOT_LOW_CONFIDENCE
 *   - the create service's own failures pass through untouched.
 */
export async function confirmBotDraft(
  conversationId: string,
  actor: ManualOrderActor,
  deps: BotDeps = defaultBotDeps,
): Promise<BotConfirmOutcome> {
  const gate = await botGate(deps);
  if (!gate.ok) return { status: "disabled", code: gate.code, message: gate.message };
  const found = await deps.loadConversation(conversationId);
  if (!found) return { status: "not_found" };
  const { conversation } = found;
  const draft = analyzeBotDraft(conversation, found.messages);

  if (!draft.phone) {
    return {
      status: "rejected",
      httpStatus: 422,
      code: "BOT_PHONE_MISSING",
      message:
        "বট গ্রাহকের ফোন নম্বর খুঁজে পায়নি — অর্ডার তৈরি করা যায়নি। ড্রাফটটি কনভার্সন প্যানেলে ঠিক করে নিন। / The bot found no customer phone number — no order was created. Fix the draft in the conversion panel.",
    };
  }
  if (draft.missingFields.length > 0) {
    return {
      status: "rejected",
      httpStatus: 422,
      code: "BOT_DRAFT_INCOMPLETE",
      message:
        "বট ড্রাফটে কিছু তথ্য বাকি আছে — অর্ডার তৈরি করা যায়নি। / The bot draft is missing information — no order was created.",
      details: { missingFields: draft.missingFields },
    };
  }
  if (!draft.ready || !draft.draft) {
    return {
      status: "rejected",
      httpStatus: 422,
      code: "BOT_DRAFT_INVALID",
      message:
        "বট ড্রাফটটি যাচাইয়ে পাস করেনি — অর্ডার তৈরি করা যায়নি। / The bot draft failed validation — no order was created.",
      details: { errors: draft.errors },
    };
  }
  if (!draft.confirmable) {
    return {
      status: "rejected",
      httpStatus: 422,
      code: "BOT_LOW_CONFIDENCE",
      message:
        "ঠিকানা পার্সারে আস্থা কম — এক ক্লিকে অর্ডার করা যাবে না। ড্রাফটটি কনভার্সন প্যানেলে যাচাই করে নিন। / Low address-parser confidence — one-tap confirm is not allowed. Review the draft in the conversion panel.",
      details: {
        addressConfidence: draft.addressConfidence,
        requiredConfidence: BOT_MIN_CONFIRM_CONFIDENCE,
      },
    };
  }

  // Catalog prices, exactly like the staff convert route: a variant
  // the catalog does not know keeps price 0 here and the shared
  // service fails it with VARIANT_NOT_FOUND before any money math.
  const items: ManualCreateInput["items"] = [];
  for (const item of draft.draft.items) {
    items.push({
      variantId: item.variantId,
      quantity: item.quantity,
      unitPricePoisha: (await deps.variantPrice(item.variantId)) ?? 0,
    });
  }

  const result = await deps.createOrder(
    {
      phone: draft.draft.phone,
      customerName: draft.draft.customerName,
      address: draft.draft.address,
      items,
      paymentMethod: "cod",
      source: "inbox-bot",
      internalNote: `বট ড্রাফট (${BOT_ENGINE}) থেকে তৈরি — স্টাফ এক ক্লিকে নিশ্চিত করেছেন — conversation ${conversation.id} (${conversation.channel}) / Created from bot draft (${BOT_ENGINE}), staff one-tap confirmed — conversation ${conversation.id} (${conversation.channel})`,
    },
    actor,
  );
  if (!result.ok) {
    return {
      status: "rejected",
      httpStatus: result.httpStatus,
      code: result.code,
      message: result.message,
      details: result.details,
    };
  }
  return {
    status: "created",
    orderId: result.orderId,
    orderNo: result.orderNo,
    totalPoisha: result.pricing?.totalPoisha ?? result.order?.totalPoisha ?? null,
    pricing: result.pricing,
  };
}
