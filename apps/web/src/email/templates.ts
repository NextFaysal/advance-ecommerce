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
}

export function renderOrderConfirmationEmail(
  input: OrderConfirmationEmailInput,
): RenderedEmail {
  const store = storeLabel(input.storeName, input.locale);
  const total = formatBdt(input.totalPoisha);
  const method = paymentMethodLabel(input.paymentMethod, input.locale);

  if (input.locale === "bn") {
    const subject = `অর্ডার নিশ্চিতকরণ — ${input.orderNo} · ${store}`;
    const lines = [
      `আসসালামু আলাইকুম ${input.customerName},`,
      `${store}-এ আপনার অর্ডারটি সফলভাবে গৃহীত হয়েছে।`,
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

  const subject = `Order confirmation — ${input.orderNo} · ${store}`;
  const lines = [
    `Hello ${input.customerName},`,
    `Your order at ${store} has been received successfully.`,
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
}

export function renderStaffInviteEmail(input: StaffInviteEmailInput): RenderedEmail {
  const store = storeLabel(input.storeName, input.locale);
  const expiry = formatExpiry(input.expiresAtIso, input.locale);

  if (input.locale === "bn") {
    const subject = `${store} — টিমে যোগ দেওয়ার আমন্ত্রণ`;
    const lines = [
      `আসসালামু আলাইকুম ${input.inviteeName},`,
      `আপনাকে ${store}-এর অ্যাডমিন টিমে "${input.roleName}" ভূমিকায় যোগ দেওয়ার জন্য আমন্ত্রণ জানানো হয়েছে।`,
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

  const subject = `${store} — you're invited to join the team`;
  const lines = [
    `Hello ${input.inviteeName},`,
    `You have been invited to join the ${store} admin team in the "${input.roleName}" role.`,
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
