"use client";

/**
 * Template designer editor (ADV-29, doc 23 wave 53) — self-fetching
 * client component for Admin > Settings > Templates.
 *
 * What it edits (src/templates/overrides.ts is the contract):
 *  - Invoice: three free-text slots (headerNote / termsLine /
 *    footerNote), each a { bn, en } pair. Empty = built-in
 *    behaviour (header/terms print nothing; the footer prints the
 *    built-in thank-you line, shown as the field's default hint).
 *  - Email: for order_confirmation / staff_invite /
 *    report_delivery, a subject + intro per locale. The intro
 *    replaces ONE line of the email; order numbers, totals, the
 *    invite link and its safety lines are rendered by code and
 *    can never be edited here. daily_digest is deliberately
 *    absent — it is a data report, not a copy template.
 *
 * Every write goes to /api/v1/admin/settings/templates with a
 * required reason and is audited server-side (templates.update /
 * templates.reset). Resets are per slot/field, never whole-doc.
 *
 * The preview renders the SAVED invoice template against the most
 * recent real order via the preview API (same read model as the
 * PDF, phone masked); with no orders in the shop it renders the
 * API's clearly-labelled sample instead.
 */
import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import { formatBdt } from "../../../../src/checkout/pricing";
import type { InvoiceData } from "@/pdf/invoice-data";

interface Slot {
  bn: string;
  en: string;
}
interface InvoiceDoc {
  headerNote: Slot;
  footerNote: Slot;
  termsLine: Slot;
}
interface EmailCopy {
  subject: string;
  intro: string;
}
interface EmailDoc {
  bn: EmailCopy;
  en: EmailCopy;
}
interface EmailEntry {
  doc: EmailDoc;
  configured: boolean;
  placeholders: string[];
  docKey: string;
}
interface TemplatesPayload {
  invoice: {
    doc: InvoiceDoc;
    configured: boolean;
    effective: { headerNote: string | null; footerNote: string | null; termsLine: string | null };
    defaults: { footerNote: string | null };
  };
  email: Record<string, EmailEntry>;
}

type EmailKey = "order_confirmation" | "staff_invite" | "report_delivery";
type InvoiceSlotName = "headerNote" | "footerNote" | "termsLine";

const EMAIL_LABELS: Record<EmailKey, { bn: string; en: string; note: string }> = {
  order_confirmation: {
    bn: "অর্ডার নিশ্চিতকরণ",
    en: "Order confirmation",
    note: "অর্ডার নম্বর, মোট টাকা ও পেমেন্ট পদ্ধতির লাইন কোড দিয়েই আসে — শুধু বিষয় ও ভূমিকার লাইন বদলানো যায়।",
  },
  staff_invite: {
    bn: "স্টাফ আমন্ত্রণ",
    en: "Staff invite",
    note: "আমন্ত্রণের লিংক, মেয়াদ ও নিরাপত্তা লাইন কখনো বদলানো যায় না — শুধু বিষয় ও ভূমিকার লাইন বদলানো যায়।",
  },
  report_delivery: {
    bn: "নির্ধারিত রিপোর্ট",
    en: "Scheduled report",
    note: "সময়কাল, সারির সংখ্যা ও CSV সংযুক্তি কোড দিয়েই আসে — শুধু বিষয় ও প্রথম লাইন বদলানো যায়।",
  },
};

const INVOICE_SLOTS: { name: InvoiceSlotName; labelBn: string; labelEn: string; hint: string }[] = [
  {
    name: "headerNote",
    labelBn: "শিরোনাম নোট",
    labelEn: "Header note",
    hint: "ইনভয়েসের শিরোনামের নিচে ছাপা হয়। খালি রাখলে কিছুই ছাপা হয় না।",
  },
  {
    name: "termsLine",
    labelBn: "শর্তাবলীর লাইন",
    labelEn: "Terms line",
    hint: "ইনভয়েসের নিচে, পাদটীকার উপরে ছাপা হয় (যেমন: ফেরতের শর্ত)। খালি রাখলে কিছুই ছাপা হয় না।",
  },
  {
    name: "footerNote",
    labelBn: "পাদটীকা",
    labelEn: "Footer note",
    hint: "ইনভয়েসের সবশেষ লাইন। খালি রাখলে বিল্ট-ইন ধন্যবাদ-লাইনটি ছাপা হয়।",
  },
];

const inputCls =
  "min-h-[44px] w-full rounded-lg border border-border bg-card px-3 text-sm shadow-sm outline-none transition motion-fast focus:border-brand-500 focus:ring-[3px] focus:ring-brand-100";
const areaCls = `${inputCls} py-2 leading-relaxed`;
const primaryBtnCls =
  "rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300";
const ghostBtnCls =
  "rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-text-muted hover:text-text-main disabled:opacity-50";

function errorMessage(body: unknown, fallback: string): string {
  const b = body as { error?: { message?: string } } | null;
  return typeof b?.error?.message === "string" ? b.error.message : fallback;
}

export function TemplatesEditor() {
  const [payload, setPayload] = useState<TemplatesPayload | null>(null);
  const [loadError, setLoadError] = useState("");

  const [invoiceDoc, setInvoiceDoc] = useState<InvoiceDoc | null>(null);
  const [invoiceReason, setInvoiceReason] = useState("");
  const [invoiceStatus, setInvoiceStatus] = useState("");
  const [invoiceOk, setInvoiceOk] = useState(false);
  const [invoiceBusy, setInvoiceBusy] = useState(false);

  const [preview, setPreview] = useState<{ invoice: InvoiceData; sample: boolean } | null>(null);
  const [previewError, setPreviewError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/admin/settings/templates");
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setLoadError(errorMessage(body, "টেমপ্লেট লোড হয়নি।"));
        return;
      }
      const data = (body as { data: TemplatesPayload }).data;
      setPayload(data);
      setInvoiceDoc(data.invoice.doc);
      setLoadError("");
    } catch {
      setLoadError("টেমপ্লেট লোড হয়নি — নেটওয়ার্ক সমস্যা।");
    }
  }, []);

  const loadPreview = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/admin/settings/templates/preview");
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setPreviewError(errorMessage(body, "প্রিভিউ লোড হয়নি।"));
        return;
      }
      const data = (body as { data: { invoice: InvoiceData; sample: boolean } }).data;
      setPreview(data);
      setPreviewError("");
    } catch {
      setPreviewError("প্রিভিউ লোড হয়নি — নেটওয়ার্ক সমস্যা।");
    }
  }, []);

  useEffect(() => {
    void load();
    void loadPreview();
  }, [load, loadPreview]);

  async function saveInvoice() {
    if (invoiceDoc === null) return;
    if (invoiceReason.trim() === "") {
      setInvoiceOk(false);
      setInvoiceStatus("পরিবর্তনের কারণ লিখুন — এটি অডিট লগে সংরক্ষিত থাকে।");
      return;
    }
    setInvoiceBusy(true);
    setInvoiceStatus("");
    try {
      const res = await fetch("/api/v1/admin/settings/templates", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target: "invoice", doc: invoiceDoc, reason: invoiceReason.trim() }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setInvoiceOk(false);
        setInvoiceStatus(errorMessage(body, "সেভ হয়নি।"));
        return;
      }
      setInvoiceOk(true);
      setInvoiceStatus("সেভ হয়েছে — নতুন ইনভয়েসে এই লেখা ছাপা হবে।");
      setInvoiceReason("");
      await load();
      await loadPreview();
    } catch {
      setInvoiceOk(false);
      setInvoiceStatus("সেভ হয়নি — নেটওয়ার্ক সমস্যা।");
    } finally {
      setInvoiceBusy(false);
    }
  }

  async function resetInvoiceSlot(slot: InvoiceSlotName) {
    if (invoiceReason.trim() === "") {
      setInvoiceOk(false);
      setInvoiceStatus("রিসেটের কারণ লিখুন — এটি অডিট লগে সংরক্ষিত থাকে।");
      return;
    }
    setInvoiceBusy(true);
    setInvoiceStatus("");
    try {
      const res = await fetch("/api/v1/admin/settings/templates", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target: "invoice", slot, reason: invoiceReason.trim() }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setInvoiceOk(false);
        setInvoiceStatus(errorMessage(body, "রিসেট হয়নি।"));
        return;
      }
      setInvoiceOk(true);
      setInvoiceStatus("স্লটটি বিল্ট-ইন ডিফল্টে ফিরিয়ে দেওয়া হয়েছে।");
      setInvoiceReason("");
      await load();
      await loadPreview();
    } catch {
      setInvoiceOk(false);
      setInvoiceStatus("রিসেট হয়নি — নেটওয়ার্ক সমস্যা।");
    } finally {
      setInvoiceBusy(false);
    }
  }

  // Resets act on the SAVED document server-side; while the form
  // holds unsaved edits a reset would silently discard them (or
  // dress them up as saved), so resets wait for a clean form.
  const invoiceDirty =
    payload !== null &&
    invoiceDoc !== null &&
    JSON.stringify(invoiceDoc) !== JSON.stringify(payload.invoice.doc);

  if (loadError !== "") {
    return (
      <Card>
        <p role="alert" className="text-sm text-rose-600">{loadError}</p>
      </Card>
    );
  }
  if (payload === null || invoiceDoc === null) {
    return (
      <Card>
        <p className="text-sm text-text-muted">লোড হচ্ছে…</p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------ invoice */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="font-semibold">ইনভয়েস টেমপ্লেট · Invoice</h2>
            <p className="mt-1 text-sm text-text-muted">
              PDF ইনভয়েস ও প্রিন্ট সেন্টার — দুটোতেই একই লেখা ছাপা হয়। প্রতিটি স্লটে বাংলা ও ইংরেজি
              দুটো অংশই দিলে &ldquo;বাংলা / English&rdquo; আকারে ছাপা হয়; একটা দিলে শুধু সেটাই।
            </p>
          </div>
          <Badge tone={payload.invoice.configured ? "success" : "neutral"}>
            {payload.invoice.configured ? "কাস্টম লেখা চালু" : "বিল্ট-ইন লেখা"}
          </Badge>
        </div>

        <div className="mt-5 space-y-6">
          {INVOICE_SLOTS.map((slot) => (
            <fieldset key={slot.name} className="space-y-2">
              <legend className="text-sm font-medium">
                {slot.labelBn} · {slot.labelEn}
              </legend>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="block">
                  <span className="text-xs text-text-muted">বাংলা</span>
                  <textarea
                    className={areaCls}
                    rows={2}
                    maxLength={500}
                    value={invoiceDoc[slot.name].bn}
                    placeholder={
                      slot.name === "footerNote"
                        ? (payload.invoice.defaults.footerNote ?? "").split(" / ")[0] ?? ""
                        : ""
                    }
                    onChange={(e) =>
                      setInvoiceDoc({ ...invoiceDoc, [slot.name]: { ...invoiceDoc[slot.name], bn: e.target.value } })
                    }
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-text-muted">English</span>
                  <textarea
                    className={areaCls}
                    rows={2}
                    maxLength={500}
                    value={invoiceDoc[slot.name].en}
                    placeholder={
                      slot.name === "footerNote"
                        ? (payload.invoice.defaults.footerNote ?? "").split(" / ")[1] ?? ""
                        : ""
                    }
                    onChange={(e) =>
                      setInvoiceDoc({ ...invoiceDoc, [slot.name]: { ...invoiceDoc[slot.name], en: e.target.value } })
                    }
                  />
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-xs text-text-muted">
                  {slot.hint}
                  {invoiceDirty ? " রিসেট করতে আগে সেভ করুন (অসেভ করা বদল আছে)।" : ""}
                </p>
                <button
                  type="button"
                  className={ghostBtnCls}
                  disabled={
                    invoiceBusy ||
                    invoiceDirty ||
                    (payload.invoice.doc[slot.name].bn === "" && payload.invoice.doc[slot.name].en === "")
                  }
                  onClick={() => void resetInvoiceSlot(slot.name)}
                >
                  ডিফল্টে ফেরত
                </button>
              </div>
            </fieldset>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap items-end gap-3 border-t border-border pt-4">
          <label className="block min-w-64 flex-1">
            <span className="text-sm font-medium">পরিবর্তনের কারণ (আবশ্যক)</span>
            <input
              className={inputCls}
              value={invoiceReason}
              onChange={(e) => setInvoiceReason(e.target.value)}
              placeholder="যেমন: ফেরত নীতি বদলেছে"
            />
          </label>
          <button type="button" className={primaryBtnCls} disabled={invoiceBusy} onClick={() => void saveInvoice()}>
            ইনভয়েস টেমপ্লেট সেভ করুন
          </button>
        </div>
        {invoiceStatus !== "" && (
          <p role="status" className={`mt-3 text-sm ${invoiceOk ? "text-emerald-700" : "text-rose-600"}`}>
            {invoiceStatus}
          </p>
        )}
      </Card>

      {/* ------------------------------------------------ preview */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="font-semibold">ইনভয়েস প্রিভিউ · Preview</h2>
            <p className="mt-1 text-sm text-text-muted">
              সেভ করা টেমপ্লেট, সবচেয়ে সাম্প্রতিক আসল অর্ডারের ডেটায় (ফোন মাস্ক করা)। PDF-এ ঠিক
              এই লেখাগুলোই যাবে।
            </p>
          </div>
          <button type="button" className={ghostBtnCls} onClick={() => void loadPreview()}>
            <Icon name="refresh-ccw" size={14} /> রিফ্রেশ
          </button>
        </div>
        {previewError !== "" ? (
          <p role="alert" className="mt-3 text-sm text-rose-600">{previewError}</p>
        ) : preview === null ? (
          <p className="mt-3 text-sm text-text-muted">প্রিভিউ লোড হচ্ছে…</p>
        ) : (
          <InvoicePreview invoice={preview.invoice} sample={preview.sample} />
        )}
      </Card>

      {/* ------------------------------------------------ email */}
      {(Object.keys(EMAIL_LABELS) as EmailKey[]).map((key) => {
        const entry = payload.email[key];
        if (entry === undefined) return null;
        return (
          <EmailTemplateCard
            key={`${key}-${JSON.stringify(entry.doc)}`}
            templateKey={key}
            label={EMAIL_LABELS[key]}
            initial={entry.doc}
            configured={entry.configured}
            placeholders={entry.placeholders}
          />
        );
      })}

      <Card>
        <h2 className="font-semibold">যা এখানে বদলানো যায় না</h2>
        <p className="mt-1 text-sm leading-relaxed text-text-muted">
          দৈনিক ডাইজেস্ট (daily digest) ইমেইলটি কোনো কপি-টেমপ্লেট নয় — এটি দলের দৈনিক হিসাবের
          ডেটা রিপোর্ট, তাই এখানে নেই। এছাড়া কোনো ইমেইলেরই হিসাবের লাইন (মোট টাকা, অর্ডার নম্বর,
          সময়কাল) বা স্টাফ আমন্ত্রণের লিংক ও নিরাপত্তা লাইন এই ডিজাইনার দিয়ে বদলানো যায় না —
          ওগুলো সবসময় সিস্টেমের আসল ডেটা দিয়েই তৈরি হয়।
        </p>
      </Card>
    </div>
  );
}

function InvoicePreview({ invoice, sample }: { invoice: InvoiceData; sample: boolean }) {
  return (
    <div className="mt-4 rounded-lg border border-border bg-white p-5 text-text-main">
      {sample && (
        <p className="mb-3 inline-block rounded-md bg-amber-100 px-2 py-1 text-xs font-bold text-amber-900">
          নমুনা / SAMPLE — দোকানে এখনো কোনো অর্ডার নেই, তাই এটি বানানো নমুনা ডেটা
        </p>
      )}
      <div className="flex flex-wrap items-start justify-between gap-2 border-b-2 border-brand-600 pb-3">
        <div>
          <p className="text-lg font-bold">{invoice.storeName !== "" ? invoice.storeName : "ইনভয়েস"}</p>
          {invoice.storeAddress !== "" && <p className="text-xs text-text-muted">{invoice.storeAddress}</p>}
          {invoice.storeBin !== "" && <p className="text-xs text-text-muted">BIN: {invoice.storeBin}</p>}
        </div>
        <p className="font-semibold text-brand-700">ইনভয়েস / INVOICE</p>
      </div>
      {invoice.headerNote && <p className="mt-2 text-xs text-text-muted">{invoice.headerNote}</p>}
      <div className="mt-3 flex flex-wrap justify-between gap-2 text-sm">
        <p className="font-semibold">অর্ডার / Order: {invoice.orderNo}</p>
        <p className="text-text-muted">
          {invoice.status} · {invoice.paymentMethodLabel} · {invoice.paymentStatus}
        </p>
      </div>
      <div className="mt-2 text-sm leading-relaxed">
        <p className="font-semibold">{invoice.customerName}</p>
        <p>{invoice.customerPhone}</p>
        <p className="text-text-muted">{invoice.addressText}</p>
      </div>
      <table className="mt-4 w-full text-left text-sm">
        <thead>
          <tr className="border-b border-border text-text-muted">
            <th scope="col" className="py-1.5 font-medium">পণ্য / Item</th>
            <th scope="col" className="py-1.5 text-right font-medium">পরিমাণ</th>
            <th scope="col" className="py-1.5 text-right font-medium">মোট</th>
          </tr>
        </thead>
        <tbody>
          {invoice.items.map((item, i) => (
            <tr key={i} className="border-b border-border/60">
              <td className="py-1.5">
                {item.productName} <span className="text-xs text-text-muted">({item.sku})</span>
              </td>
              <td className="py-1.5 text-right tabular-nums">{item.quantity}</td>
              <td className="py-1.5 text-right tabular-nums">{formatBdt(item.lineTotalPoisha)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="ml-auto mt-4 max-w-xs space-y-1 text-sm">
        {invoice.moneyRows.map((row, i) => (
          <div key={i} className={`flex justify-between ${row.emphasis ? "border-t border-border pt-1 font-bold" : ""}`}>
            <dt className="text-text-muted">{row.labelBn} / {row.labelEn}</dt>
            <dd className="tabular-nums">{row.poisha < 0 ? `−${formatBdt(-row.poisha)}` : formatBdt(row.poisha)}</dd>
          </div>
        ))}
      </dl>
      {(invoice.termsLine || invoice.footerNote) && (
        <div className="mt-4 space-y-1 text-xs text-text-muted">
          {invoice.termsLine && <p>{invoice.termsLine}</p>}
          {invoice.footerNote && <p>{invoice.footerNote}</p>}
        </div>
      )}
      {!invoice.footerNote && (
        <p className="mt-4 text-xs text-text-muted">
          (পাদটীকায় বিল্ট-ইন ধন্যবাদ-লাইনটি PDF-এ ছাপা হবে — উপরের ফুটার স্লট খালি আছে।)
        </p>
      )}
    </div>
  );
}

function EmailTemplateCard({
  templateKey,
  label,
  initial,
  configured,
  placeholders,
}: {
  templateKey: EmailKey;
  label: { bn: string; en: string; note: string };
  initial: EmailDoc;
  configured: boolean;
  placeholders: string[];
}) {
  const [doc, setDoc] = useState<EmailDoc>(initial);
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState("");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [savedDoc, setSavedDoc] = useState<EmailDoc>(initial);
  const [isConfigured, setIsConfigured] = useState(configured);
  // Resets act on the saved document; they wait for a clean form
  // (see the invoice section's note).
  const dirty = JSON.stringify(doc) !== JSON.stringify(savedDoc);

  async function save() {
    if (reason.trim() === "") {
      setOk(false);
      setStatus("পরিবর্তনের কারণ লিখুন — এটি অডিট লগে সংরক্ষিত থাকে।");
      return;
    }
    setBusy(true);
    setStatus("");
    try {
      const res = await fetch("/api/v1/admin/settings/templates", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target: "email", key: templateKey, doc, reason: reason.trim() }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setOk(false);
        setStatus(errorMessage(body, "সেভ হয়নি।"));
        return;
      }
      setOk(true);
      setStatus("সেভ হয়েছে — পরের ইমেইলগুলোতে এই লেখা যাবে।");
      setSavedDoc(doc);
      setIsConfigured(
        doc.bn.subject !== "" || doc.bn.intro !== "" || doc.en.subject !== "" || doc.en.intro !== "",
      );
      setReason("");
    } catch {
      setOk(false);
      setStatus("সেভ হয়নি — নেটওয়ার্ক সমস্যা।");
    } finally {
      setBusy(false);
    }
  }

  async function resetField(locale: "bn" | "en", field: "subject" | "intro") {
    if (reason.trim() === "") {
      setOk(false);
      setStatus("রিসেটের কারণ লিখুন — এটি অডিট লগে সংরক্ষিত থাকে।");
      return;
    }
    setBusy(true);
    setStatus("");
    try {
      const res = await fetch("/api/v1/admin/settings/templates", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ target: "email", key: templateKey, locale, field, reason: reason.trim() }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setOk(false);
        setStatus(errorMessage(body, "রিসেট হয়নি।"));
        return;
      }
      const next = { ...doc, [locale]: { ...doc[locale], [field]: "" } };
      setDoc(next);
      setSavedDoc(next);
      setIsConfigured(
        next.bn.subject !== "" || next.bn.intro !== "" || next.en.subject !== "" || next.en.intro !== "",
      );
      setOk(true);
      setStatus("ঘরটি বিল্ট-ইন লেখায় ফিরিয়ে দেওয়া হয়েছে।");
      setReason("");
    } catch {
      setOk(false);
      setStatus("রিসেট হয়নি — নেটওয়ার্ক সমস্যা।");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">
            ইমেইল: {label.bn} · {label.en}
          </h2>
          <p className="mt-1 text-sm text-text-muted">{label.note}</p>
          <p className="mt-1 text-xs text-text-muted">
            ব্যবহারযোগ্য টোকেন: {placeholders.map((p) => `{${p}}`).join("  ")} — অজানা টোকেন যেমন আছে
            তেমনই থেকে যাবে।
            {dirty ? " অসেভ করা বদল আছে — রিসেট করতে আগে সেভ করুন।" : ""}
          </p>
        </div>
        <Badge tone={isConfigured ? "success" : "neutral"}>
          {isConfigured ? "কাস্টম লেখা চালু" : "বিল্ট-ইন লেখা"}
        </Badge>
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-2">
        {(["bn", "en"] as const).map((locale) => (
          <fieldset key={locale} className="space-y-3">
            <legend className="text-sm font-medium">{locale === "bn" ? "বাংলা (bn)" : "English (en)"}</legend>
            <label className="block">
              <span className="text-xs text-text-muted">বিষয় / Subject</span>
              <input
                className={inputCls}
                maxLength={200}
                value={doc[locale].subject}
                onChange={(e) => setDoc({ ...doc, [locale]: { ...doc[locale], subject: e.target.value } })}
              />
            </label>
            <div className="flex justify-end">
              <button
                type="button"
                className={ghostBtnCls}
                disabled={busy || dirty || savedDoc[locale].subject === ""}
                onClick={() => void resetField(locale, "subject")}
              >
                বিষয় ডিফল্টে ফেরত
              </button>
            </div>
            <label className="block">
              <span className="text-xs text-text-muted">ভূমিকা / Intro line</span>
              <textarea
                className={areaCls}
                rows={3}
                maxLength={1000}
                value={doc[locale].intro}
                onChange={(e) => setDoc({ ...doc, [locale]: { ...doc[locale], intro: e.target.value } })}
              />
            </label>
            <div className="flex justify-end">
              <button
                type="button"
                className={ghostBtnCls}
                disabled={busy || dirty || savedDoc[locale].intro === ""}
                onClick={() => void resetField(locale, "intro")}
              >
                ভূমিকা ডিফল্টে ফেরত
              </button>
            </div>
          </fieldset>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-end gap-3 border-t border-border pt-4">
        <label className="block min-w-64 flex-1">
          <span className="text-sm font-medium">পরিবর্তনের কারণ (আবশ্যক)</span>
          <input
            className={inputCls}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="যেমন: নতুন ব্র্যান্ড টোন"
          />
        </label>
        <button type="button" className={primaryBtnCls} disabled={busy} onClick={() => void save()}>
          সেভ করুন
        </button>
      </div>
      {status !== "" && (
        <p role="status" className={`mt-3 text-sm ${ok ? "text-emerald-700" : "text-rose-600"}`}>
          {status}
        </p>
      )}
    </Card>
  );
}
