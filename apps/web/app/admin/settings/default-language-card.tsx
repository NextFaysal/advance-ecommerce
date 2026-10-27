"use client";

/**
 * Default Language card — Settings index (doc 30).
 *
 * `general.locale` is the STORE-WIDE default language: every visitor who
 * has not chosen their own language sees the whole store (storefront +
 * admin) in this language. It saves through the standard Settings API
 * (POST /api/v1/admin/settings { key, value, reason }) so the change is
 * audited with a required reason, exactly like the Store Name card.
 * A visitor's own language choice (header switcher, stored in the
 * `ae-locale` cookie) always overrides this default for that visitor.
 */
import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import { LOCALES, LOCALE_SELF_NAMES, isLocale, type Locale } from "@/i18n/locale";

const LOCALE_KEY = "general.locale";

interface DefaultLanguageCardProps {
  /** Effective default right now (DB value over the built-in "bn"). */
  initial: Locale;
  dbReady: boolean;
}

export function DefaultLanguageCard({ initial, dbReady }: DefaultLanguageCardProps) {
  const [value, setValue] = useState<Locale>(initial);
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState("");
  const [statusOk, setStatusOk] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setStatus("");
    if (reason.trim() === "") {
      setStatusOk(false);
      setStatus("পরিবর্তনের কারণ লিখুন — এটি অডিট লগে সংরক্ষিত থাকে। / Enter a reason for the change — it is kept in the audit log.");
      return;
    }
    if (value === initial) {
      setStatusOk(true);
      setStatus("কোনো পরিবর্তন নেই — ডিফল্ট ভাষা আগের মতোই আছে। / No change — the default language is unchanged.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/v1/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: LOCALE_KEY, value, reason: reason.trim() }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        setStatusOk(false);
        setStatus(`${LOCALE_KEY} সেভ করা যায়নি: ${data.error?.message ?? `সেভ করা যায়নি (${res.status})`}`);
        return;
      }
      setStatusOk(true);
      setStatus(
        value === "en"
          ? "Saved — the store default language is now English. Visitors who have not chosen their own language will see everything in English."
          : "সেভ হয়েছে — স্টোরের ডিফল্ট ভাষা এখন বাংলা। যেসব ভিজিটর নিজের ভাষা বেছে নেননি, তারা সবকিছু বাংলায় দেখবেন।",
      );
    } catch {
      setStatusOk(false);
      setStatus("সার্ভারের সঙ্গে যোগাযোগ করা যায়নি — সেভ হয়েছে কিনা নিশ্চিত নয়; পেজটি আবার লোড করে যাচাই করুন।");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-card">
      <div className="brand-gradient h-1.5 w-full" aria-hidden="true" />
      <div className="p-5">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="brand-gradient flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-md">
            <Icon name="globe" size={20} />
          </span>
          <h2 className="font-display text-base font-semibold text-text-main">ডিফল্ট ভাষা (Default Language)</h2>
        </div>

        <p className="mt-3 text-sm leading-relaxed text-text-muted">
          এই ভাষাতেই পুরো স্টোর (স্টোরফ্রন্ট + অ্যাডমিন) দেখাবে — যারা নিজে ভাষা বেছে নেননি তাদের জন্য।
          English সিলেক্ট করলে সবকিছু English, বাংলা সিলেক্ট করলে সবকিছু বাংলা হবে। প্রতিটি ভিজিটর হেডারের
          ভাষা বাটন থেকে নিজের ভাষা বেছে নিতে পারেন — সেটি তার জন্য এই ডিফল্টকে ওভাররাইড করে।
          সেটিং কী <code className="font-mono text-xs">general.locale</code>।
          {!dbReady && (
            <span className="mt-1.5 block text-rose-600">
              সতর্কতা: ডাটাবেস থেকে বর্তমান মান পড়া যায়নি — উপরে বিল্ট-ইন ডিফল্ট (বাংলা) দেখানো হচ্ছে।
            </span>
          )}
        </p>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <fieldset className="block grow basis-64">
            <legend className="text-sm font-medium">ডিফল্ট ভাষা / Default language</legend>
            <div className="mt-1 inline-flex items-center rounded-full border border-border bg-card p-0.5 shadow-sm">
              {LOCALES.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setValue(option)}
                  aria-pressed={option === value}
                  disabled={saving}
                  className={`min-h-[36px] rounded-full px-4 text-sm font-medium transition motion-fast ${
                    option === value ? "brand-gradient text-white shadow" : "text-text-muted hover:text-text-main"
                  }`}
                >
                  {LOCALE_SELF_NAMES[option]}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="block grow basis-56">
            <span className="text-sm font-medium">পরিবর্তনের কারণ (অডিটের জন্য আবশ্যিক)</span>
            <input
              type="text"
              placeholder="যেমন: স্টোর এখন থেকে English-এ চলবে"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={saving}
              className="mt-1 block min-h-[44px] w-full max-w-md rounded-lg border border-border bg-card px-3 text-sm shadow-sm outline-none transition motion-fast focus:border-brand-500 focus:ring-[3px] focus:ring-brand-100"
            />
          </label>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="brand-gradient inline-flex min-h-[44px] items-center rounded-md px-5 text-sm font-semibold text-white shadow-md transition motion-fast hover:shadow-lift hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "সেভ হচ্ছে…" : "ভাষা সেভ করুন"}
          </button>
        </div>

        {status && (
          <div
            role="status"
            className={`anim-pop-in mt-4 flex items-start gap-3 rounded-lg border px-4 py-3.5 text-sm ${
              statusOk ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"
            }`}
          >
            <span
              aria-hidden="true"
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                statusOk ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
              }`}
            >
              <Icon name={statusOk ? "check" : "alert"} size={16} />
            </span>
            <p className="leading-relaxed">{status}</p>
          </div>
        )}
      </div>
    </section>
  );
}

export function parseDefaultLocale(value: string): Locale {
  return isLocale(value) ? value : "bn";
}
