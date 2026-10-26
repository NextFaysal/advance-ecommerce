"use client";
/**
 * Buyer actions on a SENT quotation (ADV-14): Accept → the portal API
 * flips SENT → ACCEPTED and runs the wave-27 conversion service, so a
 * credit refusal comes back as the service's own 409 message and is
 * shown verbatim; Decline → SENT → REJECTED. On a successful accept
 * the created order number is shown with a track link, and the page
 * refreshes so the quotation reads CONVERTED and the order appears in
 * the orders section.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function QuotationActions({ quotationId }: { quotationId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acceptedOrderNo, setAcceptedOrderNo] = useState<string | null>(null);

  async function act(kind: "accept" | "decline") {
    setBusy(kind);
    setError(null);
    try {
      const res = await fetch(
        `/api/v1/public/account/b2b/quotations/${encodeURIComponent(quotationId)}/${kind}`,
        { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      );
      const payload = (await res.json().catch(() => null)) as
        | { data?: { orderNo?: string }; error?: { message?: string } }
        | null;
      if (!res.ok) {
        setError(payload?.error?.message ?? "কিছু একটা সমস্যা হয়েছে — আবার চেষ্টা করুন।");
        return;
      }
      if (kind === "accept" && payload?.data?.orderNo) {
        setAcceptedOrderNo(payload.data.orderNo);
      }
      router.refresh();
    } catch {
      setError("নেটওয়ার্ক সমস্যা — আবার চেষ্টা করুন।");
    } finally {
      setBusy(null);
    }
  }

  if (acceptedOrderNo) {
    return (
      <p className="text-sm leading-6 text-text-main" role="status">
        ✅ অর্ডার তৈরি হয়েছে:{" "}
        <a
          href={`/track?orderNo=${encodeURIComponent(acceptedOrderNo)}`}
          className="font-semibold text-brand-700 hover:underline"
        >
          {acceptedOrderNo}
        </a>{" "}
        — পেমেন্ট আপনার B2B অ্যাকাউন্টের শর্ত অনুযায়ী বকেয়া থাকবে।
      </p>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => act("accept")}
          disabled={busy !== null}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {busy === "accept" ? "অর্ডার তৈরি হচ্ছে…" : "গ্রহণ করুন — অর্ডার তৈরি করুন"}
        </button>
        <button
          type="button"
          onClick={() => act("decline")}
          disabled={busy !== null}
          className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-text-main hover:bg-surface-2 disabled:opacity-60"
        >
          {busy === "decline" ? "প্রত্যাখ্যান হচ্ছে…" : "প্রত্যাখ্যান করুন"}
        </button>
      </div>
      {error ? (
        <p className="mt-2 text-sm leading-6 text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
