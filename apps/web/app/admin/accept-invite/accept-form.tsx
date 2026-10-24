"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Accept-invite form (client). Receives only serializable props from the
 * server page: the raw token (from the link) and the invited identity
 * for display. Submits to POST /api/v1/admin/auth/accept-invite; on
 * success the invitee is sent to /admin/login to sign in normally.
 */
export function AcceptInviteForm({
  token,
  invitedName,
  identifier,
  role,
}: {
  token: string;
  invitedName: string;
  identifier: string;
  role: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(invitedName);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে।");
      return;
    }
    if (password !== confirm) {
      setError("পাসওয়ার্ড দুটি মিলছে না।");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/admin/auth/accept-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, name: name.trim(), password }),
      });
      const json = (await res.json().catch(() => null)) as
        | { data?: { status?: string }; error?: { message?: string } }
        | null;
      if (!res.ok || json?.data?.status !== "accepted") {
        setError(
          json?.error?.message ??
            "আমন্ত্রণ লিংকটি অবৈধ বা এর মেয়াদ শেষ হয়ে গেছে। নতুন লিংকের জন্য অ্যাডমিনের সাথে যোগাযোগ করুন।",
        );
        setSubmitting(false);
        return;
      }
      setDone(true);
      router.push("/admin/login");
    } catch {
      setError("সার্ভারে সংযোগ করা যায়নি। আবার চেষ্টা করুন।");
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div role="status" className="mt-6 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
        অ্যাকাউন্ট সক্রিয় হয়েছে! এখন লগইন পেজে গিয়ে ইমেইল/ফোন ও আপনার নতুন পাসওয়ার্ড দিয়ে লগইন করুন।
      </div>
    );
  }

  const inputClass =
    "h-12 w-full rounded-xl border border-border bg-bg-app px-4 text-sm text-text-main outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30";
  const labelClass = "mb-1.5 block text-sm font-medium text-text-main";

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-4">
      <div>
        <span className={labelClass}>আমন্ত্রিত অ্যাকাউন্ট</span>
        <p className="rounded-xl bg-surface-2 px-4 py-3 text-sm text-text-main">
          {identifier}
          {role ? <span className="text-text-muted"> · ভূমিকা: {role}</span> : null}
        </p>
      </div>
      <div>
        <label htmlFor="accept-name" className={labelClass}>
          আপনার নাম
        </label>
        <input
          id="accept-name"
          type="text"
          required
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
          placeholder="আপনার পুরো নাম"
        />
      </div>
      <div>
        <label htmlFor="accept-password" className={labelClass}>
          নতুন পাসওয়ার্ড (কমপক্ষে ৮ অক্ষর)
        </label>
        <input
          id="accept-password"
          type="password"
          required
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
          placeholder="••••••••"
        />
      </div>
      <div>
        <label htmlFor="accept-confirm" className={labelClass}>
          পাসওয়ার্ড আবার লিখুন
        </label>
        <input
          id="accept-confirm"
          type="password"
          required
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className={inputClass}
          placeholder="••••••••"
        />
      </div>
      {error ? (
        <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-600">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={submitting}
        className="brand-gradient h-12 w-full rounded-xl text-sm font-semibold text-white shadow-md transition hover:opacity-90 disabled:opacity-60"
      >
        {submitting ? "অপেক্ষা করুন…" : "অ্যাকাউন্ট সক্রিয় করুন"}
      </button>
    </form>
  );
}
