/**
 * Template overrides — ADV-29 template designer (doc 23, wave 53).
 *
 * Merchants can override a BOUNDED set of copy slots on the invoice
 * and on transactional email. This is free-text slots only — there
 * is NO layout engine, no HTML editing, and no way to restyle or
 * reorder a document from here. When a slot is empty/unset the
 * renderers fall back to the built-in copy in code, so a shop that
 * never opens the designer gets byte-identical output to before.
 *
 * STORAGE — Setting documents, the established JSON-doc pattern
 * (src/cms/site-content.ts, src/reports/saved-reports.ts): one
 * zod-validated JSON document per key in the Setting table, written
 * with prisma.setting.upsert. The generic setSetting() path is NOT
 * used: it rejects keys that are neither in SETTING_DEFAULTS nor in
 * its provider-key pattern, and `templates.*` is neither — the
 * doc-store write below is the same mechanism CMS and reports use.
 * Writes also invalidate the settings read cache so consumers that
 * read through getSetting() see the change immediately.
 *
 * INVOICE slots (doc key `templates.invoice`) — each slot is a
 * { bn, en } pair; the renderers print the non-empty parts joined
 * with " / ", exactly like the invoice's own bilingual labels:
 *   headerNote — printed under the masthead rule. No built-in
 *     default: unset prints nothing.
 *   termsLine  — printed above the footer note. No built-in
 *     default: unset prints nothing.
 *   footerNote — the closing note. Built-in default is
 *     DEFAULT_INVOICE_FOOTER (the copy the PDF always printed);
 *     unset keeps printing it.
 *
 * EMAIL slots (doc keys `templates.email.<key>`) — per key, per
 * locale (bn/en): `subject` and `intro`. `intro` replaces exactly
 * ONE line of the rendered email: the sentence right after the
 * greeting that says what happened (report_delivery has no
 * greeting; its intro is the first line). Everything else in
 * these emails stays code-rendered on purpose:
 *   - structured data lines (order number, totals, payment
 *     method, period, row count, CSV attachment) are DATA, not
 *     copy — an override can never make an email state a wrong
 *     total;
 *   - staff_invite's accept link, its validity window and the
 *     "ignore if unexpected" line are functional/safety copy and
 *     are never overridable.
 * Subject/intro text may use the documented placeholder tokens
 * for the key (EMAIL_PLACEHOLDERS below); the renderer substitutes
 * the values it already has. Tokens are a fixed substitution set,
 * NOT a template language — no conditionals, no loops, and an
 * unknown token is left as typed.
 *
 * OVERRIDABLE email keys: order_confirmation, staff_invite,
 * report_delivery — the three copy templates in
 * src/email/templates.ts with a clean subject+intro seam.
 * NOT overridable: daily_digest. It is not an
 * src/email/templates.ts template at all — its body is a metrics
 * report built by src/team/digest.ts (renderDigestText) and its
 * subject is composed inline in src/email/send.ts; there is no
 * copy seam to override, and an "intro" on a data report would
 * be decoration on someone else's numbers.
 *
 * All loaders fail SOFT: a missing/corrupt doc or a DB error
 * resolves to "no override". A broken override must never break
 * an invoice or an email send.
 */
import { z } from "zod";
import { invalidateSettingCache } from "@/lib/settings";

/* ------------------------------------------------------------------ */
/* Shapes + storage keys                                               */
/* ------------------------------------------------------------------ */

export interface BilingualSlot {
  bn: string;
  en: string;
}

export interface InvoiceTemplateOverrides {
  headerNote: BilingualSlot;
  footerNote: BilingualSlot;
  termsLine: BilingualSlot;
}

export type InvoiceSlotName = keyof InvoiceTemplateOverrides;

export const INVOICE_TEMPLATE_KEY = "templates.invoice";

export type EmailTemplateKey =
  | "order_confirmation"
  | "order_shipped"
  | "order_delivered"
  | "order_cancelled"
  | "staff_invite"
  | "report_delivery";

export const OVERRIDABLE_EMAIL_KEYS: readonly EmailTemplateKey[] = [
  "order_confirmation",
  "order_shipped",
  "order_delivered",
  "order_cancelled",
  "staff_invite",
  "report_delivery",
] as const;

export function emailTemplateDocKey(key: EmailTemplateKey): string {
  return `templates.email.${key}`;
}

/** The copy the invoice PDF printed before overrides existed
 *  (src/pdf/invoice.ts), split at its " / " join. The PDF renders
 *  this when footerNote is unset. */
export const DEFAULT_INVOICE_FOOTER: BilingualSlot = {
  bn: "ধন্যবাদ! এটি একটি কম্পিউটার-তৈরি ইনভয়েস — স্বাক্ষরের প্রয়োজন নেই।",
  en: "Thank you! This is a computer-generated invoice — no signature required.",
};

/** Documented placeholder tokens per email key — substituted by
 *  the renderers in src/email/templates.ts from values they
 *  already hold. Listed here so the editor UI and the module
 *  header can never drift from what the renderers substitute. */
export const EMAIL_PLACEHOLDERS: Record<EmailTemplateKey, readonly string[]> = {
  order_confirmation: ["orderNo", "store", "total", "customerName", "paymentMethod"],
  order_shipped: ["orderNo", "store", "total", "customerName", "paymentMethod"],
  order_delivered: ["orderNo", "store", "total", "customerName", "paymentMethod"],
  order_cancelled: ["orderNo", "store", "total", "customerName", "paymentMethod"],
  staff_invite: ["store", "role", "inviteeName", "expiry"],
  report_delivery: ["store", "reportName", "periodFrom", "periodTo", "rowCount"],
};

export interface EmailLocaleCopy {
  subject: string;
  intro: string;
}

export interface EmailTemplateOverrides {
  bn: EmailLocaleCopy;
  en: EmailLocaleCopy;
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

const MAX_SLOT_CHARS = 500;
const MAX_SUBJECT_CHARS = 200;
const MAX_INTRO_CHARS = 1000;

const bilingualSlotSchema = z.object({
  bn: z.string().max(MAX_SLOT_CHARS).default(""),
  en: z.string().max(MAX_SLOT_CHARS).default(""),
});

const invoiceDocSchema = z.object({
  version: z.literal(1),
  headerNote: bilingualSlotSchema.default({ bn: "", en: "" }),
  footerNote: bilingualSlotSchema.default({ bn: "", en: "" }),
  termsLine: bilingualSlotSchema.default({ bn: "", en: "" }),
});

const emailLocaleCopySchema = z.object({
  subject: z.string().max(MAX_SUBJECT_CHARS).default(""),
  intro: z.string().max(MAX_INTRO_CHARS).default(""),
});

const emailDocSchema = z.object({
  version: z.literal(1),
  bn: emailLocaleCopySchema.default({ subject: "", intro: "" }),
  en: emailLocaleCopySchema.default({ subject: "", intro: "" }),
});

function trimSlot(slot: BilingualSlot): BilingualSlot {
  return { bn: slot.bn.trim(), en: slot.en.trim() };
}

function trimEmailDoc(doc: EmailTemplateOverrides): EmailTemplateOverrides {
  const trimCopy = (c: EmailLocaleCopy): EmailLocaleCopy => ({
    subject: c.subject.trim(),
    intro: c.intro.trim(),
  });
  return { bn: trimCopy(doc.bn), en: trimCopy(doc.en) };
}

function isEmptySlot(slot: BilingualSlot): boolean {
  return slot.bn.trim() === "" && slot.en.trim() === "";
}

function isEmptyEmailDoc(doc: EmailTemplateOverrides): boolean {
  return (
    doc.bn.subject.trim() === "" &&
    doc.bn.intro.trim() === "" &&
    doc.en.subject.trim() === "" &&
    doc.en.intro.trim() === ""
  );
}

/* ------------------------------------------------------------------ */
/* Doc store (direct Setting upsert — see header for why not           */
/* setSetting). Prisma is imported lazily, the prismaKeyValueStore     */
/* pattern, so importing this module never drags the DB client into    */
/* a consumer that only needs the types/constants.                     */
/* ------------------------------------------------------------------ */

async function readDocRaw(key: string): Promise<string | null> {
  const { prisma } = await import("@advance-ecommerce/db");
  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.value ?? null;
}

async function writeDocRaw(key: string, value: string, actorId: string): Promise<void> {
  const { prisma } = await import("@advance-ecommerce/db");
  await prisma.setting.upsert({
    where: { key },
    create: {
      key,
      value,
      valueEncrypted: false,
      isPublic: false,
      category: "general",
      description: "Template overrides document (JSON, ADV-29)",
      updatedById: actorId,
    },
    update: { value, valueEncrypted: false, updatedById: actorId },
  });
  invalidateSettingCache(key);
}

async function deleteDocRaw(key: string): Promise<void> {
  const { prisma } = await import("@advance-ecommerce/db");
  await prisma.setting.deleteMany({ where: { key } });
  invalidateSettingCache(key);
}

/* ------------------------------------------------------------------ */
/* Invoice: load / resolve / save / reset                              */
/* ------------------------------------------------------------------ */

export async function loadInvoiceOverrides(): Promise<InvoiceTemplateOverrides | null> {
  try {
    const raw = await readDocRaw(INVOICE_TEMPLATE_KEY);
    if (raw === null || raw.trim() === "") return null;
    const parsed = invoiceDocSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    const doc: InvoiceTemplateOverrides = {
      headerNote: trimSlot(parsed.data.headerNote),
      footerNote: trimSlot(parsed.data.footerNote),
      termsLine: trimSlot(parsed.data.termsLine),
    };
    return isEmptySlot(doc.headerNote) && isEmptySlot(doc.footerNote) && isEmptySlot(doc.termsLine)
      ? null
      : doc;
  } catch {
    return null;
  }
}

/** One invoice slot as print text: the non-empty locale parts
 *  joined with " / " (the invoice's own bilingual style). Null
 *  when the slot carries no text. */
export function invoiceSlotText(slot: BilingualSlot | null | undefined): string | null {
  if (slot === null || slot === undefined) return null;
  const parts = [slot.bn.trim(), slot.en.trim()].filter((p) => p !== "");
  return parts.length > 0 ? parts.join(" / ") : null;
}

export interface ResolvedInvoiceTexts {
  /** Null = print nothing (no built-in default). */
  headerNote: string | null;
  /** Null = the renderer prints DEFAULT_INVOICE_FOOTER. */
  footerNote: string | null;
  /** Null = print nothing (no built-in default). */
  termsLine: string | null;
}

/** The slot texts both invoice surfaces consume. buildInvoiceData
 *  embeds these into InvoiceData; the print centre gets the same
 *  resolution through the templates admin API. */
export async function resolveInvoiceTexts(): Promise<ResolvedInvoiceTexts> {
  const overrides = await loadInvoiceOverrides();
  if (overrides === null) return { headerNote: null, footerNote: null, termsLine: null };
  return {
    headerNote: invoiceSlotText(overrides.headerNote),
    footerNote: invoiceSlotText(overrides.footerNote),
    termsLine: invoiceSlotText(overrides.termsLine),
  };
}

export type SaveResult = { ok: true } | { ok: false; message: string };

export async function saveInvoiceOverrides(
  input: InvoiceTemplateOverrides,
  actorId: string,
): Promise<SaveResult> {
  const candidate: InvoiceTemplateOverrides = {
    headerNote: trimSlot(input.headerNote),
    footerNote: trimSlot(input.footerNote),
    termsLine: trimSlot(input.termsLine),
  };
  const parsed = invoiceDocSchema.safeParse({ version: 1, ...candidate });
  if (!parsed.success) {
    return { ok: false, message: "Invalid invoice template (a slot is over 500 characters)." };
  }
  await writeDocRaw(INVOICE_TEMPLATE_KEY, JSON.stringify({ version: 1, ...candidate }), actorId);
  return { ok: true };
}

/** Clear ONE invoice slot back to its built-in default. When no
 *  slot carries text any more the document row is removed, so
 *  "no overrides" is a real absence, not an empty document. */
export async function resetInvoiceSlot(slot: InvoiceSlotName, actorId: string): Promise<void> {
  const current =
    (await loadInvoiceOverrides()) ??
    ({
      headerNote: { bn: "", en: "" },
      footerNote: { bn: "", en: "" },
      termsLine: { bn: "", en: "" },
    } satisfies InvoiceTemplateOverrides);
  const next: InvoiceTemplateOverrides = { ...current, [slot]: { bn: "", en: "" } };
  if (isEmptySlot(next.headerNote) && isEmptySlot(next.footerNote) && isEmptySlot(next.termsLine)) {
    await deleteDocRaw(INVOICE_TEMPLATE_KEY);
    return;
  }
  await writeDocRaw(INVOICE_TEMPLATE_KEY, JSON.stringify({ version: 1, ...next }), actorId);
}

/* ------------------------------------------------------------------ */
/* Email: load / resolve / save / reset                                */
/* ------------------------------------------------------------------ */

export async function loadEmailOverrides(key: EmailTemplateKey): Promise<EmailTemplateOverrides | null> {
  try {
    const raw = await readDocRaw(emailTemplateDocKey(key));
    if (raw === null || raw.trim() === "") return null;
    const parsed = emailDocSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    const doc = trimEmailDoc(parsed.data);
    return isEmptyEmailDoc(doc) ? null : doc;
  } catch {
    return null;
  }
}

export interface ResolvedEmailCopy {
  subject?: string;
  intro?: string;
}

/** The override for ONE email job, resolved for its locale at
 *  send time by src/email/send.ts and passed into the pure
 *  renderer. Null when nothing is overridden for that locale.
 *  Never throws (see header). */
export async function resolveEmailCopy(
  key: EmailTemplateKey,
  locale: "bn" | "en",
): Promise<ResolvedEmailCopy | null> {
  const doc = await loadEmailOverrides(key);
  if (doc === null) return null;
  const copy = doc[locale];
  const subject = copy.subject.trim();
  const intro = copy.intro.trim();
  if (subject === "" && intro === "") return null;
  return {
    ...(subject !== "" ? { subject } : {}),
    ...(intro !== "" ? { intro } : {}),
  };
}

export async function saveEmailOverrides(
  key: EmailTemplateKey,
  input: EmailTemplateOverrides,
  actorId: string,
): Promise<SaveResult> {
  const candidate = trimEmailDoc(input);
  const parsed = emailDocSchema.safeParse({ version: 1, ...candidate });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Invalid email template (subject over 200 or intro over 1000 characters).",
    };
  }
  await writeDocRaw(emailTemplateDocKey(key), JSON.stringify({ version: 1, ...candidate }), actorId);
  return { ok: true };
}

/** Clear ONE field ("subject" | "intro") of ONE locale of ONE
 *  email key back to the built-in copy. Removes the document row
 *  when nothing remains (see resetInvoiceSlot). */
export async function resetEmailField(
  key: EmailTemplateKey,
  locale: "bn" | "en",
  field: "subject" | "intro",
  actorId: string,
): Promise<void> {
  const docKey = emailTemplateDocKey(key);
  const current =
    (await loadEmailOverrides(key)) ??
    ({
      bn: { subject: "", intro: "" },
      en: { subject: "", intro: "" },
    } satisfies EmailTemplateOverrides);
  const next: EmailTemplateOverrides = {
    ...current,
    [locale]: { ...current[locale], [field]: "" },
  };
  if (isEmptyEmailDoc(next)) {
    await deleteDocRaw(docKey);
    return;
  }
  await writeDocRaw(docKey, JSON.stringify({ version: 1, ...next }), actorId);
}
