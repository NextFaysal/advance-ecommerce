"use client";

// Soft-delete action for the admin product list. Opens the shared
// ui/modal for confirmation — including the reason the sensitive
// products.delete audit requires — then calls
// DELETE /api/v1/admin/products/[id]. On success the server-rendered
// list is refreshed (router.refresh) so the product disappears; on
// failure the server's message is shown inside the modal. Props are
// plain strings only (no function props from the server page).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/modal";
import { useLocale } from "@/i18n/LocaleProvider";
import { pick } from "@/i18n/locale";
import { PRODUCTS_STRINGS } from "./strings";

export function DeleteProductButton({
  productId,
  productTitle,
  onDeleted,
}: {
  productId: string;
  productTitle: string;
  /** Optional: the list is client-fetched now (Wave 13-3), so the
   *  table passes a refetch callback; router.refresh() alone would
   *  leave the deleted row on screen. */
  onDeleted?: () => void;
}) {
  const router = useRouter();
  const { locale } = useLocale();
  const s = pick(locale, PRODUCTS_STRINGS);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function confirmDelete() {
    if (busy) return;
    if (reason.trim() === "") {
      setError(s.deleteReasonRequired);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/admin/products/${encodeURIComponent(productId)}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const body = (await res.json().catch(() => null)) as
        | { error?: { code: string; message: string } }
        | null;
      if (res.ok) {
        setOpen(false);
        setReason("");
        router.refresh();
        onDeleted?.();
      } else {
        setError(body?.error ? `${body.error.code}: ${body.error.message}` : `HTTP ${res.status}`);
      }
    } catch {
      setError(s.netError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-[44px] items-center rounded-xl px-3 text-small font-semibold text-danger transition duration-fast ease-smooth hover:bg-danger-soft"
      >
        {s.deleteBtn}
      </button>
      <Modal
        open={open}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        title={s.deleteTitle}
        onConfirm={() => void confirmDelete()}
      >
        <p className="text-small leading-relaxed">
          <span className="font-medium">{productTitle}</span>{s.deleteBodySuffix}
        </p>
        <label className="mb-1.5 mt-4 block text-small font-medium" htmlFor={`del-reason-${productId}`}>
          {s.deleteReasonLabel}
        </label>
        <input
          id={`del-reason-${productId}`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={s.deleteReasonPh}
          className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm shadow-xs outline-none transition duration-base ease-smooth focus:border-brand-ink focus:ring-[3px] focus:ring-brand-ink/15"
        />
        {error && (
          <p role="alert" className="mt-3 rounded-xl bg-danger-soft px-3 py-2 text-small text-danger">
            {error}
          </p>
        )}
        {busy && <p className="mt-3 text-small text-text-muted">{s.deleting}</p>}
      </Modal>
    </>
  );
}
