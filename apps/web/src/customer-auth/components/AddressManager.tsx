"use client";

/**
 * Saved-address manager for /account (logged-in state). Receives the
 * address list as plain data from the server page; add/delete go through
 * /api/v1/public/account/addresses and the page re-renders on success
 * (router.refresh) — no address state is duplicated on the client.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AccountAddress } from "../auth";

const inputCls =
  "h-12 w-full rounded-xl border border-border bg-bg-app px-4 text-sm text-text-main outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30";
const labelCls = "mb-1.5 block text-sm font-medium text-text-main";

export default function AddressManager({ addresses }: { addresses: AccountAddress[] }) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    label: "",
    division: "",
    district: "",
    upazila: "",
    union: "",
    addressLine: "",
    isDefault: false,
  });

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function addAddress(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/v1/public/account/addresses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: form.label || undefined,
          division: form.division,
          district: form.district,
          upazila: form.upazila,
          union: form.union || undefined,
          addressLine: form.addressLine,
          isDefault: form.isDefault,
        }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        setError(json?.error?.message ?? "ঠিকানা যোগ করা যায়নি। আবার চেষ্টা করুন।");
      } else {
        setShowForm(false);
        setForm({ label: "", division: "", district: "", upazila: "", union: "", addressLine: "", isDefault: false });
        router.refresh();
      }
    } catch {
      setError("ইন্টারনেট সংযোগে সমস্যা হয়েছে। আবার চেষ্টা করুন।");
    }
    setBusy(false);
  }

  async function removeAddress(id: string) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/public/account/addresses/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setError("ঠিকানাটি মোছা যায়নি। আবার চেষ্টা করুন।");
      } else {
        router.refresh();
      }
    } catch {
      setError("ইন্টারনেট সংযোগে সমস্যা হয়েছে। আবার চেষ্টা করুন।");
    }
    setBusy(false);
  }

  return (
    <div>
      {addresses.length === 0 && !showForm ? (
        <p className="text-sm leading-6 text-text-muted">
          কোনো সংরক্ষিত ঠিকানা নেই। চেকআউটের সময় দেওয়া ঠিকানা এখানে নিজে নিজে যোগ হয় না — চাইলে নিচে যোগ করে রাখুন।
        </p>
      ) : null}

      <ul className="space-y-3">
        {addresses.map((a) => (
          <li key={a.id} className="rounded-xl border border-border bg-bg-app px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-text-main">
                  {a.label ?? "ঠিকানা"}
                  {a.isDefault ? (
                    <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">ডিফল্ট</span>
                  ) : null}
                </p>
                <p className="mt-1 text-sm leading-6 text-text-muted">
                  {a.addressLine}, {a.upazila}, {a.district}, {a.division}
                  {a.union ? `, ${a.union}` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => removeAddress(a.id)}
                disabled={busy}
                className="shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-60"
              >
                মুছুন
              </button>
            </div>
          </li>
        ))}
      </ul>

      {error ? (
        <p role="alert" className="mt-3 rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-600">{error}</p>
      ) : null}

      {showForm ? (
        <form onSubmit={addAddress} className="mt-4 space-y-4 rounded-xl border border-border p-4">
          <div>
            <label className={labelCls} htmlFor="addr-label">নাম/লেবেল (ঐচ্ছিক)</label>
            <input id="addr-label" className={inputCls} value={form.label} onChange={(e) => set("label", e.target.value)} placeholder="যেমন: বাসা, অফিস" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor="addr-division">বিভাগ *</label>
              <input id="addr-division" className={inputCls} value={form.division} onChange={(e) => set("division", e.target.value)} required placeholder="যেমন: ঢাকা" />
            </div>
            <div>
              <label className={labelCls} htmlFor="addr-district">জেলা *</label>
              <input id="addr-district" className={inputCls} value={form.district} onChange={(e) => set("district", e.target.value)} required placeholder="যেমন: ঢাকা" />
            </div>
            <div>
              <label className={labelCls} htmlFor="addr-upazila">উপজেলা/থানা *</label>
              <input id="addr-upazila" className={inputCls} value={form.upazila} onChange={(e) => set("upazila", e.target.value)} required placeholder="যেমন: মিরপুর" />
            </div>
            <div>
              <label className={labelCls} htmlFor="addr-union">ইউনিয়ন (ঐচ্ছিক)</label>
              <input id="addr-union" className={inputCls} value={form.union} onChange={(e) => set("union", e.target.value)} />
            </div>
          </div>
          <div>
            <label className={labelCls} htmlFor="addr-line">বিস্তারিত ঠিকানা *</label>
            <input id="addr-line" className={inputCls} value={form.addressLine} onChange={(e) => set("addressLine", e.target.value)} required placeholder="বাসা/হোল্ডিং, রোড, এলাকা" />
          </div>
          <label className="flex items-center gap-2 text-sm text-text-main">
            <input type="checkbox" className="h-4 w-4 rounded border-border accent-brand-600" checked={form.isDefault} onChange={(e) => set("isDefault", e.target.checked)} />
            এটিকে ডিফল্ট ঠিকানা করুন
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="brand-gradient h-11 rounded-xl px-5 text-sm font-semibold text-white shadow-md transition hover:opacity-90 disabled:opacity-60">
              {busy ? "অপেক্ষা করুন…" : "ঠিকানা যোগ করুন"}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="h-11 rounded-xl border border-border px-4 text-sm font-semibold text-text-main transition hover:bg-surface-2">
              বাতিল
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="mt-4 h-11 rounded-xl border border-border bg-card px-4 text-sm font-semibold text-brand-700 transition hover:bg-brand-50"
        >
          + নতুন ঠিকানা যোগ করুন
        </button>
      )}
    </div>
  );
}
