"use client";

// Duplicate action for the admin product list (Wave 13-3). Calls
// POST /api/v1/admin/products/[id]/duplicate — the server copies the
// product as a DRAFT (slug/SKUs suffixed, stock as-is) — and on
// success this leaf turns into a link straight into the copy's edit
// page, so the flow is: see product → কপি → এডিট করুন. Errors surface
// inline next to the button; nothing fails silently. Plain string
// props only — no function props cross the server/client boundary
// (the optional onDuplicated callback is defined inside this client
// tree by the table, which is itself a client component).
import { useState } from "react";
import Link from "next/link";

export function DuplicateProductButton({
  productId,
  productTitle,
  onDuplicated,
}: {
  productId: string;
  productTitle: string;
  onDuplicated?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copy, setCopy] = useState<{ id: string; title: string } | null>(null);

  async function duplicate() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/admin/products/${encodeURIComponent(productId)}/duplicate`, {
        method: "POST",
      });
      const body = (await res.json().catch(() => null)) as
        | {
            data?: { product?: { id: string; title?: { bn?: string } } };
            error?: { code: string; message: string };
          }
        | null;
      const newProduct = body?.data?.product;
      if (res.ok && newProduct?.id) {
        setCopy({ id: newProduct.id, title: newProduct.title?.bn ?? productTitle });
        onDuplicated?.();
      } else {
        setError(body?.error ? `${body.error.code}: ${body.error.message}` : `HTTP ${res.status}`);
      }
    } catch {
      setError("নেটওয়ার্ক সমস্যা — API-তে পৌঁছানো যায়নি।");
    } finally {
      setBusy(false);
    }
  }

  if (copy) {
    return (
      <Link
        href={`/admin/products/${copy.id}`}
        className="inline-flex min-h-[36px] items-center rounded-md px-2.5 text-small font-semibold text-emerald-700 transition motion-fast hover:bg-emerald-50"
        title={`কপি তৈরি হয়েছে: ${copy.title}`}
      >
        কপি এডিট করুন →
      </Link>
    );
  }
  return (
    <span className="inline-flex flex-col items-end">
      <button
        type="button"
        onClick={() => void duplicate()}
        disabled={busy}
        className="inline-flex min-h-[36px] items-center rounded-md px-2.5 text-small font-semibold text-brand-700 transition motion-fast hover:bg-brand-50 disabled:opacity-50"
      >
        {busy ? "কপি হচ্ছে…" : "কপি"}
      </button>
      {error ? (
        <span role="alert" className="max-w-[220px] text-right text-caption text-rose-600">
          {error}
        </span>
      ) : null}
    </span>
  );
}
