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
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function confirmDelete() {
    if (busy) return;
    if (reason.trim() === "") {
      setError("মুছে ফেলার কারণ লিখুন — এটি অডিট লগে সংরক্ষিত থাকে।");
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
      setError("নেটওয়ার্ক সমস্যা — API-তে পৌঁছানো যায়নি।");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-[36px] items-center rounded-md px-2.5 text-small font-semibold text-rose-600 transition motion-fast hover:bg-rose-50"
      >
        মুছুন
      </button>
      <Modal
        open={open}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        title="পণ্য মুছে ফেলুন"
        onConfirm={() => void confirmDelete()}
      >
        <p className="text-small leading-relaxed">
          <span className="font-medium">{productTitle}</span> — এই পণ্যটি সফট-ডিলিট হবে: স্টোরফ্রন্ট ও
          সার্চ থেকে সরে যাবে এবং এর ভ্যারিয়েন্টগুলো আর অর্ডার করা যাবে না। পুরনো অর্ডারের ইতিহাসে
          তথ্য থেকে যাবে (হার্ড ডিলিট হয় না)।
        </p>
        <label className="mb-1.5 mt-4 block text-small font-medium" htmlFor={`del-reason-${productId}`}>
          মুছে ফেলার কারণ (আবশ্যক)
        </label>
        <input
          id={`del-reason-${productId}`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="যেমন: পণ্য বন্ধ হয়ে গেছে"
          className="h-11 w-full rounded-md border border-border bg-card px-3 text-sm shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        />
        {error && (
          <p role="alert" className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-small text-rose-700">
            {error}
          </p>
        )}
        {busy && <p className="mt-3 text-small text-text-muted">মুছে ফেলা হচ্ছে…</p>}
      </Modal>
    </>
  );
}
