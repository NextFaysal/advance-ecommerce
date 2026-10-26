"use client";

/**
 * Subscription-boxes config editor — self-fetching client card
 * (ADV-23 vertical 4, wave 56). Edits the Setting doc
 * `boxes.config` through PUT /api/v1/admin/boxes/config
 * (settings.edit + reason, audited server-side). Box variants are
 * one variant ID per line — a variant IS a subscription box only
 * while its ID is on this list (the config list is the v1 box
 * marker; the Subscription model has no kind field).
 */
import { useCallback, useEffect, useState } from "react";
import { formatBpsPercent } from "@/subscriptions/labels";
import type { BoxCycleKind } from "@/boxes/cycles";

interface BoxesConfig {
  boxVariantIds: string[];
  cycles: BoxCycleKind[];
  discountBps: number;
}

interface ConfigData {
  moduleEnabled: boolean;
  engineEnabled: boolean;
  source: "saved" | "default";
  config: BoxesConfig;
}

const INPUT_CLASS =
  "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-text-main";

export function BoxesConfigCard() {
  const [data, setData] = useState<ConfigData | null>(null);
  const [variantIdsText, setVariantIdsText] = useState("");
  const [cycles, setCycles] = useState<BoxCycleKind[]>(["monthly"]);
  const [discountBps, setDiscountBps] = useState(0);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/admin/boxes/config", { cache: "no-store" });
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
      setVariantIdsText(cfg.boxVariantIds.join("\n"));
      setCycles(cfg.cycles);
      setDiscountBps(cfg.discountBps);
      setError(null);
    } catch {
      setError("নেটওয়ার্ক ত্রুটি — কনফিগ লোড করা যায়নি।");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleCycle(kind: BoxCycleKind, on: boolean) {
    setCycles((prev) => {
      const next = on ? [...new Set([...prev, kind])] : prev.filter((c) => c !== kind);
      return next.length === 0 ? prev : next; // at least one cycle kind stays offered
    });
  }

  async function save() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const boxVariantIds = variantIdsText
        .split("\n")
        .map((v) => v.trim())
        .filter((v) => v !== "");
      const res = await fetch("/api/v1/admin/boxes/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ boxVariantIds, cycles, discountBps, reason }),
      });
      const json = (await res.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      if (!res.ok) {
        setError(json?.error?.message ?? "কনফিগ সংরক্ষণ করা যায়নি।");
        return;
      }
      setNotice("কনফিগ সংরক্ষিত হয়েছে।");
      setReason("");
      await load();
    } catch {
      setError("নেটওয়ার্ক ত্রুটি — কনফিগ সংরক্ষণ করা যায়নি।");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
      <h2 className="font-display text-base font-bold text-text-main">বক্স কনফিগ</h2>
      <p className="mt-1 text-sm leading-6 text-text-muted">
        কোন ভ্যারিয়েন্টগুলো সাবস্ক্রিপশন বক্স, কোন সাইকেলে সাবস্ক্রাইব করা যাবে, আর বক্স
        অর্ডারের ছাড়।{" "}
        {data
          ? `উৎস: ${data.source === "saved" ? "সংরক্ষিত ডকুমেন্ট" : "ডিফল্ট (এখনো সংরক্ষণ হয়নি)"} · বক্স মডিউল: ${data.moduleEnabled ? "চালু" : "বন্ধ"} · সাবস্ক্রিপশন ইঞ্জিন: ${data.engineEnabled ? "চালু" : "বন্ধ"}`
          : ""}
      </p>

      {error ? (
        <p role="alert" className="mt-3 text-sm font-medium text-red-700 dark:text-red-300">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="mt-3 text-sm font-medium text-emerald-700 dark:text-emerald-300">
          {notice}
        </p>
      ) : null}

      <div className="mt-4 grid gap-4">
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium text-text-main">বক্স ভ্যারিয়েন্ট আইডি (প্রতি লাইনে একটি)</span>
          <textarea
            className={INPUT_CLASS + " min-h-[96px] font-mono text-xs"}
            value={variantIdsText}
            onChange={(e) => setVariantIdsText(e.target.value)}
            placeholder={"variant-id-1\nvariant-id-2"}
          />
          <span className="text-xs text-text-muted">
            তালিকায় থাকা ভ্যারিয়েন্টের পেজে বক্স সাবস্ক্রিপশন কার্ড দেখা যাবে; তালিকা থেকে
            সরালে ওই ভ্যারিয়েন্ট আবার সাধারণ সাবস্ক্রিপশন পণ্যের মতো আচরণ করবে।
          </span>
        </label>

        <fieldset className="grid gap-1.5 text-sm">
          <legend className="font-medium text-text-main">অনুমোদিত সাইকেল</legend>
          <div className="flex flex-wrap gap-4">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={cycles.includes("weekly")}
                onChange={(e) => toggleCycle("weekly", e.target.checked)}
              />
              সাপ্তাহিক (প্রতি সপ্তাহে)
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={cycles.includes("monthly")}
                onChange={(e) => toggleCycle("monthly", e.target.checked)}
              />
              মাসিক (প্রতি মাসে)
            </label>
          </div>
          <span className="text-xs text-text-muted">অন্তত একটি সাইকেল চালু থাকতে হবে।</span>
        </fieldset>

        <label className="grid gap-1.5 text-sm">
          <span className="font-medium text-text-main">
            বক্স ছাড় (বেসিস পয়েন্ট{discountBps > 0 ? ` — এখন ${formatBpsPercent(discountBps)}%` : ""})
          </span>
          <input
            className={INPUT_CLASS + " max-w-[200px]"}
            type="number"
            min={0}
            max={5000}
            step={50}
            value={discountBps}
            onChange={(e) => setDiscountBps(Number(e.target.value))}
          />
          <span className="text-xs text-text-muted">
            1000 = 10%। 0 রাখলে সাধারণ সাবস্ক্রিপশন ছাড় (subscriptions.discount_bps) প্রযোজ্য
            হবে; ধনাত্মক মান দিলে বক্স অর্ডারে সেটাই প্রযোজ্য হবে।
          </span>
        </label>

        <label className="grid gap-1.5 text-sm">
          <span className="font-medium text-text-main">পরিবর্তনের কারণ (বাধ্যতামূলক)</span>
          <input
            className={INPUT_CLASS}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="যেমন: নভেম্বর বক্স চালু"
          />
        </label>

        <div>
          <button
            type="button"
            disabled={busy || reason.trim() === ""}
            onClick={save}
            className="inline-flex items-center justify-center rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "সংরক্ষণ হচ্ছে…" : "কনফিগ সংরক্ষণ করুন"}
          </button>
        </div>
      </div>
    </section>
  );
}
