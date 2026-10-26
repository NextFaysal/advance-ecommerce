"use client";

/**
 * Courses config editor — self-fetching client card (ADV-23
 * vertical 6, wave 56). Edits the Setting doc `courses.config`
 * through PUT /api/v1/admin/courses/config (settings.edit +
 * reason, audited server-side). Course variants are one variant ID
 * per line — a variant IS a course variant only while its ID is on
 * this list (the config list is the v1 course marker; the content
 * itself is authored per product in the content card above).
 */
import { useCallback, useEffect, useState } from "react";

interface CoursesConfig {
  courseVariantIds: string[];
}

interface ConfigData {
  moduleEnabled: boolean;
  source: "saved" | "default";
  config: CoursesConfig;
}

const INPUT_CLASS =
  "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-text-main";

export function CoursesConfigCard() {
  const [data, setData] = useState<ConfigData | null>(null);
  const [variantIdsText, setVariantIdsText] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/admin/courses/config", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as {
        data?: ConfigData;
        error?: { message?: string };
      } | null;
      if (!res.ok || !json?.data) {
        setError(json?.error?.message ?? "কনফিগ লোড করা যায়নি।");
        return;
      }
      setData(json.data);
      setVariantIdsText(json.data.config.courseVariantIds.join("\n"));
      setError(null);
    } catch {
      setError("নেটওয়ার্ক ত্রুটি — কনফিগ লোড করা যায়নি।");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const courseVariantIds = variantIdsText
        .split("\n")
        .map((v) => v.trim())
        .filter((v) => v !== "");
      const res = await fetch("/api/v1/admin/courses/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ courseVariantIds, reason }),
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
      <h2 className="font-display text-base font-bold text-text-main">কোর্স কনফিগ</h2>
      <p className="mt-1 text-sm leading-6 text-text-muted">
        কোন ভ্যারিয়েন্টগুলো কোর্স বিক্রি করে।{" "}
        {data
          ? `উৎস: ${data.source === "saved" ? "সংরক্ষিত ডকুমেন্ট" : "ডিফল্ট (এখনো সংরক্ষণ হয়নি)"} · কোর্স মডিউল: ${data.moduleEnabled ? "চালু" : "বন্ধ"}`
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
          <span className="font-medium text-text-main">কোর্স ভ্যারিয়েন্ট আইডি (প্রতি লাইনে একটি)</span>
          <textarea
            className={INPUT_CLASS + " min-h-[96px] font-mono text-xs"}
            value={variantIdsText}
            onChange={(e) => setVariantIdsText(e.target.value)}
            placeholder={"variant-id-1\nvariant-id-2"}
          />
          <span className="text-xs text-text-muted">
            সাধারণত DIGITAL ধরনের পণ্যের ভ্যারিয়েন্ট তালিকায় দিন। তালিকার যেকোনো ভ্যারিয়েন্ট
            কিনলেই ওই পণ্যের পুরো কোর্স খুলে যায়; তালিকা থেকে সরালে নতুন ক্রেতা অ্যাক্সেস
            পাবে না — আগের ক্রেতার অর্ডার-ভিত্তিক অ্যাক্সেসও ওই ভ্যারিয়েন্ট দিয়ে আর যাচাই
            হবে না।
          </span>
        </label>

        <label className="grid gap-1.5 text-sm">
          <span className="font-medium text-text-main">পরিবর্তনের কারণ (বাধ্যতামূলক)</span>
          <input
            className={INPUT_CLASS}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="যেমন: প্রথম কোর্স চালু"
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
