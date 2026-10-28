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
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { PRODUCTS_STRINGS } from "./strings";

export function DuplicateProductButton({
  productId,
  productTitle,
  onDuplicated,
}: {
  productId: string;
  productTitle: string;
  onDuplicated?: () => void;
}) {
  const { locale } = useLocale();
  const s = pick(locale, PRODUCTS_STRINGS);
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
      setError(s.netError);
    } finally {
      setBusy(false);
    }
  }

  if (copy) {
    return (
      <Link
        href={`/admin/products/${copy.id}`}
        className="inline-flex min-h-[44px] items-center rounded-xl px-3 text-small font-semibold text-success-solid transition duration-fast ease-smooth hover:bg-success-soft"
        title={interpolate(s.duplicateDoneTitle, { title: copy.title })}
      >
        {s.duplicateDoneLink}
      </Link>
    );
  }
  return (
    <span className="inline-flex flex-col items-end">
      <button
        type="button"
        onClick={() => void duplicate()}
        disabled={busy}
        className="inline-flex min-h-[44px] items-center rounded-xl px-3 text-small font-semibold text-brand-700 transition duration-fast ease-smooth hover:bg-brand-soft disabled:opacity-50"
      >
        {busy ? s.duplicating : s.duplicateBtn}
      </button>
      {error ? (
        <span role="alert" className="max-w-[220px] text-right text-caption text-danger">
          {error}
        </span>
      ) : null}
    </span>
  );
}
