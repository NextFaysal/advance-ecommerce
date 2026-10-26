"use client";

/**
 * Services config editor — self-fetching client card (ADV-23,
 * wave 56). Edits the Setting doc `services.config` through
 * PUT /api/v1/admin/services/config (settings.edit + reason,
 * audited server-side). Bookable variants are one variant ID per
 * line — a variant is a bookable service ONLY while its ID is on
 * this list (the config list is the v1 service marker; product
 * types have no SERVICE value).
 */
import { useCallback, useEffect, useState } from "react";

interface ServicesConfig {
  slotMinutes: 15 | 30 | 60;
  openTime: string;
  closeTime: string;
  closedWeekdays: number[];
  advanceDays: number;
  bufferMinutes: number;
  capacityPerSlot: number;
  serviceVariantIds: string[];
}

interface ConfigData {
  moduleEnabled: boolean;
  source: "saved" | "default";
  config: ServicesConfig;
}

const WEEKDAY_LABELS = ["রবিবার", "সোমবার", "মঙ্গলবার", "বুধবার", "বৃহস্পতিবার", "শুক্রবার", "শনিবার"];

const INPUT_CLASS =
  "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-text-main";

export function BookingsConfigCard() {
  const [data, setData] = useState<ConfigData | null>(null);
  const [slotMinutes, setSlotMinutes] = useState<15 | 30 | 60>(30);
  const [openTime, setOpenTime] = useState("09:00");
  const [closeTime, setCloseTime] = useState("21:00");
  const [closedWeekdays, setClosedWeekdays] = useState<number[]>([]);
  const [advanceDays, setAdvanceDays] = useState(14);
  const [bufferMinutes, setBufferMinutes] = useState(0);
  const [capacityPerSlot, setCapacityPerSlot] = useState(1);
  const [variantIdsText, setVariantIdsText] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/admin/services/config", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as {
        data?: ConfigData;
        error?: { message?: string };
      } | null;
      if (!res.ok || !json?.data) {
        setError(json?.error?.message ?? "কনফিগ লোড করা যায়নি।");
        return;
      }
      const cfg = json.data.config;
      setData(json.data);
      setSlotMinutes(cfg.slotMinutes);
      setOpenTime(cfg.openTime);
      setCloseTime(cfg.closeTime);
      setClosedWeekdays(cfg.closedWeekdays);
      setAdvanceDays(cfg.advanceDays);
      setBufferMinutes(cfg.bufferMinutes);
      setCapacityPerSlot(cfg.capacityPerSlot);
      setVariantIdsText(cfg.serviceVariantIds.join("\n"));
      setError(null);
    } catch {
      setError("নেটওয়ার্ক ত্রুটি — কনফিগ লোড করা যায়নি।");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleWeekday(day: number) {
    setClosedWeekdays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => a - b),
    );
  }

  async function save() {
    if (busy) return;
    if (!reason.trim()) {
      setError("পরিবর্তনের কারণ লিখুন (অডিটের জন্য আবশ্যক)।");
      return;
    }
    const serviceVariantIds = variantIdsText
      .split("\n")
      .map((v) => v.trim())
      .filter((v) => v !== "");
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/v1/admin/services/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slotMinutes,
          openTime,
          closeTime,
          closedWeekdays,
          advanceDays,
          bufferMinutes,
          capacityPerSlot,
          serviceVariantIds,
          reason: reason.trim(),
        }),
      });
      const json = (await res.json().catch(() => null)) as {
        data?: ConfigData;
        error?: { message?: string; details?: string[] };
      } | null;
      if (!res.ok || !json?.data) {
        setError(
          json?.error?.details?.join("; ") ?? json?.error?.message ?? "কনফিগ সংরক্ষণ করা যায়নি।",
        );
        return;
      }
      setData(json.data);
      setReason("");
      setNotice("কনফিগ সংরক্ষিত হয়েছে।");
      setError(null);
    } catch {
      setError("নেটওয়ার্ক ত্রুটি — কনফিগ সংরক্ষণ করা যায়নি।");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="সেবা বুকিং কনফিগ" className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <h2 className="text-base font-bold text-text-main">বুকিং কনফিগ</h2>
      <p className="mt-1 text-sm text-text-muted">
        স্লটের দৈর্ঘ্য, খোলার সময়, বন্ধের দিন ও কোন ভ্যারিয়েন্টগুলো বুকিংযোগ্য সেবা — সব এখান থেকে।
        {data && (
          <>
            {" "}
            উৎস: <strong className="text-text-main">{data.source === "saved" ? "সংরক্ষিত" : "ডিফল্ট"}</strong>
            {!data.moduleEnabled && (
              <> · মডিউল এখন বন্ধ (module.services) — কনফিগ আগে থেকে তৈরি রাখা যায়।</>
            )}
          </>
        )}
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-text-main">স্লটের দৈর্ঘ্য (মিনিট)</span>
          <select
            value={slotMinutes}
            onChange={(e) => setSlotMinutes(Number(e.target.value) as 15 | 30 | 60)}
            className={INPUT_CLASS}
          >
            <option value={15}>১৫ মিনিট</option>
            <option value={30}>৩০ মিনিট</option>
            <option value={60}>৬০ মিনিট</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-text-main">খোলার সময়</span>
          <input type="time" value={openTime} onChange={(e) => setOpenTime(e.target.value)} className={INPUT_CLASS} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-text-main">বন্ধের সময়</span>
          <input type="time" value={closeTime} onChange={(e) => setCloseTime(e.target.value)} className={INPUT_CLASS} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-text-main">কত দিন আগে পর্যন্ত বুকিং</span>
          <input
            type="number"
            min={0}
            max={60}
            value={advanceDays}
            onChange={(e) => setAdvanceDays(Number(e.target.value))}
            className={INPUT_CLASS}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-text-main">প্রতিটি বুকিংয়ের পর বিরতি (মিনিট)</span>
          <input
            type="number"
            min={0}
            max={120}
            value={bufferMinutes}
            onChange={(e) => setBufferMinutes(Number(e.target.value))}
            className={INPUT_CLASS}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-text-main">এক স্লটে সর্বোচ্চ বুকিং</span>
          <input
            type="number"
            min={1}
            max={20}
            value={capacityPerSlot}
            onChange={(e) => setCapacityPerSlot(Number(e.target.value))}
            className={INPUT_CLASS}
          />
        </label>
      </div>
      <fieldset className="mt-4">
        <legend className="mb-1.5 text-sm font-medium text-text-main">সাপ্তাহিক বন্ধের দিন</legend>
        <div className="flex flex-wrap gap-2">
          {WEEKDAY_LABELS.map((label, day) => (
            <label
              key={day}
              className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface-2/60 px-3 py-1.5 text-sm text-text-main"
            >
              <input
                type="checkbox"
                checked={closedWeekdays.includes(day)}
                onChange={() => toggleWeekday(day)}
                className="h-4 w-4 accent-brand-600"
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="mt-4 block">
        <span className="mb-1.5 block text-sm font-medium text-text-main">
          বুকিংযোগ্য সেবার ভ্যারিয়েন্ট ID (প্রতি লাইনে একটি)
        </span>
        <textarea
          value={variantIdsText}
          onChange={(e) => setVariantIdsText(e.target.value)}
          rows={4}
          placeholder={"variant-id-1\nvariant-id-2"}
          className={`${INPUT_CLASS} font-mono text-xs`}
        />
        <span className="mt-1 block text-xs text-text-muted">
          তালিকার বাইরের কোনো ভ্যারিয়েন্টে বুকিং নেওয়া হবে না। ভ্যারিয়েন্ট ID পণ্যের সম্পাদনা পেজে পাওয়া যায়।
        </span>
      </label>
      <label className="mt-4 block">
        <span className="mb-1.5 block text-sm font-medium text-text-main">পরিবর্তনের কারণ (আবশ্যক)</span>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="যেমন: নতুন সেবা যোগ করা হলো"
          className={INPUT_CLASS}
        />
      </label>
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
      <div className="mt-4">
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
        >
          {busy ? "সংরক্ষণ হচ্ছে…" : "কনফিগ সংরক্ষণ করুন"}
        </button>
      </div>
    </section>
  );
}
