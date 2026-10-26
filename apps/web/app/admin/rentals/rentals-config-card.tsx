"use client";

/**
 * Rental config editor — self-fetching client card (ADV-23
 * vertical 3, wave 56). Edits the Setting doc `rental.config`
 * through PUT /api/v1/admin/rental/config (settings.edit + reason,
 * audited server-side). Rentable variants are one variant ID per
 * line — a variant is rentable ONLY while its ID is on this list
 * (the config list is the v1 rental marker; product types have no
 * RENTAL value). Money fields are edited in TAKA here and stored
 * as integer poisha (the house money rule); the card labels say
 * what v1 does NOT automate: the late fee is never auto-charged
 * and the deposit refund on return is manual.
 */
import { useCallback, useEffect, useState } from "react";

interface RentalConfig {
  rentalVariantIds: string[];
  maxRentalDays: number;
  depositMode: "none" | "fixed" | "percent";
  depositFixedPoisha: number;
  depositPercentBps: number;
  lateFeePerDayPoisha: number;
}

interface ConfigData {
  moduleEnabled: boolean;
  source: "saved" | "default";
  config: RentalConfig;
}

const INPUT_CLASS =
  "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-text-main";

/** Poisha -> editable taka string (display/entry only). */
function poishaToTakaInput(poisha: number): string {
  return poisha % 100 === 0 ? String(poisha / 100) : (poisha / 100).toFixed(2);
}

/** Taka input -> poisha, or null when the text is not a clean
 *  non-negative amount. */
function takaInputToPoisha(text: string): number | null {
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

export function RentalsConfigCard() {
  const [data, setData] = useState<ConfigData | null>(null);
  const [variantIdsText, setVariantIdsText] = useState("");
  const [maxRentalDays, setMaxRentalDays] = useState(30);
  const [depositMode, setDepositMode] = useState<"none" | "fixed" | "percent">("none");
  const [depositFixedTaka, setDepositFixedTaka] = useState("0");
  const [depositPercent, setDepositPercent] = useState("0");
  const [lateFeeTaka, setLateFeeTaka] = useState("0");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/admin/rental/config", { cache: "no-store" });
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
      setVariantIdsText(cfg.rentalVariantIds.join("\n"));
      setMaxRentalDays(cfg.maxRentalDays);
      setDepositMode(cfg.depositMode);
      setDepositFixedTaka(poishaToTakaInput(cfg.depositFixedPoisha));
      setDepositPercent(String(cfg.depositPercentBps / 100));
      setLateFeeTaka(poishaToTakaInput(cfg.lateFeePerDayPoisha));
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
    if (!reason.trim()) {
      setError("পরিবর্তনের কারণ লিখুন (অডিটের জন্য আবশ্যক)।");
      return;
    }
    const depositFixedPoisha = takaInputToPoisha(depositFixedTaka);
    const lateFeePerDayPoisha = takaInputToPoisha(lateFeeTaka);
    const percentValue = Number(depositPercent);
    if (depositFixedPoisha === null || lateFeePerDayPoisha === null) {
      setError("টাকার পরিমাণগুলো সঠিক সংখ্যা হতে হবে (ঋণাত্মক নয়)।");
      return;
    }
    if (!Number.isFinite(percentValue) || percentValue < 0 || percentValue > 100) {
      setError("জামানতের শতকরা হার ০–১০০-এর মধ্যে হতে হবে।");
      return;
    }
    const rentalVariantIds = variantIdsText
      .split("\n")
      .map((v) => v.trim())
      .filter((v) => v !== "");
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/v1/admin/rental/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rentalVariantIds,
          maxRentalDays,
          depositMode,
          depositFixedPoisha,
          depositPercentBps: Math.round(percentValue * 100),
          lateFeePerDayPoisha,
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
    <section aria-label="ভাড়া কনফিগ" className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <h2 className="text-base font-bold text-text-main">ভাড়া কনফিগ</h2>
      <p className="mt-1 text-sm text-text-muted">
        কোন ভ্যারিয়েন্ট ভাড়া দেওয়া যাবে, সর্বোচ্চ কত দিন, আর জামানতের নিয়ম — সব এখান থেকে।
        জামানত বদলালে শুধু নতুন অর্ডারে প্রযোজ্য হয়; চলমান ভাড়ার জামানত অর্ডারের সময়েই নির্ধারিত (frozen) থাকে।
        {data && (
          <>
            {" "}
            উৎস: <strong className="text-text-main">{data.source === "saved" ? "সংরক্ষিত" : "ডিফল্ট"}</strong>
            {!data.moduleEnabled && (
              <> · মডিউল এখন বন্ধ (module.rental) — কনফিগ আগে থেকে তৈরি রাখা যায়।</>
            )}
          </>
        )}
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-text-main">সর্বোচ্চ ভাড়ার মেয়াদ (দিন)</span>
          <input
            type="number"
            min={1}
            max={365}
            value={maxRentalDays}
            onChange={(e) => setMaxRentalDays(Number(e.target.value))}
            className={INPUT_CLASS}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-text-main">জামানতের ধরন</span>
          <select
            value={depositMode}
            onChange={(e) => setDepositMode(e.target.value as "none" | "fixed" | "percent")}
            className={INPUT_CLASS}
          >
            <option value="none">জামানত নেই</option>
            <option value="fixed">নির্দিষ্ট পরিমাণ (প্রতি ভাড়ায়)</option>
            <option value="percent">পণ্যের দামের শতকরা অংশ</option>
          </select>
        </label>
        {depositMode === "fixed" && (
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-text-main">জামানতের পরিমাণ (টাকা)</span>
            <input
              type="number"
              min={0}
              step="0.01"
              value={depositFixedTaka}
              onChange={(e) => setDepositFixedTaka(e.target.value)}
              className={INPUT_CLASS}
            />
          </label>
        )}
        {depositMode === "percent" && (
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-text-main">জামানতের হার (দামের %)</span>
            <input
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={depositPercent}
              onChange={(e) => setDepositPercent(e.target.value)}
              className={INPUT_CLASS}
            />
          </label>
        )}
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-text-main">বিলম্ব ফি (টাকা / দিন)</span>
          <input
            type="number"
            min={0}
            step="0.01"
            value={lateFeeTaka}
            onChange={(e) => setLateFeeTaka(e.target.value)}
            className={INPUT_CLASS}
          />
          <span className="mt-1 block text-xs text-text-muted">
            শুধু চুক্তির হার — সিস্টেম নিজে থেকে এই ফি কাটে না; মেয়াদোত্তীর্ণ ফেরতে ম্যানুয়ালি হিসাব করুন।
          </span>
        </label>
      </div>
      <label className="mt-4 block">
        <span className="mb-1.5 block text-sm font-medium text-text-main">
          ভাড়াযোগ্য ভ্যারিয়েন্ট ID (প্রতি লাইনে একটি)
        </span>
        <textarea
          value={variantIdsText}
          onChange={(e) => setVariantIdsText(e.target.value)}
          rows={4}
          placeholder={"variant-id-1\nvariant-id-2"}
          className={`${INPUT_CLASS} font-mono text-xs`}
        />
        <span className="mt-1 block text-xs text-text-muted">
          তালিকার বাইরের কোনো ভ্যারিয়েন্ট ভাড়া দেওয়া হবে না। প্রতিটি ভ্যারিয়েন্টের stock-ই তার মোট ইউনিট সংখ্যা —
          ভাড়া চলাকালীন stock কমে না, তারিখের ওভারল্যাপ দিয়েই প্রাপ্যতা হিসাব হয়। ভ্যারিয়েন্ট ID পণ্যের সম্পাদনা পেজে পাওয়া যায়।
        </span>
      </label>
      <label className="mt-4 block">
        <span className="mb-1.5 block text-sm font-medium text-text-main">পরিবর্তনের কারণ (আবশ্যক)</span>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="যেমন: নতুন ভাড়ার পণ্য যোগ করা হলো"
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
