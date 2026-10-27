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
import { useLocale } from "@/i18n/LocaleProvider";
import { pick } from "@/i18n/locale";
import { SETTINGS_B_STRINGS, type SettingsBStrings } from "../strings-b";

type SKey = keyof SettingsBStrings;
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

const EMAIL_LABELS: Record<EmailKey, { bn: string; en: string; noteKey: SKey }> = {
  order_confirmation: { bn: "অর্ডার নিশ্চিতকরণ", en: "Order confirmation", noteKey: "tplOrderConfNote" },
  staff_invite: { bn: "স্টাফ আমন্ত্রণ", en: "Staff invite", noteKey: "tplStaffInviteNote" },
  report_delivery: { bn: "নির্ধারিত রিপোর্ট", en: "Scheduled report", noteKey: "tplReportNote" },
};

const INVOICE_SLOTS: { name: InvoiceSlotName; labelKey: SKey; hintKey: SKey }[] = [
  { name: "headerNote", labelKey: "tplHeaderNote", hintKey: "tplHeaderHint" },
  { name: "termsLine", labelKey: "tplTermsLine", hintKey: "tplTermsHint" },
  { name: "footerNote", labelKey: "tplFooterNote", hintKey: "tplFooterHint" },
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
  const { locale } = useLocale();
  const s = pick(locale, SETTINGS_B_STRINGS);
  const isBn = locale === "bn";
  const [payload, setPayload] = useState<TemplatesPayload | null>(null);
  const [loadError, setLoadError] = useState("");

  const [invoiceDoc, setInvoiceDoc] = useState<InvoiceDoc | null>(null);
  const [invoiceReason, setInvoiceReason] = useState("");
  const [invoiceStatus, setInvoiceStatus] = useState("");
  const [invoiceOk, setInvoiceOk] = useState(false);
  const [invoiceBusy, setInvoiceBusy] = useState(false);

  const [preview, setPreview] = useState<{ invoice: InvoiceData; sample: boolean } | null>(null);
  const [previewError, setPreviewError] = useState("");

  const sRef = { current: s };
  sRef.current = s;
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/admin/settings/templates");
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setLoadError(errorMessage(body, sRef.current.tplLoadFailed));
        return;
      }
      const data = (body as { data: TemplatesPayload }).data;
      setPayload(data);
      setInvoiceDoc(data.invoice.doc);
      setLoadError("");
    } catch {
      setLoadError(sRef.current.tplLoadNetwork);
    }
  }, []);

  const loadPreview = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/admin/settings/templates/preview");
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setPreviewError(errorMessage(body, sRef.current.tplPreviewFailed));
        return;
      }
      const data = (body as { data: { invoice: InvoiceData; sample: boolean } }).data;
      setPreview(data);
      setPreviewError("");
    } catch {
      setPreviewError(sRef.current.tplPreviewNetwork);
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
      setInvoiceStatus(s.tplReasonRequired);
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
        setInvoiceStatus(errorMessage(body, s.tplSaveFailed));
        return;
      }
      setInvoiceOk(true);
      setInvoiceStatus(s.tplInvoiceSaved);
      setInvoiceReason("");
      await load();
      await loadPreview();
    } catch {
      setInvoiceOk(false);
      setInvoiceStatus(s.tplSaveNetwork);
    } finally {
      setInvoiceBusy(false);
    }
  }

  async function resetInvoiceSlot(slot: InvoiceSlotName) {
    if (invoiceReason.trim() === "") {
      setInvoiceOk(false);
      setInvoiceStatus(s.tplResetReasonRequired);
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
        setInvoiceStatus(errorMessage(body, s.tplResetFailed));
        return;
      }
      setInvoiceOk(true);
      setInvoiceStatus(s.tplSlotReset);
      setInvoiceReason("");
      await load();
      await loadPreview();
    } catch {
      setInvoiceOk(false);
      setInvoiceStatus(s.tplResetNetwork);
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
        <p className="text-sm text-text-muted">{s.tplLoading}</p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------ invoice */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="font-semibold">{s.tplInvoiceTitle}</h2>
            <p className="mt-1 text-sm text-text-muted">{s.tplInvoiceDesc}</p>
          </div>
          <Badge tone={payload.invoice.configured ? "success" : "neutral"}>
            {payload.invoice.configured ? s.configuredCustom : s.builtInCopy}
          </Badge>
        </div>

        <div className="mt-5 space-y-6">
          {INVOICE_SLOTS.map((slot) => (
            <fieldset key={slot.name} className="space-y-2">
              <legend className="text-sm font-medium">{s[slot.labelKey]}</legend>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="block">
                  <span className="text-xs text-text-muted">{s.tplBnLabel}</span>
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
                  <span className="text-xs text-text-muted">{s.tplEnLabel}</span>
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
                  {s[slot.hintKey]}
                  {invoiceDirty ? s.tplResetFirstSave : ""}
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
                  {s.tplResetDefault}
                </button>
              </div>
            </fieldset>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap items-end gap-3 border-t border-border pt-4">
          <label className="block min-w-64 flex-1">
            <span className="text-sm font-medium">{s.tplReasonLabel}</span>
            <input
              className={inputCls}
              value={invoiceReason}
              onChange={(e) => setInvoiceReason(e.target.value)}
              placeholder={s.tplReasonPlaceholder}
            />
          </label>
          <button type="button" className={primaryBtnCls} disabled={invoiceBusy} onClick={() => void saveInvoice()}>
            {s.tplSaveInvoice}
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
            <h2 className="font-semibold">{s.tplPreviewTitle}</h2>
            <p className="mt-1 text-sm text-text-muted">{s.tplPreviewDesc}</p>
          </div>
          <button type="button" className={ghostBtnCls} onClick={() => void loadPreview()}>
            <Icon name="refresh-ccw" size={14} /> {s.tplRefresh}
          </button>
        </div>
        {previewError !== "" ? (
          <p role="alert" className="mt-3 text-sm text-rose-600">{previewError}</p>
        ) : preview === null ? (
          <p className="mt-3 text-sm text-text-muted">{s.tplPreviewLoading}</p>
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
        <h2 className="font-semibold">{s.tplNotEditableTitle}</h2>
        <p className="mt-1 text-sm leading-relaxed text-text-muted">{s.tplNotEditableBody}</p>
      </Card>
    </div>
  );
}

function InvoicePreview({ invoice, sample }: { invoice: InvoiceData; sample: boolean }) {
  const { locale } = useLocale();
  const s = pick(locale, SETTINGS_B_STRINGS);
  const isBn = locale === "bn";
  return (
    <div className="mt-4 rounded-lg border border-border bg-white p-5 text-text-main">
      {sample && (
        <p className="mb-3 inline-block rounded-md bg-amber-100 px-2 py-1 text-xs font-bold text-amber-900">
          {s.tplSample}
        </p>
      )}
      <div className="flex flex-wrap items-start justify-between gap-2 border-b-2 border-brand-600 pb-3">
        <div>
          <p className="text-lg font-bold">{invoice.storeName !== "" ? invoice.storeName : s.tplInvoiceWord}</p>
          {invoice.storeAddress !== "" && <p className="text-xs text-text-muted">{invoice.storeAddress}</p>}
          {invoice.storeBin !== "" && <p className="text-xs text-text-muted">BIN: {invoice.storeBin}</p>}
        </div>
        <p className="font-semibold text-brand-700">{s.tplInvoiceSlash}</p>
      </div>
      {invoice.headerNote && <p className="mt-2 text-xs text-text-muted">{invoice.headerNote}</p>}
      <div className="mt-3 flex flex-wrap justify-between gap-2 text-sm">
        <p className="font-semibold">{s.tplOrderWord}: {invoice.orderNo}</p>
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
            <th scope="col" className="py-1.5 font-medium">{s.tplColItem}</th>
            <th scope="col" className="py-1.5 text-right font-medium">{s.tplColQty}</th>
            <th scope="col" className="py-1.5 text-right font-medium">{s.tplColTotal}</th>
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
            <dt className="text-text-muted">{isBn ? row.labelBn : row.labelEn}</dt>
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
        <p className="mt-4 text-xs text-text-muted">{s.tplFooterFallback}</p>
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
  label: { bn: string; en: string; noteKey: SKey };
  initial: EmailDoc;
  configured: boolean;
  placeholders: string[];
}) {
  const { locale } = useLocale();
  const s = pick(locale, SETTINGS_B_STRINGS);
  const isBn = locale === "bn";
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
      setStatus(s.tplReasonRequired);
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
        setStatus(errorMessage(body, s.tplSaveFailed));
        return;
      }
      setOk(true);
      setStatus(s.tplEmailSaved);
      setSavedDoc(doc);
      setIsConfigured(
        doc.bn.subject !== "" || doc.bn.intro !== "" || doc.en.subject !== "" || doc.en.intro !== "",
      );
      setReason("");
    } catch {
      setOk(false);
      setStatus(s.tplSaveNetwork);
    } finally {
      setBusy(false);
    }
  }

  async function resetField(locale: "bn" | "en", field: "subject" | "intro") {
    if (reason.trim() === "") {
      setOk(false);
      setStatus(s.tplResetReasonRequired);
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
        setStatus(errorMessage(body, s.tplResetFailed));
        return;
      }
      const next = { ...doc, [locale]: { ...doc[locale], [field]: "" } };
      setDoc(next);
      setSavedDoc(next);
      setIsConfigured(
        next.bn.subject !== "" || next.bn.intro !== "" || next.en.subject !== "" || next.en.intro !== "",
      );
      setOk(true);
      setStatus(s.tplFieldReset);
      setReason("");
    } catch {
      setOk(false);
      setStatus(s.tplResetNetwork);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">
            {s.tplEmailPrefix} {isBn ? label.bn : label.en}
          </h2>
          <p className="mt-1 text-sm text-text-muted">{s[label.noteKey]}</p>
          <p className="mt-1 text-xs text-text-muted">
            {s.tplTokensPrefix}
            {placeholders.map((p) => `{${p}}`).join("  ")}
            {s.tplTokensSuffix}
            {dirty ? s.tplDirtyNote : ""}
          </p>
        </div>
        <Badge tone={isConfigured ? "success" : "neutral"}>
          {isConfigured ? s.configuredCustom : s.builtInCopy}
        </Badge>
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-2">
        {(["bn", "en"] as const).map((locale) => (
          <fieldset key={locale} className="space-y-3">
            <legend className="text-sm font-medium">{locale === "bn" ? s.tplBnLegend : s.tplEnLegend}</legend>
            <label className="block">
              <span className="text-xs text-text-muted">{s.tplSubjectLabel}</span>
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
                {s.tplSubjectReset}
              </button>
            </div>
            <label className="block">
              <span className="text-xs text-text-muted">{s.tplIntroLabel}</span>
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
                {s.tplIntroReset}
              </button>
            </div>
          </fieldset>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-end gap-3 border-t border-border pt-4">
        <label className="block min-w-64 flex-1">
          <span className="text-sm font-medium">{s.tplReasonLabel}</span>
          <input
            className={inputCls}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={s.tplEmailReasonPlaceholder}
          />
        </label>
        <button type="button" className={primaryBtnCls} disabled={busy} onClick={() => void save()}>
          {s.save}
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
