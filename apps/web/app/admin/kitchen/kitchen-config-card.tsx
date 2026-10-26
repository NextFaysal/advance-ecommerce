"use client";

/**
 * Restaurant config editor — self-fetching client card (ADV-23,
 * wave 56). Edits the Setting doc `restaurant.config` through
 * PUT /api/v1/admin/restaurant/config (settings.edit + reason,
 * audited server-side). Tables are one label per line (cap 50).
 * The card shows the EFFECTIVE dine-in state the API reports: with
 * zero tables, dine-in reads বন্ধ even when its toggle is on —
 * checkout and the order seams honour the effective value.
 */
import { useCallback, useEffect, useState } from "react";

interface ConfigData {
  moduleEnabled: boolean;
  source: "saved" | "default";
  config: { tables: string[]; takeawayEnabled: boolean; dineInEnabled: boolean };
  effective: { tables: string[]; takeawayEnabled: boolean; dineInEnabled: boolean };
}

export function KitchenConfigCard() {
  const [data, setData] = useState<ConfigData | null>(null);
  const [tablesText, setTablesText] = useState("");
  const [takeaway, setTakeaway] = useState(true);
  const [dineIn, setDineIn] = useState(true);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/admin/restaurant/config", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as {
        data?: ConfigData;
        error?: { message?: string };
      } | null;
      if (!res.ok || !json?.data) {
        setError(json?.error?.message ?? "কনফিগ লোড করা যায়নি।");
        return;
      }
      setData(json.data);
      setTablesText(json.data.config.tables.join("\n"));
      setTakeaway(json.data.config.takeawayEnabled);
      setDineIn(json.data.config.dineInEnabled);
      setError(null);
    } catch {
      setError("নেটওয়ার্ক ত্রুটি — কনফিগ লোড করা যায়নি।");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (busy) return;
    const tables = tablesText
      .split("\n")
      .map((t) => t.trim())
      .filter((t) => t !== "");
    if (tables.length > 50) {
      setError("সর্বোচ্চ ৫০টি টেবিল রাখা যাবে।");
      return;
    }
    if (!reason.trim()) {
      setError("পরিবর্তনের কারণ লিখুন (অডিটের জন্য আবশ্যক)।");
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/v1/admin/restaurant/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tables,
          takeawayEnabled: takeaway,
          dineInEnabled: dineIn,
          reason: reason.trim(),
        }),
      });
      const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!res.ok) {
        setError(json?.error?.message ?? "কনফিগ সংরক্ষণ করা যায়নি।");
        return;
      }
      setReason("");
      setNotice("কনফিগ সংরক্ষিত হয়েছে।");
      await load();
    } catch {
      setError("নেটওয়ার্ক ত্রুটি — কনফিগ সংরক্ষণ করা যায়নি।");
    } finally {
      setBusy(false);
    }
  }

  if (!data && !error) {
    return <p className="text-sm text-text-muted">কনফিগ লোড হচ্ছে…</p>;
  }

  return (
    <section aria-label="রেস্টুরেন্ট কনফিগ" className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <h2 className="text-base font-semibold text-text-main">রেস্টুরেন্ট সেটিংস</h2>
      <p className="mt-1 text-sm leading-6 text-text-muted">
        টেবিলের তালিকা আর ডাইন-ইন / টেকঅওয়ে চালু-বন্ধ — Setting ডকুমেন্ট <code>restaurant.config</code>-এ
        থাকে{data?.source === "default" ? " (এখনো কিছু সংরক্ষিত হয়নি — কোডের ডিফল্ট চলছে)" : ""}।
        টেবিল একটিও না থাকলে ডাইন-ইন কার্যত বন্ধ থাকে, টগল যাই হোক।
        {data && (
          <>
            {" "}
            বর্তমানে কার্যকর: ডাইন-ইন <strong>{data.effective.dineInEnabled ? "চালু" : "বন্ধ"}</strong>,
            টেকঅওয়ে <strong>{data.effective.takeawayEnabled ? "চালু" : "বন্ধ"}</strong>।
          </>
        )}
      </p>
      {error && (
        <p role="alert" className="mt-3 rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-600">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
          {notice}
        </p>
      )}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-text-main">টেবিল (প্রতি লাইনে একটি লেবেল)</span>
          <textarea
            value={tablesText}
            onChange={(e) => setTablesText(e.target.value)}
            rows={6}
            placeholder={"টেবিল ১\nটেবিল ২\nবারান্দা ১"}
            className="w-full rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm text-text-main outline-none transition placeholder:text-text-subtle focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
          />
        </label>
        <div className="space-y-3">
          <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-text-main">
            <input
              type="checkbox"
              checked={dineIn}
              onChange={(e) => setDineIn(e.target.checked)}
              className="h-4 w-4 shrink-0 accent-brand-600"
            />
            ডাইন-ইন চালু
          </label>
          <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-text-main">
            <input
              type="checkbox"
              checked={takeaway}
              onChange={(e) => setTakeaway(e.target.checked)}
              className="h-4 w-4 shrink-0 accent-brand-600"
            />
            টেকঅওয়ে চালু
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-text-main">পরিবর্তনের কারণ (আবশ্যক)</span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={300}
              placeholder="যেমন: নতুন টেবিল যোগ হলো"
              className="w-full rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm text-text-main outline-none transition placeholder:text-text-subtle focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
            />
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => void save()}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
          >
            {busy ? "সংরক্ষণ হচ্ছে…" : "সংরক্ষণ করুন"}
          </button>
        </div>
      </div>
    </section>
  );
}
