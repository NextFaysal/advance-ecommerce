"use client";

/**
 * Vendor KYC documents control (schema wave 2) — per-vendor, inside
 * the admin vendors page KYC section. Staff RECORD documents the
 * store received out-of-band (kind + file name + optional note) and
 * verify / reject them; the vendor sees the same records in their
 * portal. Metadata only — no file upload exists behind this panel
 * (upload stays disabled until storage + an upload endpoint exist).
 */
import { useCallback, useEffect, useState } from "react";
import {
  vendorDocumentKindLabel,
  vendorDocumentStatusLabel,
  type VendorDocumentView,
} from "@/vendors/documents";
import { useLocale } from "@/i18n/LocaleProvider";
import { pick } from "@/i18n/locale";
import { VENDORS_STRINGS } from "./strings";

export default function VendorDocumentsControl({ vendorId }: { vendorId: string }) {
  const { locale } = useLocale();
  const s = pick(locale, VENDORS_STRINGS);
  const [docs, setDocs] = useState<VendorDocumentView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState("TRADE_LICENSE");
  const [fileName, setFileName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/admin/vendors/${vendorId}/documents`);
      const body = (await res.json().catch(() => ({}))) as {
        data?: { documents?: VendorDocumentView[] };
        error?: { message?: string };
      };
      if (!res.ok) {
        setError(body.error?.message ?? s.docsLoadFailed);
        return;
      }
      setDocs(body.data?.documents ?? []);
    } catch {
      setError(s.docsLoadFailed);
    }
  }, [vendorId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function record(e: React.FormEvent) {
    e.preventDefault();
    if (!fileName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/admin/vendors/${vendorId}/documents`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, fileName: fileName.trim(), note: note.trim() || undefined }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!res.ok) setError(body.error?.message ?? s.docsRecordFailed);
      else {
        setFileName("");
        setNote("");
        await load();
      }
    } catch {
      setError(s.docsRecordFailed);
    } finally {
      setBusy(false);
    }
  }

  async function decide(doc: VendorDocumentView, status: "VERIFIED" | "REJECTED" | "PENDING") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/admin/vendors/${vendorId}/documents`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ documentId: doc.id, status }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!res.ok) setError(body.error?.message ?? s.docsUpdateFailed);
      else await load();
    } catch {
      setError(s.docsUpdateFailed);
    } finally {
      setBusy(false);
    }
  }

  const inputCls = "rounded-xl border border-border bg-card px-3 py-2 text-sm text-text-main";

  return (
    <div>
      <p className="text-sm font-medium text-text-main">{s.docsTitle}</p>
      <p className="mt-0.5 text-xs leading-5 text-text-muted">
        {s.docsDesc}
      </p>
      {error ? (
        <p role="alert" className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}
      {docs.length === 0 ? (
        <p className="mt-2 text-xs text-text-muted">{s.noDocs}</p>
      ) : (
        <ul className="mt-2 space-y-1.5 text-sm">
          {docs.map((doc) => (
            <li key={doc.id} className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 text-text-main">
                {vendorDocumentKindLabel(doc.kind, locale)} — {doc.fileName}
                <span className="block text-xs text-text-muted">
                  {vendorDocumentStatusLabel(doc.status, locale)}
                  {doc.note ? ` · ${doc.note}` : ""}
                </span>
              </span>
              <span className="flex shrink-0 gap-1.5">
                <button
                  type="button"
                  disabled={busy || doc.status === "VERIFIED"}
                  onClick={() => void decide(doc, "VERIFIED")}
                  className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {s.verify}
                </button>
                <button
                  type="button"
                  disabled={busy || doc.status === "REJECTED"}
                  onClick={() => void decide(doc, "REJECTED")}
                  className="rounded-lg bg-red-600 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {s.reject}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={record} className="mt-3 flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="text-xs font-medium text-text-main">{s.kindLabel}</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)} className={`mt-1 block ${inputCls}`}>
            <option value="TRADE_LICENSE">{s.kindTrade}</option>
            <option value="NID">NID</option>
            <option value="TIN">TIN</option>
            <option value="OTHER">{s.kindOther}</option>
          </select>
        </label>
        <label className="block flex-1">
          <span className="text-xs font-medium text-text-main">{s.fileNameLabel}</span>
          <input
            value={fileName}
            onChange={(e) => setFileName(e.target.value)}
            placeholder={s.fileNamePlaceholder}
            maxLength={200}
            required
            className={`mt-1 block w-full ${inputCls}`}
          />
        </label>
        <label className="block flex-1">
          <span className="text-xs font-medium text-text-main">{s.noteOptional}</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={s.notePlaceholderDoc}
            maxLength={500}
            className={`mt-1 block w-full ${inputCls}`}
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded-xl bg-brand-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
        >
          {s.recordBtn}
        </button>
      </form>
    </div>
  );
}
