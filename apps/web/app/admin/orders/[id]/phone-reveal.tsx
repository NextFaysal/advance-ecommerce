"use client";

/**
 * Audited phone reveal for the order detail page (doc 17, O6-2).
 *
 * Delivered UNMOUNTED — the parent mounts it on the detail page in
 * place of the plain masked phone text. It renders the masked
 * number plus a reveal button; the full number comes only from
 * GET /api/v1/admin/orders/[id]/phone, which requires the
 * customers.view_full_phone permission and writes an
 * orders.phone_view audit row before answering. Without the
 * permission the endpoint 403s and this component keeps showing the
 * masked text with a short note — it never holds or guesses a full
 * number itself.
 */
import { useState } from "react";
import { pick } from "../../../../src/i18n/locale";
import { useLocale } from "../../../../src/i18n/LocaleProvider";
import { ORDER_STRINGS } from "../strings";

type RevealState =
  | { kind: "masked" }
  | { kind: "loading" }
  | { kind: "revealed"; phone: string }
  | { kind: "denied" }
  | { kind: "error" };

export function PhoneReveal({
  orderId,
  maskedPhone,
}: {
  orderId: string;
  maskedPhone: string;
}) {
  const { locale, t } = useLocale();
  const s = pick(locale, ORDER_STRINGS);
  const [state, setState] = useState<RevealState>({ kind: "masked" });

  async function reveal() {
    setState({ kind: "loading" });
    try {
      const res = await fetch(`/api/v1/admin/orders/${orderId}/phone`);
      if (res.status === 403) {
        setState({ kind: "denied" });
        return;
      }
      if (!res.ok) {
        setState({ kind: "error" });
        return;
      }
      const body = (await res.json().catch(() => null)) as { data?: { phone?: string } } | null;
      if (body?.data?.phone) {
        setState({ kind: "revealed", phone: body.data.phone });
      } else {
        setState({ kind: "error" });
      }
    } catch {
      setState({ kind: "error" });
    }
  }

  if (state.kind === "revealed") {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <span className="font-mono tabular-nums">{state.phone}</span>
        <span className="text-caption text-text-subtle">{s.phoneAudited}</span>
      </span>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="font-mono tabular-nums">{maskedPhone}</span>
      <button
        type="button"
        onClick={() => void reveal()}
        disabled={state.kind === "loading"}
        className="rounded-md border border-border bg-card px-2 py-1 text-caption font-semibold text-brand-700 transition motion-fast hover:border-brand-300 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
      >
        {state.kind === "loading" ? t.loading : s.phoneShow}
      </button>
      {state.kind === "denied" && (
        <span className="text-caption text-text-subtle">{s.phoneNoPermission}</span>
      )}
      {state.kind === "error" && (
        <span className="text-caption text-danger">{s.phoneLoadFailed}</span>
      )}
    </span>
  );
}
