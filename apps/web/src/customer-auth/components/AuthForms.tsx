"use client";

/**
 * Login + registration forms for /account (logged-out state).
 * Plain controlled forms posting to /api/v1/public/account/{login,register};
 * on success the server page re-renders in the logged-in state via
 * router.refresh(). Errors shown are the API's generic messages — the
 * API never reveals whether a phone number is registered.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

const inputCls =
  "h-12 w-full rounded-xl border border-border bg-bg-app px-4 text-sm text-text-main outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30";
const labelCls = "mb-1.5 block text-sm font-medium text-text-main";

async function postJson(path: string, payload: unknown): Promise<{ ok: boolean; message?: string }> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) return { ok: true };
    const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    return { ok: false, message: json?.error?.message ?? "কিছু একটা সমস্যা হয়েছে। আবার চেষ্টা করুন।" };
  } catch {
    return { ok: false, message: "ইন্টারনেট সংযোগে সমস্যা হয়েছে। আবার চেষ্টা করুন।" };
  }
}

export default function AuthForms() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const result =
      mode === "login"
        ? await postJson("/api/v1/public/account/login", { phone, password })
        : await postJson("/api/v1/public/account/register", { name, phone, email, password });
    setBusy(false);
    if (result.ok) {
      router.refresh();
    } else {
      setError(result.message ?? "আবার চেষ্টা করুন।");
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-card">
      <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1" role="tablist" aria-label="লগইন বা নতুন অ্যাকাউন্ট">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "login"}
          onClick={() => { setMode("login"); setError(null); }}
          className={`h-11 rounded-lg text-sm font-semibold transition ${mode === "login" ? "bg-card text-text-main shadow-sm" : "text-text-muted"}`}
        >
          লগইন
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "register"}
          onClick={() => { setMode("register"); setError(null); }}
          className={`h-11 rounded-lg text-sm font-semibold transition ${mode === "register" ? "bg-card text-text-main shadow-sm" : "text-text-muted"}`}
        >
          নতুন অ্যাকাউন্ট
        </button>
      </div>

      <form onSubmit={submit} className="space-y-4">
        {mode === "register" ? (
          <div>
            <label className={labelCls} htmlFor="acc-name">আপনার নাম *</label>
            <input id="acc-name" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" placeholder="যেমন: মোঃ রফিকুল ইসলাম" />
          </div>
        ) : null}
        <div>
          <label className={labelCls} htmlFor="acc-phone">মোবাইল নম্বর *</label>
          <input id="acc-phone" className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} required type="tel" inputMode="tel" autoComplete="tel" placeholder="01XXXXXXXXX" />
          {mode === "register" ? (
            <p className="mt-1.5 text-xs leading-5 text-text-muted">
              আগে এই নম্বর দিয়ে অতিথি হিসেবে অর্ডার করে থাকলে, সেই অর্ডারগুলো এই অ্যাকাউন্টেই দেখা যাবে।
            </p>
          ) : null}
        </div>
        {mode === "register" ? (
          <div>
            <label className={labelCls} htmlFor="acc-email">ইমেইল (ঐচ্ছিক)</label>
            <input id="acc-email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" placeholder="you@example.com" />
          </div>
        ) : null}
        <div>
          <label className={labelCls} htmlFor="acc-password">পাসওয়ার্ড *</label>
          <input id="acc-password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} required type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder={mode === "register" ? "অন্তত ৮ অক্ষর" : "আপনার পাসওয়ার্ড"} />
        </div>

        {error ? (
          <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-600">{error}</p>
        ) : null}

        <button
          type="submit"
          disabled={busy}
          className="brand-gradient h-12 w-full rounded-xl text-sm font-semibold text-white shadow-md transition hover:opacity-90 disabled:opacity-60"
        >
          {busy ? "অপেক্ষা করুন…" : mode === "login" ? "লগইন করুন" : "অ্যাকাউন্ট তৈরি করুন"}
        </button>
      </form>

      <p className="mt-4 text-xs leading-5 text-text-muted">
        পাসওয়ার্ড ভুলে গেলে এই মুহূর্তে নিজে নিজে রিসেট করার ব্যবস্থা নেই — সহায়তার জন্য{" "}
        <a href="/contact" className="font-semibold text-brand-700 hover:underline">যোগাযোগ</a> পেজে লিখুন।
      </p>
    </div>
  );
}
