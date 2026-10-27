"use client";

/**
 * Admin vendor KYC control (ADV-13) — per-vendor status select +
 * staff note, saved via PATCH /api/v1/admin/vendors/[id]/kyc.
 * The note is what the vendor sees in their portal; the API
 * requires one for DOCUMENTS_REQUESTED / REJECTED.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { STAFF_KYC_TARGETS, VENDOR_KYC_STATUS_BN, type VendorKycStatus } from "@/vendors/kyc";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { VENDORS_STRINGS } from "./strings";



export default function KycControl({
  vendorId,
  shopName,
  initialStatus,
  initialNote,
}: {
  vendorId: string;
  shopName: string;
  initialStatus: VendorKycStatus;
  initialNote: string | null;
}) {
  const { locale } = useLocale();
  const s = pick(locale, VENDORS_STRINGS);
  const TARGET_LABEL: Record<string, string> = { DOCUMENTS_REQUESTED: s.targetDocs, VERIFIED: s.targetVerified, REJECTED: s.targetRejected };
  const KYC_STATUS_LABEL: Record<string, string> = { NOT_SUBMITTED: s.kycStatusNotSubmitted, PENDING: s.kycStatusPending, DOCUMENTS_REQUESTED: s.kycStatusDocsRequested, VERIFIED: s.kycStatusVerified, REJECTED: s.kycStatusRejected };
  const router = useRouter();
  const [status, setStatus] = useState<VendorKycStatus>(initialStatus);
  const [target, setTarget] = useState<string>("DOCUMENTS_REQUESTED");
  const [note, setNote] = useState(initialNote ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSave() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/v1/admin/vendors/${vendorId}/kyc`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: target, note: note.trim() ? note.trim() : null }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
        data?: { kyc?: { status?: VendorKycStatus } };
      };
      if (!res.ok) {
        setError(body.error?.message ?? s.saveFailed);
        return;
      }
      if (body.data?.kyc?.status) setStatus(body.data.kyc.status);
      setSaved(true);
      router.refresh();
    } catch {
      setError(s.saveFailedConn);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3 shadow-card">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{shopName}</span>
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs">
          {interpolate(s.kycCurrent, { status: locale === "bn" ? (VENDOR_KYC_STATUS_BN[status] ?? status) : (KYC_STATUS_LABEL[status] ?? status) })}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="text-xs text-text-muted">{s.decision}</span>
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="mt-0.5 block rounded-md border border-border bg-card px-2 py-1.5 text-sm"
          >
            {STAFF_KYC_TARGETS.map((t) => (
              <option key={t} value={t}>
                {TARGET_LABEL[t] ?? t}
              </option>
            ))}
          </select>
        </label>
        <label className="block min-w-56 flex-1">
          <span className="text-xs text-text-muted">{s.noteVendorVisible}</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={s.notePlaceholder}
            className="mt-0.5 block w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
          />
        </label>
        <button
          type="button"
          onClick={onSave}
          disabled={busy}
          className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
        >
          {busy ? s.saving : s.save}
        </button>
      </div>
      {error ? <p role="alert" className="mt-2 text-sm text-red-700">{error}</p> : null}
      {saved ? <p role="status" className="mt-2 text-sm text-brand-700">{s.saved}</p> : null}
    </div>
  );
}
