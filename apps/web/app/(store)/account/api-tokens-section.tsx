"use client";

/**
 * API টোকেন card for /account (customer API tokens — the bearer
 * auth seam in src/customer-auth/api-tokens.ts).
 *
 * Self-fetching like the downloads section: the list comes from GET
 * /api/v1/public/account/api-tokens (hash-free views — a stored
 * token can never be shown again), creating POSTs the same route,
 * revoking POSTs …/api-tokens/[id]/revoke. All three are
 * cookie-session only on the server, which is what this page's
 * browser session provides.
 *
 * The plaintext token appears EXACTLY ONCE — in the amber box right
 * after creation — and is dropped from component state the moment
 * the customer dismisses it ("সংরক্ষণ করেছি"). A reload can never
 * show it again; the copy says so before the customer creates one.
 *
 * Unlike the downloads section this card ALWAYS renders, even with
 * zero tokens: it is an action surface (creating the first token is
 * the whole point), not a record list.
 */
import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/ui/icon";

interface ApiTokenView {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  status: "active" | "revoked";
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("bn-BD", { dateStyle: "medium" }).format(new Date(iso));
}

export default function ApiTokensSection() {
  const [tokens, setTokens] = useState<ApiTokenView[] | null>(null);
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/public/account/api-tokens");
      const json = (await res.json()) as { data?: { tokens: ApiTokenView[] } };
      setTokens(json.data?.tokens ?? []);
    } catch {
      setTokens([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const activeCount = tokens?.filter((t) => t.status === "active").length ?? 0;

  async function create() {
    const trimmed = label.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    setError(null);
    setFlash(null);
    try {
      const res = await fetch("/api/v1/public/account/api-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: trimmed }),
      });
      const json = (await res.json()) as {
        data?: { token?: string };
        error?: { message?: string };
      };
      if (!res.ok || !json.data?.token) {
        setError(json.error?.message ?? "টোকেন তৈরি করা যায়নি।");
        return;
      }
      setFreshToken(json.data.token);
      setCopied(false);
      setLabel("");
      await load();
    } catch {
      setError("টোকেন তৈরি করা যায়নি — সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।");
    } finally {
      setCreating(false);
    }
  }

  async function copyFreshToken() {
    if (freshToken === null) return;
    try {
      await navigator.clipboard.writeText(freshToken);
      setCopied(true);
    } catch {
      // Clipboard can be unavailable (permissions / insecure context):
      // the token stays visible for manual copy — no fake success.
    }
  }

  async function revoke(id: string) {
    setRevokingId(id);
    setError(null);
    setFlash(null);
    try {
      const res = await fetch(`/api/v1/public/account/api-tokens/${id}/revoke`, {
        method: "POST",
      });
      const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!res.ok) {
        setError(json.error?.message ?? "টোকেন বাতিল করা যায়নি।");
        return;
      }
      setFlash("টোকেনটি বাতিল করা হয়েছে — এটি দিয়ে আর লগইন করা যাবে না।");
      setConfirmRevokeId(null);
      await load();
    } catch {
      setError("টোকেন বাতিল করা যায়নি — সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।");
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <section
      className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-card"
      aria-label="API টোকেন"
    >
      <h2 className="flex items-center gap-2.5 text-base font-bold text-text-main">
        <span
          aria-hidden="true"
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white"
        >
          <Icon name="shield" size={18} />
        </span>
        API টোকেন
      </h2>
      <p className="mt-1.5 text-sm leading-6 text-text-muted">
        মোবাইল অ্যাপ ও নিজের তৈরি ইন্টিগ্রেশনের জন্য টোকেন ব্যবহার করুন — অ্যাপটি এই টোকেন দিয়ে
        আপনার হয়ে অর্ডার ও অ্যাকাউন্টের তথ্য দেখতে পারে, ব্রাউজারে লগইন না করেই। টোকেন
        পাসওয়ার্ডের মতোই গোপন রাখুন; কোনো টোকেন হারালে বা সন্দেহ হলে সঙ্গে সঙ্গে বাতিল করে দিন —
        বাতিল করা টোকেন দিয়ে আর প্রবেশ করা যাবে না।
      </p>

      {flash !== null ? (
        <p className="mt-3 rounded-lg bg-brand-50 px-3.5 py-2.5 text-sm leading-6 text-brand-700">
          {flash}
        </p>
      ) : null}
      {error !== null ? (
        <p role="alert" className="mt-3 rounded-lg bg-rose-50 px-3.5 py-2.5 text-sm leading-6 text-rose-600">
          {error}
        </p>
      ) : null}

      {freshToken !== null ? (
        <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3.5">
          <p className="text-sm font-semibold text-amber-800">
            আপনার নতুন টোকেন — এখনই সংরক্ষণ করুন
          </p>
          <p className="mt-1 text-xs leading-5 text-amber-700">
            এই টোকেনটি শুধু একবারই দেখানো হবে। পেজটি বন্ধ বা রিলোড করলে এটি আর দেখা যাবে না —
            হারিয়ে ফেললে বাতিল করে নতুন টোকেন তৈরি করুন।
          </p>
          <p className="mt-2.5 break-all rounded-lg bg-white/70 px-3 py-2 font-mono text-sm text-text-main">
            {freshToken}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void copyFreshToken()}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
            >
              {copied ? "কপি হয়েছে ✓" : "টোকেনটি কপি করুন"}
            </button>
            <button
              type="button"
              onClick={() => {
                setFreshToken(null);
                setCopied(false);
              }}
              className="rounded-lg border border-amber-300 bg-white/60 px-4 py-2 text-sm font-semibold text-amber-800 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
            >
              সংরক্ষণ করেছি
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <label className="min-w-52 flex-1">
          <span className="text-xs font-medium text-text-muted">
            নতুন টোকেনের নাম (যেমন: আমার ফোনের অ্যাপ)
          </span>
          <input
            type="text"
            maxLength={60}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="টোকেনের নাম"
            className="mt-1 w-full rounded-md border border-border bg-card px-2.5 py-2 text-sm text-text-main"
          />
        </label>
        <button
          type="button"
          disabled={creating || label.trim() === ""}
          onClick={() => void create()}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
        >
          {creating ? "তৈরি হচ্ছে…" : "নতুন টোকেন তৈরি করুন"}
        </button>
      </div>
      <p className="mt-1.5 text-xs leading-5 text-text-subtle">
        একসঙ্গে সর্বোচ্চ ১০টি সক্রিয় টোকেন রাখা যায় (এখন সক্রিয়: {activeCount}টি)।
      </p>

      {tokens === null ? (
        <p className="mt-4 text-sm text-text-muted">টোকেনের তালিকা লোড হচ্ছে…</p>
      ) : tokens.length === 0 ? (
        <p className="mt-4 text-sm leading-6 text-text-muted">
          এখনো কোনো টোকেন তৈরি করেননি। অ্যাপ বা ইন্টিগ্রেশনে ব্যবহারের প্রয়োজন হলেই কেবল টোকেন
          তৈরি করুন।
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {tokens.map((t) => (
            <li key={t.id} className="rounded-xl border border-border px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-text-main">{t.label}</p>
                  <p className="mt-1 text-xs leading-5 text-text-muted">
                    তৈরি: {formatDate(t.createdAt)} ·{" "}
                    {t.lastUsedAt
                      ? `সর্বশেষ ব্যবহার: ${formatDate(t.lastUsedAt)}`
                      : "এখনো ব্যবহার হয়নি"}
                    {t.revokedAt ? ` · বাতিল: ${formatDate(t.revokedAt)}` : ""}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
                    t.status === "active"
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-red-50 text-red-700"
                  }`}
                >
                  {t.status === "active" ? "সক্রিয়" : "বাতিল"}
                </span>
              </div>
              {t.status === "active" ? (
                <div className="mt-2.5">
                  {confirmRevokeId === t.id ? (
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium text-text-main">
                        নিশ্চিত তো? এই টোকেন ব্যবহারকারী অ্যাপটি সঙ্গে সঙ্গে বন্ধ হয়ে যাবে।
                      </span>
                      <button
                        type="button"
                        disabled={revokingId === t.id}
                        onClick={() => void revoke(t.id)}
                        className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
                      >
                        {revokingId === t.id ? "বাতিল হচ্ছে…" : "হ্যাঁ, বাতিল করুন"}
                      </button>
                      <button
                        type="button"
                        disabled={revokingId === t.id}
                        onClick={() => setConfirmRevokeId(null)}
                        className="rounded-lg border border-border px-3 py-1.5 text-sm font-semibold text-text-main hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                      >
                        ফিরে যান
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmRevokeId(t.id)}
                      className="rounded-lg border border-border px-3 py-1.5 text-sm font-semibold text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                    >
                      টোকেন বাতিল করুন
                    </button>
                  )}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
