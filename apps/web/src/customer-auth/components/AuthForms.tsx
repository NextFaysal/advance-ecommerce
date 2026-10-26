"use client";

/**
 * Login + registration forms for /account (logged-out state).
 *
 * Sign-in methods (doc 22 ADV-15, spec §1):
 *  - OTP is PRIMARY: phone → 6-digit code → session. A first-time
 *    phone creates the account at verify (registration-by-OTP); the
 *    API's delivery meta is surfaced honestly — "queued" is shown as
 *    queued, and when the SMS resolver reports the sandbox fallback
 *    the form says no real SMS was sent (ডেমো মোড).
 *  - Password stays as the secondary method (and the only
 *    registration form — it claims the guest row for the phone).
 *  - Google renders ONLY when the server says it is configured
 *    (googleEnabled prop from the /account server page) — an
 *    unconfigured install shows no dead button.
 *  - Facebook likewise (facebookEnabled prop) — it needs its own
 *    Meta app credentials (auth.facebook.* in Settings), separate
 *    from any Page/WhatsApp configuration.
 * Errors shown are the API's generic messages — the API never
 * reveals whether a phone number is registered.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

const inputCls =
  "h-12 w-full rounded-xl border border-border bg-bg-app px-4 text-sm text-text-main outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30";
const labelCls = "mb-1.5 block text-sm font-medium text-text-main";

interface ApiResult {
  ok: boolean;
  message?: string;
  data?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  details?: Record<string, unknown>;
}

async function postJsonDetailed(path: string, payload: unknown): Promise<ApiResult> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await res.json().catch(() => null)) as {
      data?: Record<string, unknown>;
      meta?: Record<string, unknown>;
      error?: { message?: string; details?: Record<string, unknown> };
    } | null;
    if (res.ok) return { ok: true, data: json?.data, meta: json?.meta };
    return {
      ok: false,
      message: json?.error?.message ?? "কিছু একটা সমস্যা হয়েছে। আবার চেষ্টা করুন।",
      details: json?.error?.details,
    };
  } catch {
    return { ok: false, message: "ইন্টারনেট সংযোগে সমস্যা হয়েছে। আবার চেষ্টা করুন।" };
  }
}

async function postJson(path: string, payload: unknown): Promise<{ ok: boolean; message?: string }> {
  const r = await postJsonDetailed(path, payload);
  return { ok: r.ok, message: r.message };
}

export default function AuthForms({
  googleEnabled = false,
  facebookEnabled = false,
}: {
  googleEnabled?: boolean;
  facebookEnabled?: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [method, setMethod] = useState<"otp" | "password">("otp");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // OTP flow state.
  const [otpStep, setOtpStep] = useState<"phone" | "code">("phone");
  const [otpCode, setOtpCode] = useState("");
  const [otpNotice, setOtpNotice] = useState<string | null>(null);
  const [otpSimulated, setOtpSimulated] = useState(false);

  async function submitPassword(e: React.FormEvent) {
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

  async function requestOtp() {
    setError(null);
    setOtpNotice(null);
    setBusy(true);
    const result = await postJsonDetailed("/api/v1/public/account/auth/otp/request", { phone });
    setBusy(false);
    if (!result.ok) {
      setError(result.message ?? "কোড পাঠানো যায়নি। আবার চেষ্টা করুন।");
      return;
    }
    if (result.data?.sent !== true) {
      setError("এই মুহূর্তে কোড পাঠানো যাচ্ছে না। কিছুক্ষণ পরে আবার চেষ্টা করুন।");
      return;
    }
    // Honest delivery state from the API meta: the code is QUEUED,
    // and in simulated mode no real SMS leaves the platform at all.
    setOtpSimulated(result.meta?.deliveryMode === "simulated");
    setOtpNotice("কোড পাঠানোর অনুরোধ কিউতে দেওয়া হয়েছে। ৬ সংখ্যার কোডটি ১০ মিনিট বৈধ।");
    setOtpCode("");
    setOtpStep("code");
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const result = await postJsonDetailed("/api/v1/public/account/auth/otp/verify", {
      phone,
      code: otpCode,
    });
    setBusy(false);
    if (result.ok) {
      router.refresh();
      return;
    }
    const left = result.details?.attemptsLeft;
    setError(
      typeof left === "number"
        ? `${result.message ?? "কোডটি সঠিক নয়।"} (আর ${left}বার চেষ্টা বাকি)`
        : (result.message ?? "কোডটি সঠিক নয়। আবার চেষ্টা করুন।"),
    );
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

      {mode === "login" ? (
        <>
          <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1" role="tablist" aria-label="লগইনের মাধ্যম">
            <button
              type="button"
              role="tab"
              aria-selected={method === "otp"}
              onClick={() => { setMethod("otp"); setError(null); }}
              className={`h-10 rounded-lg text-sm font-semibold transition ${method === "otp" ? "bg-card text-text-main shadow-sm" : "text-text-muted"}`}
            >
              মোবাইল OTP
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={method === "password"}
              onClick={() => { setMethod("password"); setError(null); }}
              className={`h-10 rounded-lg text-sm font-semibold transition ${method === "password" ? "bg-card text-text-main shadow-sm" : "text-text-muted"}`}
            >
              পাসওয়ার্ড
            </button>
          </div>

          {method === "otp" ? (
            <div className="space-y-4">
              <div>
                <label className={labelCls} htmlFor="acc-phone-otp">মোবাইল নম্বর *</label>
                <input
                  id="acc-phone-otp"
                  className={inputCls}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="01XXXXXXXXX"
                  disabled={otpStep === "code"}
                />
                <p className="mt-1.5 text-xs leading-5 text-text-muted">
                  এই নম্বরে আগে অ্যাকাউন্ট না থাকলে কোড যাচাইয়ের সময়ই নতুন অ্যাকাউন্ট তৈরি হয়ে যাবে।
                  আগে অতিথি হিসেবে অর্ডার করে থাকলে সেগুলোও এই অ্যাকাউন্টে দেখা যাবে।
                </p>
              </div>

              {otpStep === "code" ? (
                <form onSubmit={verifyOtp} className="space-y-4">
                  <div>
                    <label className={labelCls} htmlFor="acc-otp-code">৬ সংখ্যার কোড *</label>
                    <input
                      id="acc-otp-code"
                      className={inputCls}
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/[^\d]/g, "").slice(0, 6))}
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="------"
                      required
                    />
                  </div>
                  {otpNotice ? (
                    <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">{otpNotice}</p>
                  ) : null}
                  {otpSimulated ? (
                    <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm font-medium text-amber-700">
                      ডেমো মোড: SMS গেটওয়ে সেটআপ হয়নি — আসল SMS পাঠানো হয়নি, কোডটি শুধু কিউতে আছে।
                    </p>
                  ) : null}
                  {error ? (
                    <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-600">{error}</p>
                  ) : null}
                  <button
                    type="submit"
                    disabled={busy || otpCode.length !== 6}
                    className="brand-gradient h-12 w-full rounded-xl text-sm font-semibold text-white shadow-md transition hover:opacity-90 disabled:opacity-60"
                  >
                    {busy ? "অপেক্ষা করুন…" : "কোড যাচাই করে লগইন করুন"}
                  </button>
                  <div className="flex items-center justify-between text-sm">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => { setOtpStep("phone"); setError(null); setOtpNotice(null); }}
                      className="font-semibold text-brand-700 hover:underline disabled:opacity-60"
                    >
                      নম্বর বদলান
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={requestOtp}
                      className="font-semibold text-brand-700 hover:underline disabled:opacity-60"
                    >
                      আবার কোড পাঠান
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  {error ? (
                    <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-600">{error}</p>
                  ) : null}
                  <button
                    type="button"
                    disabled={busy || phone.trim() === ""}
                    onClick={requestOtp}
                    className="brand-gradient h-12 w-full rounded-xl text-sm font-semibold text-white shadow-md transition hover:opacity-90 disabled:opacity-60"
                  >
                    {busy ? "অপেক্ষা করুন…" : "OTP কোড পাঠান"}
                  </button>
                </>
              )}
            </div>
          ) : (
            <form onSubmit={submitPassword} className="space-y-4">
              <div>
                <label className={labelCls} htmlFor="acc-phone">মোবাইল নম্বর *</label>
                <input id="acc-phone" className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} required type="tel" inputMode="tel" autoComplete="tel" placeholder="01XXXXXXXXX" />
              </div>
              <div>
                <label className={labelCls} htmlFor="acc-password">পাসওয়ার্ড *</label>
                <input id="acc-password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} required type="password" autoComplete="current-password" placeholder="আপনার পাসওয়ার্ড" />
              </div>
              {error ? (
                <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-600">{error}</p>
              ) : null}
              <button
                type="submit"
                disabled={busy}
                className="brand-gradient h-12 w-full rounded-xl text-sm font-semibold text-white shadow-md transition hover:opacity-90 disabled:opacity-60"
              >
                {busy ? "অপেক্ষা করুন…" : "লগইন করুন"}
              </button>
            </form>
          )}

          {googleEnabled || facebookEnabled ? (
            <>
              <div className="my-5 flex items-center gap-3 text-xs font-medium text-text-muted">
                <span className="h-px flex-1 bg-border" />
                অথবা
                <span className="h-px flex-1 bg-border" />
              </div>
              <div className="space-y-3">
                {googleEnabled ? (
                  <a
                    href="/api/v1/public/account/auth/google/start"
                    className="flex h-12 w-full items-center justify-center gap-2.5 rounded-xl border border-border bg-card text-sm font-semibold text-text-main shadow-sm transition hover:bg-surface-2"
                  >
                    <span aria-hidden="true" className="text-base font-bold text-brand-700">G</span>
                    Google দিয়ে লগইন করুন
                  </a>
                ) : null}
                {facebookEnabled ? (
                  <a
                    href="/api/v1/public/account/auth/facebook/start"
                    className="flex h-12 w-full items-center justify-center gap-2.5 rounded-xl border border-border bg-card text-sm font-semibold text-text-main shadow-sm transition hover:bg-surface-2"
                  >
                    <span aria-hidden="true" className="text-base font-bold" style={{ color: "#1877F2" }}>f</span>
                    Facebook দিয়ে লগইন করুন
                  </a>
                ) : null}
              </div>
            </>
          ) : null}
        </>
      ) : (
        <form onSubmit={submitPassword} className="space-y-4">
          <div>
            <label className={labelCls} htmlFor="acc-name">আপনার নাম *</label>
            <input id="acc-name" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" placeholder="যেমন: মোঃ রফিকুল ইসলাম" />
          </div>
          <div>
            <label className={labelCls} htmlFor="acc-phone-reg">মোবাইল নম্বর *</label>
            <input id="acc-phone-reg" className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} required type="tel" inputMode="tel" autoComplete="tel" placeholder="01XXXXXXXXX" />
            <p className="mt-1.5 text-xs leading-5 text-text-muted">
              আগে এই নম্বর দিয়ে অতিথি হিসেবে অর্ডার করে থাকলে, সেই অর্ডারগুলো এই অ্যাকাউন্টেই দেখা যাবে।
            </p>
          </div>
          <div>
            <label className={labelCls} htmlFor="acc-email">ইমেইল (ঐচ্ছিক)</label>
            <input id="acc-email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" placeholder="you@example.com" />
          </div>
          <div>
            <label className={labelCls} htmlFor="acc-password-reg">পাসওয়ার্ড *</label>
            <input id="acc-password-reg" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} required type="password" autoComplete="new-password" placeholder="অন্তত ৮ অক্ষর" />
          </div>

          {error ? (
            <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-600">{error}</p>
          ) : null}

          <button
            type="submit"
            disabled={busy}
            className="brand-gradient h-12 w-full rounded-xl text-sm font-semibold text-white shadow-md transition hover:opacity-90 disabled:opacity-60"
          >
            {busy ? "অপেক্ষা করুন…" : "অ্যাকাউন্ট তৈরি করুন"}
          </button>
          <p className="text-xs leading-5 text-text-muted">
            পাসওয়ার্ড ছাড়া অ্যাকাউন্ট চাইলে <span className="font-semibold text-text-main">লগইন</span> ট্যাব থেকে
            মোবাইল OTP দিয়ে ঢুকুন — প্রথমবারেই অ্যাকাউন্ট তৈরি হয়ে যাবে।
          </p>
        </form>
      )}

      <p className="mt-4 text-xs leading-5 text-text-muted">
        পাসওয়ার্ড ভুলে গেলে মোবাইল OTP দিয়ে লগইন করুন — একই অ্যাকাউন্টেই ঢুকতে পারবেন।
        সহায়তার জন্য <a href="/contact" className="font-semibold text-brand-700 hover:underline">যোগাযোগ</a> পেজে লিখুন।
      </p>
    </div>
  );
}
