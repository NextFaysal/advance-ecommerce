"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { ACCEPT_INVITE_STRINGS } from "./strings";

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
  const { locale } = useLocale();
  const s = pick(locale, ACCEPT_INVITE_STRINGS);
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
      setError(s.errPasswordShort);
      return;
    }
    if (password !== confirm) {
      setError(s.errPasswordMismatch);
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
            s.invalidLink,
        );
        setSubmitting(false);
        return;
      }
      setDone(true);
      router.push("/admin/login");
    } catch {
      setError(s.errNetwork);
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div role="status" className="mt-6 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
        {s.doneText}
      </div>
    );
  }

  const inputClass =
    "h-12 w-full rounded-xl border border-border bg-bg-app px-4 text-sm text-text-main outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30";
  const labelClass = "mb-1.5 block text-sm font-medium text-text-main";

  return (
    <form onSubmit={handleSubmit} className="mt-6 space-y-4">
      <div>
        <span className={labelClass}>{s.invitedAccount}</span>
        <p className="rounded-xl bg-surface-2 px-4 py-3 text-sm text-text-main">
          {identifier}
          {role ? <span className="text-text-muted"> · {interpolate(s.roleLabel, { role })}</span> : null}
        </p>
      </div>
      <div>
        <label htmlFor="accept-name" className={labelClass}>
          {s.yourName}
        </label>
        <input
          id="accept-name"
          type="text"
          required
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
          placeholder={s.namePlaceholder}
        />
      </div>
      <div>
        <label htmlFor="accept-password" className={labelClass}>
          {s.newPassword}
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
          {s.confirmPassword}
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
        {submitting ? s.submitting : s.submit}
      </button>
    </form>
  );
}
