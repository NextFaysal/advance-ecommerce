/**
 * Email templates — ADV-3 (doc 22).
 *
 * Pure renderers: no DB, no settings reads, no sends. Callers
 * (src/email/send.ts) resolve the store identity + recipient data and
 * pass plain values in. Bangla-first: the store's default locale is
 * "bn" (Settings general.locale); "en" is the fallback rendering.
 *
 * Honesty: a template only states what the system knows — an order was
 * received, an invite exists and when it expires. No fake branding:
 * the only brand surface is the store name from Settings
 * (general.store_name); when it is unset a neutral word is used.
 */
import { formatBdt } from "@advance-ecommerce/validators";

export type EmailLocale = "bn" | "en";

export interface RenderedEmail {
  subject: string;
  /** Plain-text body (always present — the transport sends it as `text`). */
  text: string;
  /** Minimal HTML body, every interpolated value escaped. */
  html: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Merchant copy override for one email, resolved for the send
 *  locale at send time (src/templates/overrides.ts via
 *  src/email/send.ts). `intro` replaces the renderer's intro line
 *  (the sentence after the greeting that says what happened);
 *  every other line stays code-rendered — an override can never
 *  change a stated total, link or expiry. Both fields accept the
 *  key's documented placeholder tokens ({orderNo}, {store}, …),
 *  substituted from the values the renderer already holds; an
 *  unknown token is left as typed. */
export interface EmailCopyOverride {
  subject?: string;
  intro?: string;
}

function applyTokens(text: string, values: Record<string, string>): string {
  return text.replace(/\{([a-zA-Z]+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? (values[name] as string) : match,
  );
}

function storeLabel(storeName: string, locale: EmailLocale): string {
  const trimmed = storeName.trim();
  if (trimmed !== "") return trimmed;
  return locale === "bn" ? "আমাদের স্টোর" : "our store";
}

/** Payment-method display label. Raw codes are the checkout method
 *  strings (cod / bkash / nagad / …); unknown codes pass through. */
function paymentMethodLabel(method: string, locale: EmailLocale): string {
  if (method.toLowerCase() === "cod") {
    return locale === "bn" ? "ক্যাশ অন ডেলিভারি" : "Cash on Delivery";
  }
  return method;
}

function formatExpiry(iso: string, locale: EmailLocale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat(locale === "bn" ? "bn-BD" : "en-GB", {
      timeZone: "Asia/Dhaka",
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  } catch {
    return iso;
  }
}

function wrapHtml(locale: EmailLocale, paragraphs: string[]): string {
  const dir = "ltr";
  const body = paragraphs.map((p) => `<p style="margin:0 0 12px;line-height:1.6">${p}</p>`).join("");
  return `<!doctype html><html lang="${locale}" dir="${dir}"><body style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#1a1a1a">${body}</body></html>`;
}

/* ------------------------------------------------------------------ */
/* Order confirmation                                                  */
/* ------------------------------------------------------------------ */

export interface OrderConfirmationEmailInput {
  locale: EmailLocale;
  /** Settings general.store_name; "" when unset. */
  storeName: string;
  customerName: string;
  orderNo: string;
  totalPoisha: number;
  /** Raw checkout payment method code (cod / bkash / …). */
  paymentMethod: string;
  /** Merchant subject/intro override (ADV-29) — see EmailCopyOverride. */
  copyOverride?: EmailCopyOverride;
}

export function renderOrderConfirmationEmail(
  input: OrderConfirmationEmailInput,
): RenderedEmail {
  const store = storeLabel(input.storeName, input.locale);
  const total = formatBdt(input.totalPoisha);
  const method = paymentMethodLabel(input.paymentMethod, input.locale);
  const tokens: Record<string, string> = {
    orderNo: input.orderNo,
    store,
    total,
    customerName: input.customerName,
    paymentMethod: method,
  };
  const overrideSubject =
    input.copyOverride?.subject !== undefined && input.copyOverride.subject.trim() !== ""
      ? applyTokens(input.copyOverride.subject.trim(), tokens)
      : null;
  const overrideIntro =
    input.copyOverride?.intro !== undefined && input.copyOverride.intro.trim() !== ""
      ? applyTokens(input.copyOverride.intro.trim(), tokens)
      : null;

  if (input.locale === "bn") {
    const subject = overrideSubject ?? `অর্ডার নিশ্চিতকরণ — ${input.orderNo} · ${store}`;
    const lines = [
      `আসসালামু আলাইকুম ${input.customerName},`,
      overrideIntro ?? `${store}-এ আপনার অর্ডারটি সফলভাবে গৃহীত হয়েছে।`,
      `অর্ডার নম্বর: ${input.orderNo}`,
      `মোট: ${total}`,
      `পেমেন্ট পদ্ধতি: ${method}`,
      `অর্ডারের সর্বশেষ অবস্থা আপনার অ্যাকাউন্টে দেখতে পারবেন। কোনো সাহায্য লাগলে এই ইমেইলে উত্তর দিন বা স্টোরে যোগাযোগ করুন।`,
      `ধন্যবাদ,\n${store}`,
    ];
    return {
      subject,
      text: lines.join("\n\n"),
      html: wrapHtml("bn", lines.map((l) => escapeHtml(l).replace(/\n/g, "<br>"))),
    };
  }

  const subject = overrideSubject ?? `Order confirmation — ${input.orderNo} · ${store}`;
  const lines = [
    `Hello ${input.customerName},`,
    overrideIntro ?? `Your order at ${store} has been received successfully.`,
    `Order number: ${input.orderNo}`,
    `Total: ${total}`,
    `Payment method: ${method}`,
    `You can follow the latest status of your order in your account. If you need help, reply to this email or contact the store.`,
    `Thank you,\n${store}`,
  ];
  return {
    subject,
    text: lines.join("\n\n"),
    html: wrapHtml("en", lines.map((l) => escapeHtml(l).replace(/\n/g, "<br>"))),
  };
}

/* ------------------------------------------------------------------ */
/* Order lifecycle: shipped / delivered / cancelled                    */
/* ------------------------------------------------------------------ */

/** Shared input for the three order-lifecycle renderers below — the
 *  same fields the order-confirmation renderer takes, except the
 *  payment method is optional: when it is absent (or blank) no
 *  payment line is rendered. */
export interface OrderLifecycleEmailInput {
  locale: EmailLocale;
  /** Settings general.store_name; "" when unset. */
  storeName: string;
  customerName: string;
  orderNo: string;
  totalPoisha: number;
  /** Raw checkout payment method code (cod / bkash / …), optional. */
  paymentMethod?: string;
  /** Merchant subject/intro override (ADV-29) — see EmailCopyOverride. */
  copyOverride?: EmailCopyOverride;
}

function lifecycleTokens(input: OrderLifecycleEmailInput, store: string, total: string) {
  const rawMethod = (input.paymentMethod ?? "").trim();
  const method = rawMethod !== "" ? paymentMethodLabel(rawMethod, input.locale) : "";
  return {
    method,
    tokens: {
      orderNo: input.orderNo,
      store,
      total,
      customerName: input.customerName,
      paymentMethod: method,
    } as Record<string, string>,
  };
}

function lifecycleOverride(
  input: OrderLifecycleEmailInput,
  tokens: Record<string, string>,
): { overrideSubject: string | null; overrideIntro: string | null } {
  return {
    overrideSubject:
      input.copyOverride?.subject !== undefined && input.copyOverride.subject.trim() !== ""
        ? applyTokens(input.copyOverride.subject.trim(), tokens)
        : null,
    overrideIntro:
      input.copyOverride?.intro !== undefined && input.copyOverride.intro.trim() !== ""
        ? applyTokens(input.copyOverride.intro.trim(), tokens)
        : null,
  };
}

export function renderOrderShippedEmail(input: OrderLifecycleEmailInput): RenderedEmail {
  const store = storeLabel(input.storeName, input.locale);
  const total = formatBdt(input.totalPoisha);
  const { method, tokens } = lifecycleTokens(input, store, total);
  const { overrideSubject, overrideIntro } = lifecycleOverride(input, tokens);

  if (input.locale === "bn") {
    const subject = overrideSubject ?? `অর্ডার পাঠানো হয়েছে — ${input.orderNo} · ${store}`;
    const lines = [
      `আসসালামু আলাইকুম ${input.customerName},`,
      overrideIntro ?? `${store} থেকে আপনার অর্ডারটি পাঠিয়ে দেওয়া হয়েছে — এটি এখন আপনার ঠিকানার পথে।`,
      `অর্ডার নম্বর: ${input.orderNo}`,
      `মোট: ${total}`,
      ...(method !== "" ? [`পেমেন্ট পদ্ধতি: ${method}`] : []),
      `অর্ডারের সর্বশেষ অবস্থা আপনার অ্যাকাউন্টে দেখতে পারবেন। কোনো সাহায্য লাগলে এই ইমেইলে উত্তর দিন বা স্টোরে যোগাযোগ করুন।`,
      `ধন্যবাদ,\n${store}`,
    ];
    return {
      subject,
      text: lines.join("\n\n"),
      html: wrapHtml("bn", lines.map((l) => escapeHtml(l).replace(/\n/g, "<br>"))),
    };
  }

  const subject = overrideSubject ?? `Order shipped — ${input.orderNo} · ${store}`;
  const lines = [
    `Hello ${input.customerName},`,
    overrideIntro ?? `Your order from ${store} has been shipped and is on its way to you.`,
    `Order number: ${input.orderNo}`,
    `Total: ${total}`,
    ...(method !== "" ? [`Payment method: ${method}`] : []),
    `You can follow the latest status of your order in your account. If you need help, reply to this email or contact the store.`,
    `Thank you,\n${store}`,
  ];
  return {
    subject,
    text: lines.join("\n\n"),
    html: wrapHtml("en", lines.map((l) => escapeHtml(l).replace(/\n/g, "<br>"))),
  };
}

export function renderOrderDeliveredEmail(input: OrderLifecycleEmailInput): RenderedEmail {
  const store = storeLabel(input.storeName, input.locale);
  const total = formatBdt(input.totalPoisha);
  const { method, tokens } = lifecycleTokens(input, store, total);
  const { overrideSubject, overrideIntro } = lifecycleOverride(input, tokens);

  if (input.locale === "bn") {
    const subject = overrideSubject ?? `অর্ডার ডেলিভারি সম্পন্ন — ${input.orderNo} · ${store}`;
    const lines = [
      `আসসালামু আলাইকুম ${input.customerName},`,
      overrideIntro ?? `আপনার অর্ডারটি সফলভাবে ডেলিভারি হয়েছে।`,
      `অর্ডার নম্বর: ${input.orderNo}`,
      `মোট: ${total}`,
      ...(method !== "" ? [`পেমেন্ট পদ্ধতি: ${method}`] : []),
      `${store} থেকে কেনাকাটা করার জন্য ধন্যবাদ! কোনো সাহায্য লাগলে এই ইমেইলে উত্তর দিন বা স্টোরে যোগাযোগ করুন।`,
      `ধন্যবাদ,\n${store}`,
    ];
    return {
      subject,
      text: lines.join("\n\n"),
      html: wrapHtml("bn", lines.map((l) => escapeHtml(l).replace(/\n/g, "<br>"))),
    };
  }

  const subject = overrideSubject ?? `Order delivered — ${input.orderNo} · ${store}`;
  const lines = [
    `Hello ${input.customerName},`,
    overrideIntro ?? `Your order has been delivered successfully.`,
    `Order number: ${input.orderNo}`,
    `Total: ${total}`,
    ...(method !== "" ? [`Payment method: ${method}`] : []),
    `Thank you for shopping with ${store}! If you need help, reply to this email or contact the store.`,
    `Thank you,\n${store}`,
  ];
  return {
    subject,
    text: lines.join("\n\n"),
    html: wrapHtml("en", lines.map((l) => escapeHtml(l).replace(/\n/g, "<br>"))),
  };
}

export function renderOrderCancelledEmail(input: OrderLifecycleEmailInput): RenderedEmail {
  const store = storeLabel(input.storeName, input.locale);
  const total = formatBdt(input.totalPoisha);
  const { method, tokens } = lifecycleTokens(input, store, total);
  const { overrideSubject, overrideIntro } = lifecycleOverride(input, tokens);

  if (input.locale === "bn") {
    const subject = overrideSubject ?? `অর্ডার বাতিল করা হয়েছে — ${input.orderNo} · ${store}`;
    const lines = [
      `আসসালামু আলাইকুম ${input.customerName},`,
      overrideIntro ?? `আপনার অর্ডারটি বাতিল করা হয়েছে।`,
      `অর্ডার নম্বর: ${input.orderNo}`,
      `মোট: ${total}`,
      ...(method !== "" ? [`পেমেন্ট পদ্ধতি: ${method}`] : []),
      `আপনাকে আর কিছু করতে হবে না — কোনো পদক্ষেপ প্রয়োজন হলে আমাদের টিম আপনার সাথে যোগাযোগ করবে। কোনো প্রশ্ন থাকলে এই ইমেইলে উত্তর দিন বা স্টোরে যোগাযোগ করুন।`,
      `ধন্যবাদ,\n${store}`,
    ];
    return {
      subject,
      text: lines.join("\n\n"),
      html: wrapHtml("bn", lines.map((l) => escapeHtml(l).replace(/\n/g, "<br>"))),
    };
  }

  const subject = overrideSubject ?? `Order cancelled — ${input.orderNo} · ${store}`;
  const lines = [
    `Hello ${input.customerName},`,
    overrideIntro ?? `Your order has been cancelled.`,
    `Order number: ${input.orderNo}`,
    `Total: ${total}`,
    ...(method !== "" ? [`Payment method: ${method}`] : []),
    `There is nothing further you need to do — if anything is needed, our team will contact you. If you have any questions, reply to this email or contact the store.`,
    `Thank you,\n${store}`,
  ];
  return {
    subject,
    text: lines.join("\n\n"),
    html: wrapHtml("en", lines.map((l) => escapeHtml(l).replace(/\n/g, "<br>"))),
  };
}

/** Minimal HTML body for merchant-authored plain text (the
 *  automation_notice payload): blank-line-separated paragraphs,
 *  every character escaped, single newlines kept as line breaks.
 *  Used by src/email/send.ts, which sends the raw text as `text`. */
export function plainTextToHtml(text: string, locale: EmailLocale): string {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p !== "")
    .map((p) => escapeHtml(p).replace(/\n/g, "<br>"));
  return wrapHtml(locale, paragraphs.length > 0 ? paragraphs : [escapeHtml(text)]);
}

/* ------------------------------------------------------------------ */
/* Staff invite                                                        */
/* ------------------------------------------------------------------ */

export interface StaffInviteEmailInput {
  locale: EmailLocale;
  /** Settings general.store_name; "" when unset. */
  storeName: string;
  inviteeName: string;
  roleName: string;
  /** The one-time accept link (raw token — exists only on the job). */
  inviteLink: string;
  /** ISO expiry of the invite (72h from issue). */
  expiresAtIso: string;
  /** Merchant subject/intro override (ADV-29) — see EmailCopyOverride.
   *  The link, validity and safety lines are NEVER overridable. */
  copyOverride?: EmailCopyOverride;
}

export function renderStaffInviteEmail(input: StaffInviteEmailInput): RenderedEmail {
  const store = storeLabel(input.storeName, input.locale);
  const expiry = formatExpiry(input.expiresAtIso, input.locale);
  const tokens: Record<string, string> = {
    store,
    role: input.roleName,
    inviteeName: input.inviteeName,
    expiry,
  };
  const overrideSubject =
    input.copyOverride?.subject !== undefined && input.copyOverride.subject.trim() !== ""
      ? applyTokens(input.copyOverride.subject.trim(), tokens)
      : null;
  const overrideIntro =
    input.copyOverride?.intro !== undefined && input.copyOverride.intro.trim() !== ""
      ? applyTokens(input.copyOverride.intro.trim(), tokens)
      : null;

  if (input.locale === "bn") {
    const subject = overrideSubject ?? `${store} — টিমে যোগ দেওয়ার আমন্ত্রণ`;
    const lines = [
      `আসসালামু আলাইকুম ${input.inviteeName},`,
      overrideIntro ?? `আপনাকে ${store}-এর অ্যাডমিন টিমে "${input.roleName}" ভূমিকায় যোগ দেওয়ার জন্য আমন্ত্রণ জানানো হয়েছে।`,
      `আমন্ত্রণ গ্রহণ করে নিজের পাসওয়ার্ড সেট করতে এই লিংকে যান:\n${input.inviteLink}`,
      `লিংকটি ${expiry} পর্যন্ত বৈধ থাকবে। লিংকটি কারো সাথে শেয়ার করবেন না — এটি একবারই ব্যবহার করা যাবে।`,
      `আপনি এই আমন্ত্রণ আশা না করলে ইমেইলটি উপেক্ষা করুন।`,
    ];
    const htmlLines = [
      escapeHtml(lines[0] as string),
      escapeHtml(lines[1] as string),
      `আমন্ত্রণ গ্রহণ করে নিজের পাসওয়ার্ড সেট করতে এই লিংকে যান:<br><a href="${escapeHtml(input.inviteLink)}">${escapeHtml(input.inviteLink)}</a>`,
      escapeHtml(lines[3] as string),
      escapeHtml(lines[4] as string),
    ];
    return { subject, text: lines.join("\n\n"), html: wrapHtml("bn", htmlLines) };
  }

  const subject = overrideSubject ?? `${store} — you're invited to join the team`;
  const lines = [
    `Hello ${input.inviteeName},`,
    overrideIntro ?? `You have been invited to join the ${store} admin team in the "${input.roleName}" role.`,
    `Accept the invite and set your own password here:\n${input.inviteLink}`,
    `The link stays valid until ${expiry}. Do not share it — it can be used only once.`,
    `If you were not expecting this invitation, you can ignore this email.`,
  ];
  const htmlLines = [
    escapeHtml(lines[0] as string),
    escapeHtml(lines[1] as string),
    `Accept the invite and set your own password here:<br><a href="${escapeHtml(input.inviteLink)}">${escapeHtml(input.inviteLink)}</a>`,
    escapeHtml(lines[3] as string),
    escapeHtml(lines[4] as string),
  ];
  return { subject, text: lines.join("\n\n"), html: wrapHtml("en", htmlLines) };
}

/* ------------------------------------------------------------------ */
/* Scheduled report delivery (ADV-8)                                   */
/* ------------------------------------------------------------------ */

export interface ReportDeliveryEmailInput {
  locale: EmailLocale;
  /** Settings general.store_name; "" when unset. */
  storeName: string;
  /** Saved report name (staff-chosen). */
  reportName: string;
  /** Covered period, Dhaka YYYY-MM-DD bounds. */
  periodFrom: string;
  periodTo: string;
  /** Data rows in the attached CSV (excluding the watermark). */
  rowCount: number;
  /** Merchant subject/intro override (ADV-29) — see EmailCopyOverride. */
  copyOverride?: EmailCopyOverride;
}

export function renderReportDeliveryEmail(input: ReportDeliveryEmailInput): RenderedEmail {
  const store = storeLabel(input.storeName, input.locale);
  const tokens: Record<string, string> = {
    store,
    reportName: input.reportName,
    periodFrom: input.periodFrom,
    periodTo: input.periodTo,
    rowCount: String(input.rowCount),
  };
  const overrideSubject =
    input.copyOverride?.subject !== undefined && input.copyOverride.subject.trim() !== ""
      ? applyTokens(input.copyOverride.subject.trim(), tokens)
      : null;
  const overrideIntro =
    input.copyOverride?.intro !== undefined && input.copyOverride.intro.trim() !== ""
      ? applyTokens(input.copyOverride.intro.trim(), tokens)
      : null;
  if (input.locale === "bn") {
    const subject = overrideSubject ?? `${store} — নির্ধারিত রিপোর্ট: ${input.reportName} (${input.periodFrom} → ${input.periodTo})`;
    const lines = [
      overrideIntro ?? `আপনার নির্ধারিত রিপোর্ট "${input.reportName}" তৈরি হয়ে গেছে।`,
      `সময়কাল: ${input.periodFrom} → ${input.periodTo} (Asia/Dhaka)। সংযুক্ত CSV ফাইলে ${input.rowCount}টি সারি আছে।`,
      `এই ইমেইলটি স্বয়ংক্রিয়ভাবে পাঠানো হয়েছে — রিপোর্টের সময়সূচি বদলাতে Admin > Reports > Report Builder-এ যান।`,
    ];
    return { subject, text: lines.join("\n\n"), html: wrapHtml("bn", lines.map(escapeHtml)) };
  }
  const subject = overrideSubject ?? `${store} — scheduled report: ${input.reportName} (${input.periodFrom} → ${input.periodTo})`;
  const lines = [
    overrideIntro ?? `Your scheduled report "${input.reportName}" is ready.`,
    `Period: ${input.periodFrom} → ${input.periodTo} (Asia/Dhaka). The attached CSV contains ${input.rowCount} rows.`,
    `This email was sent automatically — manage report schedules in Admin > Reports > Report Builder.`,
  ];
  return { subject, text: lines.join("\n\n"), html: wrapHtml("en", lines.map(escapeHtml)) };
}
