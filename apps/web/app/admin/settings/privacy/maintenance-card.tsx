"use client";

// Maintenance-mode card — Settings > Privacy (ADV-29). Saves the
// ONE JSON document behind the `site.maintenance` Setting through
// the standard Settings API (POST /api/v1/admin/settings { key,
// value, reason }), so the change is audited (settings.update) with
// a mandatory reason like every other settings write. The
// storefront gate picks the change up within ~20s (middleware probe
// TTL) — the success copy says so instead of implying instant
// effect. Enabling with an empty message is refused client-side
// (the server parser would fall back to the default text anyway,
// but the operator should see and own the exact words visitors
// will read).
import { useState } from "react";
import { Icon } from "@/components/ui/icon";

const MAINTENANCE_KEY = "site.maintenance";

interface MaintenanceCardProps {
  initialEnabled: boolean;
  initialMessageBn: string;
  initialMessageEn: string;
  dbReady: boolean;
}

export function MaintenanceCard({
  initialEnabled,
  initialMessageBn,
  initialMessageEn,
  dbReady,
}: MaintenanceCardProps) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [messageBn, setMessageBn] = useState(initialMessageBn);
  const [messageEn, setMessageEn] = useState(initialMessageEn);
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState("");
  const [statusOk, setStatusOk] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setStatus("");
    if (reason.trim() === "") {
      setStatusOk(false);
      setStatus("পরিবর্তনের কারণ লিখুন — এটি অডিট লগে সংরক্ষিত থাকে।");
      return;
    }
    if (enabled && (messageBn.trim() === "" || messageEn.trim() === "")) {
      setStatusOk(false);
      setStatus("মেইনটেন্যান্স চালু করতে হলে বাংলা ও ইংরেজি — দুটি বার্তাই লিখুন।");
      return;
    }
    const value = JSON.stringify({
      enabled,
      message_bn: messageBn.trim(),
      message_en: messageEn.trim(),
    });
    setSaving(true);
    try {
      const res = await fetch("/api/v1/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: MAINTENANCE_KEY, value, reason: reason.trim() }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        setStatusOk(false);
        setStatus(`সেভ করা যায়নি: ${data.error?.message ?? `সেভ করা যায়নি (${res.status})`}`);
        return;
      }
      setStatusOk(true);
      setStatus(
        enabled
          ? "সেভ হয়েছে — মেইনটেন্যান্স মোড চালু। স্টোরফ্রন্টে প্রায় ২০ সেকেন্ডের মধ্যে 503 পেজ দেখা যাবে; অ্যাডমিন প্যানেল আগের মতোই চলবে। ?preview=1 দিয়ে লগইন অবস্থায় স্টোরফ্রন্ট প্রিভিউ করা যাবে।"
          : "সেভ হয়েছে — মেইনটেন্যান্স মোড বন্ধ। প্রায় ২০ সেকেন্ডের মধ্যে স্টোরফ্রন্ট আবার সবার জন্য খুলবে।",
      );
    } catch {
      setStatusOk(false);
      setStatus("সার্ভারের সঙ্গে যোগাযোগ করা যায়নি — সেভ হয়েছে কিনা নিশ্চিত নয়; পেজটি আবার লোড করে যাচাই করুন।");
    } finally {
      setSaving(false);
    }
  }

  const inputCls =
    "mt-1 block min-h-[44px] w-full rounded-lg border border-border bg-card px-3 text-sm shadow-sm outline-none transition focus:border-brand-500 focus:ring-[3px] focus:ring-brand-100";

  return (
    <section className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-card">
      <div className="brand-gradient h-1.5 w-full" aria-hidden="true" />
      <div className="p-5">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="brand-gradient flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-md">
            <Icon name="alert" size={20} />
          </span>
          <h2 className="font-display text-base font-semibold text-text-main">
            মেইনটেন্যান্স মোড (Maintenance Mode)
          </h2>
        </div>

        <p className="mt-3 text-sm leading-relaxed text-text-muted">
          চালু থাকলে স্টোরফ্রন্টের সব পেজে নিচের বার্তাসহ 503 পেজ দেখায় — অ্যাডমিন প্যানেল,
          অ্যাডমিন লগইন ও API আগের মতোই চলে। লগইন করা অবস্থায়{" "}
          <code className="font-mono text-xs">?preview=1</code> যোগ করলে স্টোরফ্রন্ট প্রিভিউ করা
          যায়। সেটিং কী <code className="font-mono text-xs">site.maintenance</code>।
          {!dbReady && (
            <span className="mt-1.5 block text-rose-600">
              সতর্কতা: ডাটাবেস থেকে বর্তমান মান পড়া যায়নি — উপরে বিল্ট-ইন ডিফল্ট (বন্ধ)
              দেখানো হচ্ছে।
            </span>
          )}
        </p>

        <label className="mt-4 flex items-center gap-2.5 text-sm font-medium text-text-main">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            disabled={saving}
            className="h-5 w-5"
          />
          মেইনটেন্যান্স মোড চালু
        </label>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium">বার্তা (বাংলা)</span>
            <textarea
              rows={3}
              value={messageBn}
              onChange={(e) => setMessageBn(e.target.value)}
              disabled={saving}
              className={inputCls}
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Message (English)</span>
            <textarea
              rows={3}
              value={messageEn}
              onChange={(e) => setMessageEn(e.target.value)}
              disabled={saving}
              className={inputCls}
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="block grow basis-56">
            <span className="text-sm font-medium">পরিবর্তনের কারণ (অডিটের জন্য আবশ্যিক)</span>
            <input
              type="text"
              placeholder="যেমন: সার্ভার মাইগ্রেশনের জন্য ২ ঘণ্টা বন্ধ"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={saving}
              className={inputCls}
            />
          </label>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="brand-gradient inline-flex min-h-[44px] items-center rounded-md px-5 text-sm font-semibold text-white shadow-md transition hover:shadow-lift hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "সেভ হচ্ছে…" : "সেভ করুন"}
          </button>
        </div>

        {status && (
          <div
            role="status"
            className={`mt-4 flex items-start gap-3 rounded-lg border px-4 py-3.5 text-sm ${
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
