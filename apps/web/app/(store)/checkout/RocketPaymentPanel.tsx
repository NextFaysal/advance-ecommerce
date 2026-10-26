"use client";

/**
 * Rocket manual-payment panel — ADV-4 remainder (doc 22).
 *
 * Shown on the checkout confirmation when the order's method is
 * Rocket. Rocket has no hosted checkout: the customer sends money
 * to the merchant Rocket number in their own Rocket app, then
 * submits (TrxID, sender number, amount) here. The submission is a
 * CLAIM — the panel says so plainly: the payment counts only after
 * staff verify the TrxID in Admin > Payments (manual verification,
 * never auto-confirmed). Instructions + merchant number come from
 * GET /api/v1/public/payments/rocket/trx; the submission POSTs to
 * the same route.
 */
import { useEffect, useState } from "react";
import { formatBdt } from "../../../src/checkout/pricing";
import { useDigitText } from "@/components/ui/numerals";

interface RocketConfig {
  configured: boolean;
  merchantNumber: string | null;
  accountName: string | null;
}

type PanelState =
  | { kind: "loading" }
  | { kind: "unconfigured" }
  | { kind: "form"; config: RocketConfig }
  | { kind: "submitting"; config: RocketConfig }
  | { kind: "submitted" }
  | { kind: "error"; config: RocketConfig; message: string };

/** Exact taka string → integer poisha ("250.50" -> 25050). String
 *  math only — a float multiply here could round a customer's
 *  claimed amount into a different one. Null when not an exact
 *  BDT amount. */
function takaToPoisha(value: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const poisha = Number(match[1]) * 100 + (match[2] ? Number(match[2].padEnd(2, "0")) : 0);
  return Number.isSafeInteger(poisha) && poisha > 0 ? poisha : null;
}

function poishaToTakaInput(poisha: number): string {
  const taka = Math.floor(poisha / 100);
  const rest = poisha % 100;
  return rest === 0 ? String(taka) : `${taka}.${String(rest).padStart(2, "0")}`;
}

export default function RocketPaymentPanel({
  orderId,
  totalPoisha,
  customerPhone,
}: {
  orderId: string;
  totalPoisha: number;
  customerPhone: string;
}) {
  const digits = useDigitText();
  const [state, setState] = useState<PanelState>({ kind: "loading" });
  const [trxId, setTrxId] = useState("");
  const [senderPhone, setSenderPhone] = useState(customerPhone);
  const [amountTaka, setAmountTaka] = useState(() => poishaToTakaInput(totalPoisha));

  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/public/payments/rocket/trx")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("config fetch failed"))))
      .then((json: { data?: RocketConfig }) => {
        if (cancelled) return;
        if (json.data?.configured && json.data.merchantNumber) {
          setState({ kind: "form", config: json.data });
        } else {
          setState({ kind: "unconfigured" });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "unconfigured" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(config: RocketConfig) {
    const amountPoisha = takaToPoisha(amountTaka);
    if (trxId.trim().length < 6) {
      setState({ kind: "error", config, message: "সঠিক Rocket TrxID দিন (কমপক্ষে ৬ অক্ষর)।" });
      return;
    }
    if (senderPhone.trim().length < 11) {
      setState({ kind: "error", config, message: "যে নম্বর থেকে টাকা পাঠিয়েছেন, সেটি দিন।" });
      return;
    }
    if (amountPoisha === null) {
      setState({ kind: "error", config, message: "সঠিক পরিমাণ দিন (টাকায়)।" });
      return;
    }
    setState({ kind: "submitting", config });
    try {
      const res = await fetch("/api/v1/public/payments/rocket/trx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          trxId: trxId.trim(),
          senderPhone: senderPhone.trim(),
          amountPoisha,
        }),
      });
      const json = (await res.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      if (!res.ok) {
        setState({
          kind: "error",
          config,
          message:
            json?.error?.message ??
            "জমা দেওয়া যায়নি — আবার চেষ্টা করুন, অথবা আমাদের টিমকে ফোন করুন।",
        });
        return;
      }
      setState({ kind: "submitted" });
    } catch {
      setState({
        kind: "error",
        config,
        message: "নেটওয়ার্ক সমস্যা — জমা পাঠানো যায়নি, আবার চেষ্টা করুন।",
      });
    }
  }

  if (state.kind === "loading") {
    return (
      <div className="mt-4 rounded-xl bg-surface-2 px-4 py-3 text-sm text-text-muted" role="status">
        Rocket পেমেন্টের নির্দেশনা লোড হচ্ছে…
      </div>
    );
  }

  if (state.kind === "unconfigured") {
    return (
      <p role="status" className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm font-medium text-amber-700">
        Rocket পেমেন্টের তথ্য এখন দেখানো যাচ্ছে না — তবে আপনার অর্ডারটি গৃহীত হয়েছে। পেমেন্টের
        জন্য আমাদের টিম ফোনে যোগাযোগ করবে।
      </p>
    );
  }

  if (state.kind === "submitted") {
    return (
      <div className="mt-4 rounded-xl bg-emerald-50 px-4 py-4 text-left" role="status">
        <p className="text-sm font-bold text-emerald-800">✅ আপনার TrxID জমা হয়েছে — যাচাইয়ের অপেক্ষায়</p>
        <p className="mt-1 text-sm leading-6 text-emerald-700">
          আমাদের টিম Rocket লেনদেনটি যাচাই করে পেমেন্ট নিশ্চিত করবে। যাচাই শেষ হলে অর্ডারের
          পেমেন্ট অবস্থা আপডেট হবে — এই জমাটি নিজে থেকে পেমেন্ট নিশ্চিত করে না।
        </p>
      </div>
    );
  }

  const config = state.config;
  const busy = state.kind === "submitting";
  const inputClass =
    "h-11 w-full rounded-[10px] border border-border bg-surface-2 px-3 text-sm outline-none focus:border-brand-500";

  return (
    <div className="mt-4 rounded-xl border border-border bg-card px-4 py-4 text-left">
      <p className="text-sm font-bold text-text-main">🚀 Rocket দিয়ে পরিশোধ করুন (ম্যানুয়াল যাচাই)</p>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-6 text-text-muted">
        <li>
          আপনার Rocket অ্যাপ থেকে এই নম্বরে{" "}
          <strong className="text-text-main">{digits(formatBdt(totalPoisha))}</strong> পাঠান:{" "}
          <strong className="font-mono text-text-main">{config.merchantNumber}</strong>
          {config.accountName ? <span> ({config.accountName})</span> : null}
        </li>
        <li>পাঠানো শেষ হলে নিচে TrxID, প্রেরকের নম্বর ও পরিমাণ জমা দিন।</li>
        <li>আমাদের টিম TrxID যাচাই করে পেমেন্ট নিশ্চিত করবে — জমা দিলেই পেমেন্ট ধরা হয় না।</li>
      </ol>
      <div className="mt-3 grid gap-2.5">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-text-muted">Rocket TrxID</span>
          <input
            value={trxId}
            onChange={(e) => setTrxId(e.target.value)}
            autoComplete="off"
            placeholder="যেমন: 7HXXXXXXX"
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-text-muted">যে নম্বর থেকে পাঠিয়েছেন</span>
          <input
            value={senderPhone}
            onChange={(e) => setSenderPhone(e.target.value)}
            inputMode="tel"
            autoComplete="tel"
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-text-muted">পরিমাণ (টাকা)</span>
          <input
            value={amountTaka}
            onChange={(e) => setAmountTaka(e.target.value)}
            inputMode="decimal"
            className={inputClass}
          />
        </label>
      </div>
      {state.kind === "error" ? (
        <p role="alert" className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
          {state.message}
        </p>
      ) : null}
      <button
        type="button"
        disabled={busy}
        onClick={() => void handleSubmit(config)}
        className="brand-gradient mt-3 flex h-12 w-full items-center justify-center rounded-xl px-5 text-sm font-semibold text-white shadow-md transition hover:opacity-90 disabled:opacity-60"
      >
        {busy ? "জমা হচ্ছে…" : "TrxID জমা দিন"}
      </button>
    </div>
  );
}
