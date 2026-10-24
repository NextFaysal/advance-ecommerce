"use client";

/**
 * Newsletter subscribe form — homepage section (backlog #3).
 *
 * Posts to POST /api/v1/public/newsletter (no page reload) and renders
 * the outcome inline in Bangla: a fresh subscription and an
 * already-subscribed address get different confirmations; failures
 * show the server's message. The hidden `website` field is a honeypot
 * (see src/newsletter/policy.ts) — humans never see or fill it.
 *
 * HONESTY: until the NewsletterSubscriber table lands, the endpoint
 * answers 503 and this form shows that error — it never displays a
 * success that did not happen.
 */
import { useState, type FormEvent } from "react";
import { NEWSLETTER_HONEYPOT_FIELD } from "../policy";

type FormState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "done"; duplicate: boolean }
  | { kind: "error"; message: string };

export function NewsletterForm({ source = "homepage" }: { source?: string }) {
  const [email, setEmail] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [state, setState] = useState<FormState>({ kind: "idle" });

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.kind === "submitting") return;
    setState({ kind: "submitting" });
    try {
      const res = await fetch("/api/v1/public/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, source, [NEWSLETTER_HONEYPOT_FIELD]: honeypot }),
      });
      const payload: unknown = await res.json().catch(() => null);
      if (res.ok) {
        const duplicate =
          typeof payload === "object" &&
          payload !== null &&
          "data" in payload &&
          typeof (payload as { data: unknown }).data === "object" &&
          (payload as { data: { duplicate?: unknown } }).data?.duplicate === true;
        setState({ kind: "done", duplicate });
        return;
      }
      const message =
        typeof payload === "object" &&
        payload !== null &&
        "error" in payload &&
        typeof (payload as { error: { message?: unknown } }).error?.message === "string"
          ? (payload as { error: { message: string } }).error.message
          : "কিছু সমস্যা হয়েছে — আবার চেষ্টা করুন।";
      setState({ kind: "error", message });
    } catch {
      setState({ kind: "error", message: "ইন্টারনেট সংযোগে সমস্যা — আবার চেষ্টা করুন।" });
    }
  }

  if (state.kind === "done") {
    return (
      <div
        role="status"
        className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm leading-6 text-emerald-900"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="mt-0.5 shrink-0"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="m8.5 12.2 2.4 2.4 4.6-5" />
        </svg>
        <p>
          {state.duplicate ? (
            <>
              <strong>আপনি ইতিমধ্যে সাবস্ক্রাইব করা আছেন।</strong> নতুন অফার আর ফ্ল্যাশ সেলের খবর
              আপনার ইমেইলেই পৌঁছে যাবে।
            </>
          ) : (
            <>
              <strong>ধন্যবাদ — সাবস্ক্রাইব সম্পন্ন হয়েছে!</strong> এখন থেকে নতুন পণ্য, ফ্ল্যাশ সেল
              আর বিশেষ ছাড়ের খবর সবার আগে আপনার ইমেইলে যাবে।
            </>
          )}
        </p>
      </div>
    );
  }

  return (
    <div>
      <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row">
        <label className="sr-only" htmlFor="newsletter-email">
          আপনার ইমেইল
        </label>
        <input
          id="newsletter-email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="আপনার ইমেইল লিখুন"
          className="h-12 min-w-0 flex-1 rounded-xl border border-border bg-surface px-4 text-sm text-text-main shadow-sm outline-none focus:border-brand-500"
        />
        {/* Honeypot — hidden from humans, tempting to bots. */}
        <input
          type="text"
          name={NEWSLETTER_HONEYPOT_FIELD}
          value={honeypot}
          onChange={(e) => setHoneypot(e.target.value)}
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          className="hidden"
        />
        <button
          type="submit"
          disabled={state.kind === "submitting"}
          className="brand-gradient h-12 shrink-0 rounded-xl px-6 text-sm font-bold text-white shadow-md transition hover:opacity-90 disabled:cursor-wait disabled:opacity-70"
        >
          {state.kind === "submitting" ? "অপেক্ষা করুন…" : "সাবস্ক্রাইব করুন"}
        </button>
      </form>
      {state.kind === "error" ? (
        <p role="alert" className="mt-3 text-sm font-medium text-rose-600">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
