"use client";

/**
 * Staff admin login UI — /admin/login.
 *
 * Flow:
 *  1. POST { identifier, password } to /api/v1/admin/auth/login
 *     (Route Handler to be added with Step 4 completion; it calls
 *     authenticateStaff() from src/lib/auth.ts, enforces the login
 *     rate limit, and sets a httpOnly pending-2FA cookie on needs_2fa.)
 *  2. If needs_2fa: show the 6-digit TOTP step and POST
 *     { code } to /api/v1/admin/auth/verify-2fa, which calls verifyTotp()
 *     and sets the httpOnly admin session cookie on success.
 *  3. On success: redirect to /admin.
 *
 * Security notes shown to staff, and enforced server-side:
 *  - 5 failed logins in 15 minutes locks the account for 30 minutes.
 *  - Error messages are generic on purpose (never "user not found").
 *  - No token, password, or OTP is stored in localStorage/sessionStorage.
 *  - This page uses plain, accessible form controls on purpose — the
 *    Design System (Step 5, another agent's slice) will replace them
 *    with shared components; do not duplicate a design system here.
 */
import { useState } from "react";
import type { FormEvent } from "react";

type Step = "login" | "totp" | "error";

export default function AdminLoginPage() {
  const [step, setStep] = useState<Step>("login");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    try {
      const res = await fetch("/api/v1/admin/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, password }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        data?: { status?: string };
        error?: { message?: string };
      };
      if (!res.ok) {
        setMessage(data.error?.message ?? "Login failed. Please try again.");
        setStep("error");
        return;
      }
      if (data.data?.status === "needs_2fa") {
        setStep("totp");
      } else {
        window.location.href = "/admin";
      }
    } catch {
      setMessage("Network error. Check your connection and try again.");
      setStep("error");
    } finally {
      setLoading(false);
    }
  }

  async function handleTotp(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    try {
      const res = await fetch("/api/v1/admin/auth/verify-2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) {
        setMessage("Invalid code. Please try again.");
        return;
      }
      window.location.href = "/admin";
    } catch {
      setMessage("Network error. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen">
      {/* Brand panel — desktop only */}
      <aside className="brand-gradient relative hidden w-[44%] flex-col justify-between overflow-hidden p-10 text-white lg:flex">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/20 text-xl font-extrabold backdrop-blur">
            A
          </span>
          <span className="text-lg font-bold">Advance Ecommerce</span>
        </div>
        <div>
          <h2 className="max-w-md text-4xl font-extrabold leading-snug">
            আপনার দোকান,
            <br />
            এক ড্যাশবোর্ডেই সব।
          </h2>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-white/85">
            অর্ডার, পেমেন্ট, কুরিয়ার আর কাস্টমার — সবকিছু এক জায়গা থেকে পরিচালনা করুন। ক্যাশ অন ডেলিভারি থেকে bKash অটো-ভেরিফাই পর্যন্ত, বাংলাদেশি ব্যবসার জন্যই তৈরি।
          </p>
          <ul className="mt-8 space-y-2 text-sm text-white/90">
            <li>✓ সারাদেশে কুরিয়ার ট্র্যাকিং</li>
            <li>✓ দৈনিক ক্যাশ ক্লোজিং ও রিপোর্ট</li>
            <li>✓ ফ্রড স্কোরিং ও অটোমেশন</li>
          </ul>
        </div>
        <p className="text-xs text-white/70">© 2026 Advance Ecommerce</p>
      </aside>

      {/* Form panel */}
      <section className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-lg">
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <span className="brand-gradient flex h-10 w-10 items-center justify-center rounded-xl text-lg font-extrabold text-white">
              A
            </span>
            <span className="font-bold text-text-main">Advance Ecommerce</span>
          </div>
          <h1 className="text-2xl font-bold text-text-main">অ্যাডমিন লগইন</h1>
          <p className="mt-1 text-sm text-text-muted">শুধুমাত্র স্টাফদের জন্য। ইমেইল বা ফোন নম্বর ও পাসওয়ার্ড দিয়ে লগইন করুন।</p>

          {step === "login" && (
            <form onSubmit={handleLogin} className="mt-6 space-y-4">
              <div>
                <label htmlFor="identifier" className="mb-1.5 block text-sm font-medium text-text-main">
                  ইমেইল / ফোন
                </label>
                <input
                  id="identifier"
                  type="text"
                  autoComplete="username"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  required
                  className="h-12 w-full rounded-xl border border-border bg-bg-app px-4 text-sm text-text-main outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
                  placeholder="owner@example.com"
                />
              </div>
              <div>
                <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-text-main">
                  পাসওয়ার্ড
                </label>
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  className="h-12 w-full rounded-xl border border-border bg-bg-app px-4 text-sm text-text-main outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
                  placeholder="••••••••"
                />
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-text-muted">
                <input
                  type="checkbox"
                  checked={showPassword}
                  onChange={(e) => setShowPassword(e.target.checked)}
                  className="h-4 w-4 rounded border-border accent-[#4F46E5]"
                />
                পাসওয়ার্ড দেখুন
              </label>
              <button
                type="submit"
                disabled={loading}
                className="brand-gradient h-12 w-full rounded-xl text-sm font-semibold text-white shadow-md transition hover:opacity-90 disabled:opacity-60"
              >
                {loading ? "লগইন হচ্ছে…" : "লগইন"}
              </button>
            </form>
          )}

          {step === "totp" && (
            <form onSubmit={handleTotp} className="mt-6 space-y-4">
              <div>
                <label htmlFor="code" className="mb-1.5 block text-sm font-medium text-text-main">
                  2FA কোড (৬ সংখ্যা, authenticator app থেকে)
                </label>
                <input
                  id="code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  required
                  pattern="\d{6}"
                  className="h-12 w-full rounded-xl border border-border bg-bg-app px-4 text-center text-lg tracking-[0.5em] text-text-main outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
                />
              </div>
              <button
                type="submit"
                disabled={loading || code.length !== 6}
                className="brand-gradient h-12 w-full rounded-xl text-sm font-semibold text-white shadow-md transition hover:opacity-90 disabled:opacity-60"
              >
                {loading ? "যাচাই হচ্ছে…" : "যাচাই করুন"}
              </button>
            </form>
          )}

          {message !== "" && (
            <p role="alert" className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-600">
              {message}
            </p>
          )}
          {step === "error" && (
            <button
              type="button"
              onClick={() => setStep("login")}
              className="mt-3 text-sm font-medium text-brand-600 hover:underline"
            >
              লগইনে ফিরে যান
            </button>
          )}
          <p className="mt-6 border-t border-border pt-4 text-xs leading-relaxed text-text-subtle">
            নিরাপত্তা: ৫ বার ভুল লগইন করলে অ্যাকাউন্ট ৩০ মিনিটের জন্য লক হবে। সন্দেহজনক লগইন হলে অ্যাডমিনকে জানানো হবে।
          </p>
          <p className="mt-3 text-xs text-text-subtle">
            <a href="/" className="font-medium text-brand-600 hover:underline">
              ← দোকানে ফিরে যান
            </a>
          </p>
        </div>
      </section>
    </main>
  );
}
