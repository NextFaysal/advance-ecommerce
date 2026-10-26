"use client";

/**
 * Privacy & data section on /account (ADV-29): data export download
 * + account deletion (anonymisation) with a fresh proof of control.
 *
 * The proof flow mirrors the API contract of
 * POST /api/v1/public/account/delete:
 *   password account → re-enter the password here
 *   OTP account      → "কোড পাঠান" issues a fresh sign-in code to
 *                      the account phone, then the code is entered
 *   Google-only      → type the account email (placeholder phone —
 *                      no SMS can ever reach it)
 * The retention explanation above the confirm checkbox is the
 * informed-consent copy: orders stay for accounting (with the
 * name/address snapshot inside each order record), everything
 * personal on the profile is anonymised or deleted. On success the
 * server has already deleted every session and cleared the cookie;
 * the browser just leaves for the homepage.
 */
import { useState } from "react";
import { Icon } from "@/components/ui/icon";

export type DeleteProofKind = "password" | "otp" | "email";

interface PrivacySectionProps {
  proofKind: DeleteProofKind;
  phoneMasked: string;
  email: string | null;
}

type Stage = "idle" | "confirm" | "otp-sent" | "done";

interface ApiError {
  error?: { code?: string; message?: string };
  data?: { proofRequired?: string; deleted?: boolean };
}

export default function PrivacySection({ proofKind, phoneMasked, email }: PrivacySectionProps) {
  const [stage, setStage] = useState<Stage>("idle");
  const [understood, setUnderstood] = useState(false);
  const [password, setPassword] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [emailConfirm, setEmailConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [messageOk, setMessageOk] = useState(false);

  function fail(text: string) {
    setMessageOk(false);
    setMessage(text);
  }

  async function postDelete(body: Record<string, unknown>): Promise<ApiError | null> {
    const res = await fetch("/api/v1/public/account/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await res.json().catch(() => null)) as ApiError | null;
  }

  async function handleRequestOtp() {
    setMessage("");
    setBusy(true);
    try {
      const data = await postDelete({ confirm: true });
      if (data?.data?.proofRequired === "otp") {
        setStage("otp-sent");
        setMessageOk(true);
        setMessage(
          `${phoneMasked} নম্বরে একটি কোড পাঠানো হয়েছে (কিউতে আছে — SMS ওয়ার্কার চালু থাকলে পৌঁছাবে)। কোডটি দিয়ে নিশ্চিত করুন।`,
        );
      } else {
        fail(data?.error?.message ?? "কোড পাঠানো যায়নি — আবার চেষ্টা করুন।");
      }
    } catch {
      fail("সার্ভারের সঙ্গে যোগাযোগ করা যায়নি — আবার চেষ্টা করুন।");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setMessage("");
    if (!understood) {
      fail("আগে নিচের বাক্সে টিক দিয়ে নিশ্চিত করুন যে আপনি পরিণতি বুঝেছেন।");
      return;
    }
    const body: Record<string, unknown> = { confirm: true };
    if (proofKind === "password") {
      if (password === "") return fail("বর্তমান পাসওয়ার্ড দিন।");
      body.password = password;
    } else if (proofKind === "otp") {
      if (!/^\d{6}$/.test(otpCode)) return fail("৬ সংখ্যার কোডটি দিন।");
      body.otpCode = otpCode;
    } else {
      if (emailConfirm.trim() === "") return fail("অ্যাকাউন্টের ইমেইলটি হুবহু লিখুন।");
      body.emailConfirm = emailConfirm.trim();
    }
    setBusy(true);
    try {
      const data = await postDelete(body);
      if (data?.data?.deleted) {
        setStage("done");
        setMessageOk(true);
        setMessage("অ্যাকাউন্ট মুছে ফেলা হয়েছে। হোমপেজে নিয়ে যাওয়া হচ্ছে…");
        window.setTimeout(() => {
          window.location.href = "/";
        }, 1800);
      } else {
        fail(data?.error?.message ?? "মুছে ফেলা যায়নি — আবার চেষ্টা করুন।");
      }
    } catch {
      fail("সার্ভারের সঙ্গে যোগাযোগ করা যায়নি — মুছে ফেলা হয়েছে কিনা নিশ্চিত নয়; আবার লগইন করে যাচাই করুন।");
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "mt-1 block min-h-[44px] w-full max-w-md rounded-lg border border-border bg-card px-3 text-sm shadow-sm outline-none transition focus:border-brand-500 focus:ring-[3px] focus:ring-brand-100";

  return (
    <section
      className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-card"
      aria-label="গোপনীয়তা ও ডেটা"
    >
      <h2 className="flex items-center gap-2.5 text-base font-bold text-text-main">
        <span
          aria-hidden="true"
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white"
        >
          <Icon name="shield" size={18} />
        </span>
        গোপনীয়তা ও আমার ডেটা
      </h2>

      <div className="mt-4">
        <h3 className="text-sm font-bold text-text-main">আমার ডেটা ডাউনলোড করুন</h3>
        <p className="mt-1 text-sm leading-6 text-text-muted">
          প্রোফাইল, ঠিকানা, অর্ডার, রিভিউ, সাপোর্ট টিকিট ও লয়্যাল্টি পয়েন্টসহ আমাদের কাছে থাকা
          আপনার সব তথ্যের একটি JSON কপি ডাউনলোড করুন। প্রতিটি অংশে উৎস (কোন টেবিল থেকে এসেছে)
          উল্লেখ থাকে। উইশলিস্ট শুধু আপনার ব্রাউজারেই থাকে — সার্ভারে তার কোনো কপি নেই।
        </p>
        <a
          href="/api/v1/public/account/data-export"
          className="mt-3 inline-block rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-semibold text-text-main transition hover:bg-surface-2"
        >
          ডেটা এক্সপোর্ট ডাউনলোড করুন (JSON)
        </a>
      </div>

      <div className="mt-6 border-t border-border pt-5">
        <h3 className="text-sm font-bold text-rose-700">অ্যাকাউন্ট মুছে ফেলুন</h3>
        <p className="mt-1 text-sm leading-6 text-text-muted">
          মুছে ফেললে আপনার নাম, ফোন, ইমেইল ও পাসওয়ার্ড বেনামে রূপান্তরিত হবে; সংরক্ষিত ঠিকানা,
          লগইন সেশন ও কার্ট মুছে যাবে এবং সব ডিভাইস থেকে লগআউট হয়ে যাবেন।{" "}
          <span className="font-semibold text-text-main">
            তবে হিসাব-নিকাশের আইনি প্রয়োজনে অর্ডারের রেকর্ড থেকে যাবে
          </span>{" "}
          — প্রতিটি অর্ডারের ভেতরে থাকা নাম, ফোন ও ডেলিভারি ঠিকানা সেই রেকর্ডের অংশ হিসেবে
          সংরক্ষিত থাকবে। রিভিউ ও প্রশ্ন থেকে যাবে, তবে সেখানে আপনার নামের বদলে "মুছে ফেলা
          গ্রাহক" দেখাবে। এই কাজ ফেরানো যায় না।
        </p>

        {stage === "done" ? (
          <p role="status" className="mt-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
            {message}
          </p>
        ) : stage === "idle" ? (
          <button
            type="button"
            onClick={() => setStage("confirm")}
            className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-700 transition hover:bg-rose-100"
          >
            অ্যাকাউন্ট মুছে ফেলতে চাই
          </button>
        ) : (
          <div className="mt-4 space-y-4">
            <label className="flex items-start gap-2.5 text-sm leading-6 text-text-main">
              <input
                type="checkbox"
                checked={understood}
                onChange={(e) => setUnderstood(e.target.checked)}
                className="mt-1 h-5 w-5 shrink-0"
              />
              <span>
                আমি বুঝেছি — অ্যাকাউন্টের ব্যক্তিগত তথ্য বেনামী হবে, অর্ডারের রেকর্ড হিসাবের
                প্রয়োজনে থেকে যাবে, এবং এই কাজ ফেরানো যাবে না।
              </span>
            </label>

            {proofKind === "password" ? (
              <label className="block">
                <span className="text-sm font-medium">নিশ্চিত করতে বর্তমান পাসওয়ার্ড দিন</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy}
                  className={inputCls}
                />
              </label>
            ) : proofKind === "otp" ? (
              <div className="space-y-3">
                {stage === "confirm" ? (
                  <button
                    type="button"
                    onClick={() => void handleRequestOtp()}
                    disabled={busy}
                    className="rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-semibold text-text-main transition hover:bg-surface-2 disabled:opacity-50"
                  >
                    {busy ? "পাঠানো হচ্ছে…" : `${phoneMasked} নম্বরে নিশ্চিতকরণ কোড পাঠান`}
                  </button>
                ) : (
                  <label className="block">
                    <span className="text-sm font-medium">ফোনে পাওয়া ৬ সংখ্যার কোডটি দিন</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
                      disabled={busy}
                      className={inputCls}
                    />
                  </label>
                )}
              </div>
            ) : (
              <label className="block">
                <span className="text-sm font-medium">
                  নিশ্চিত করতে অ্যাকাউন্টের ইমেইলটি হুবহু লিখুন{email ? ` (${email})` : ""}
                </span>
                <input
                  type="email"
                  autoComplete="email"
                  value={emailConfirm}
                  onChange={(e) => setEmailConfirm(e.target.value)}
                  disabled={busy}
                  className={inputCls}
                />
              </label>
            )}

            {stage === "confirm" || stage === "otp-sent" ? (
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  disabled={busy || (proofKind === "otp" && stage !== "otp-sent")}
                  className="rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? "মুছে ফেলা হচ্ছে…" : "চূড়ান্তভাবে মুছে ফেলুন"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStage("idle");
                    setMessage("");
                  }}
                  disabled={busy}
                  className="rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-semibold text-text-main transition hover:bg-surface-2"
                >
                  বাতিল
                </button>
              </div>
            ) : null}
          </div>
        )}

        {message && stage !== "done" ? (
          <p
            role="status"
            className={`mt-3 rounded-xl px-4 py-3 text-sm font-medium ${
              messageOk ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"
            }`}
          >
            {message}
          </p>
        ) : null}
      </div>
    </section>
  );
}
