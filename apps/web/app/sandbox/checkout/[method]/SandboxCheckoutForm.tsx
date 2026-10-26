"use client";

/**
 * Outcome picker for the sandbox checkout page — doc 21 W0-C (G3-6).
 *
 * A real hosted gateway would collect a PIN/OTP here; the sandbox has
 * nothing to collect, so the tester simply picks the outcome. Both
 * buttons POST to /api/v1/public/payments/sandbox/[method], which
 * completes the attempt through the sandbox gateway's own verify() —
 * this form invents no transition of its own. On any response the page
 * is refreshed so the server component re-reads the attempt's
 * persisted state and renders its terminal panel.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

type FormState =
  | { phase: "idle" }
  | { phase: "submitting"; action: "success" | "fail" }
  | { phase: "error"; message: string };

export default function SandboxCheckoutForm({
  method,
  attemptId,
}: {
  method: string;
  attemptId: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<FormState>({ phase: "idle" });

  async function act(action: "success" | "fail") {
    setState({ phase: "submitting", action });
    try {
      const res = await fetch(`/api/v1/public/payments/sandbox/${encodeURIComponent(method)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ attemptId, action }),
      });
      if (!res.ok) {
        const body: unknown = await res.json().catch(() => ({}));
        const message =
          typeof body === "object" && body !== null && "error" in body
            ? String(
                (body as { error: { message?: string } }).error.message ??
                  "স্যান্ডবক্স পেমেন্ট সম্পন্ন করা যায়নি।",
              )
            : "স্যান্ডবক্স পেমেন্ট সম্পন্ন করা যায়নি।";
        setState({ phase: "error", message });
        return;
      }
      router.refresh();
    } catch {
      setState({ phase: "error", message: "নেটওয়ার্ক সমস্যা — আবার চেষ্টা করুন।" });
    }
  }

  const busy = state.phase === "submitting";

  return (
    <div className="mt-5">
      <p className="text-sm leading-6 text-text-muted">
        আসল গেটওয়েতে এই ধাপে PIN/OTP দিতে হতো। Sandbox-এ শুধু ফলাফলটি বেছে নিন:
      </p>
      <div className="mt-3 grid gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => act("success")}
          className="w-full rounded-lg bg-emerald-600 px-4 py-3 font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
        >
          {busy && state.action === "success" ? "অপেক্ষা করুন…" : "পেমেন্ট সফল করুন (Sandbox)"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => act("fail")}
          className="w-full rounded-lg border border-rose-300 bg-card px-4 py-3 font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
        >
          {busy && state.action === "fail" ? "অপেক্ষা করুন…" : "ব্যর্থ করুন (Sandbox)"}
        </button>
      </div>
      {state.phase === "error" && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.message}
        </p>
      )}
    </div>
  );
}
