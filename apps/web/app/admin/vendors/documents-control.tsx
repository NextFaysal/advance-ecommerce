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
  VENDOR_DOCUMENT_KIND_BN,
  VENDOR_DOCUMENT_STATUS_BN,
  type VendorDocumentView,
} from "@/vendors/documents";

export default function VendorDocumentsControl({ vendorId }: { vendorId: string }) {
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
        setError(body.error?.message ?? "কাগজপত্রের তালিকা লোড করা যায়নি।");
        return;
      }
      setDocs(body.data?.documents ?? []);
    } catch {
      setError("কাগজপত্রের তালিকা লোড করা যায়নি।");
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
      if (!res.ok) setError(body.error?.message ?? "কাগজপত্র রেকর্ড করা যায়নি।");
      else {
        setFileName("");
        setNote("");
        await load();
      }
    } catch {
      setError("কাগজপত্র রেকর্ড করা যায়নি।");
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
      if (!res.ok) setError(body.error?.message ?? "অবস্থা আপডেট করা যায়নি।");
      else await load();
    } catch {
      setError("অবস্থা আপডেট করা যায়নি।");
    } finally {
      setBusy(false);
    }
  }

  const inputCls = "rounded-xl border border-border bg-card px-3 py-2 text-sm text-text-main";

  return (
    <div>
      <p className="text-sm font-medium text-text-main">রেকর্ডকৃত কাগজপত্র (মেটাডেটা মাত্র)</p>
      <p className="mt-0.5 text-xs leading-5 text-text-muted">
        ভেন্ডরের কাছ থেকে যেভাবেই পাওয়া হোক (সরাসরি/ইমেইল), কাগজপত্র এখানে রেকর্ড করুন — ভেন্ডর
        পোর্টালে একই তালিকা দেখতে পাবেন। কোনো ফাইল আপলোড হয় না; আপলোডের ব্যবস্থা স্টোরেজ
        কনফিগার হওয়ার পর আসবে।
      </p>
      {error ? (
        <p role="alert" className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}
      {docs.length === 0 ? (
        <p className="mt-2 text-xs text-text-muted">এখনো কোনো কাগজপত্র রেকর্ড করা হয়নি।</p>
      ) : (
        <ul className="mt-2 space-y-1.5 text-sm">
          {docs.map((doc) => (
            <li key={doc.id} className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 text-text-main">
                {VENDOR_DOCUMENT_KIND_BN[doc.kind]} — {doc.fileName}
                <span className="block text-xs text-text-muted">
                  {VENDOR_DOCUMENT_STATUS_BN[doc.status]}
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
                  যাচাই সম্পন্ন
                </button>
                <button
                  type="button"
                  disabled={busy || doc.status === "REJECTED"}
                  onClick={() => void decide(doc, "REJECTED")}
                  className="rounded-lg bg-red-600 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  প্রত্যাখ্যান
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={record} className="mt-3 flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="text-xs font-medium text-text-main">ধরন</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)} className={`mt-1 block ${inputCls}`}>
            <option value="TRADE_LICENSE">ট্রেড লাইসেন্স</option>
            <option value="NID">NID</option>
            <option value="TIN">TIN</option>
            <option value="OTHER">অন্যান্য</option>
          </select>
        </label>
        <label className="block flex-1">
          <span className="text-xs font-medium text-text-main">ফাইলের নাম</span>
          <input
            value={fileName}
            onChange={(e) => setFileName(e.target.value)}
            placeholder="যেমন: trade-license-2026.pdf"
            maxLength={200}
            required
            className={`mt-1 block w-full ${inputCls}`}
          />
        </label>
        <label className="block flex-1">
          <span className="text-xs font-medium text-text-main">নোট (ঐচ্ছিক)</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="যেমন: দোকানে সরাসরি জমা"
            maxLength={500}
            className={`mt-1 block w-full ${inputCls}`}
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded-xl bg-brand-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
        >
          রেকর্ড করুন
        </button>
      </form>
    </div>
  );
}
