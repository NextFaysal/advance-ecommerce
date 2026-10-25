"use client";

/**
 * Pay button/form for /pay/[token] — Agent 19. Client component.
 * Submits to POST /api/v1/public/pay/[token], which starts a SANDBOX
 * payment only. The result panel says so plainly: no real money moves.
 */
import { useState } from "react";

type PayState =
  | { phase: "idle" }
  | { phase: "submitting" }
  | { phase: "sandbox"; redirectUrl: string; method: string }
  | { phase: "error"; message: string };

const METHODS = [
  { key: "bkash", label: "বিকাশ" },
  { key: "nagad", label: "নগদ" },
  { key: "sslcommerz", label: "কার্ড / SSLCommerz" },
] as const;

export default function PayForm({ token }: { token: string }) {
  const [method, setMethod] = useState<string>("bkash");
  const [phone, setPhone] = useState("");
  const [state, setState] = useState<PayState>({ phase: "idle" });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState({ phase: "submitting" });
    try {
      const res = await fetch(`/api/v1/public/pay/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method, phone }),
      });
      const body: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message =
          typeof body === "object" && body !== null && "error" in body
            ? String((body as { error: { message?: string } }).error.message ?? "পেমেন্ট শুরু করা যায়নি।")
            : "পেমেন্ট শুরু করা যায়নি।";
        setState({ phase: "error", message });
        return;
      }
      const data = (body as { data: { redirectUrl: string; method: string } }).data;
      setState({ phase: "sandbox", redirectUrl: data.redirectUrl, method: data.method });
    } catch {
      setState({ phase: "error", message: "নেটওয়ার্ক সমস্যা — আবার চেষ্টা করুন।" });
    }
  }

  return (
    <form onSubmit={submit} className="mt-5">
      <fieldset>
        <legend className="text-sm font-semibold">পেমেন্ট মাধ্যম বেছে নিন</legend>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {METHODS.map((m) => (
            <label
              key={m.key}
              className={`cursor-pointer rounded-lg border px-2 py-2.5 text-center text-sm transition ${
                method === m.key
                  ? "border-brand-600 bg-brand-50 font-semibold text-brand-700 ring-1 ring-brand-600"
                  : "border-border bg-card text-text-main hover:border-brand-300"
              }`}
            >
              <input
                type="radio"
                name="method"
                value={m.key}
                checked={method === m.key}
                onChange={() => setMethod(m.key)}
                className="sr-only"
              />
              {m.label}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="mt-4 block text-sm font-semibold" htmlFor="pay-phone">
        মোবাইল নম্বর
      </label>
      <input
        id="pay-phone"
        inputMode="tel"
        autoComplete="tel"
        placeholder="01XXXXXXXXX"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-text-main"
        required
      />

      <button
        type="submit"
        disabled={state.phase === "submitting"}
        className="mt-4 w-full rounded-lg bg-brand-600 px-4 py-3 font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
      >
        {state.phase === "submitting" ? "অপেক্ষা করুন…" : "পেমেন্ট করুন"}
      </button>

      {state.phase === "error" && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.message}
        </p>
      )}
      {state.phase === "sandbox" && (
        <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <p className="font-semibold">স্যান্ডবক্স সিমুলেশন</p>
          <p className="mt-1 break-all">
            এটি টেস্ট পেমেন্ট — আসল টাকা কাটা হয়নি। সিমুলেটেড চেকআউট: {state.redirectUrl} ({state.method})
          </p>
        </div>
      )}
    </form>
  );
}
