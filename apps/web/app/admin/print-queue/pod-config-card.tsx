"use client";

/**
 * Print-on-demand config editor — self-fetching client card
 * (ADV-23 vertical 5, wave 56). Edits the Setting doc
 * `pod.config` through PUT /api/v1/admin/pod/config (settings.edit
 * + reason, audited server-side). Printable variants are one
 * variant ID per line — a variant is custom-printable ONLY while
 * its ID is on this list (the config list is the v1 POD marker;
 * product types have no POD value). The print fee is edited in
 * TAKA here and stored as integer poisha (the house money rule).
 * The card says plainly what v1 does NOT have: image/artwork
 * upload (storage-gated — the toggle below stores the merchant's
 * intent only, no upload is offered anywhere until storage
 * credentials exist).
 */
import { useCallback, useEffect, useState } from "react";

interface PodConfig {
  podVariantIds: string[];
  printFeePoisha: number;
  textMaxChars: number;
  allowImageUpload: boolean;
  colors: string[];
}

interface ConfigData {
  moduleEnabled: boolean;
  source: "saved" | "default";
  config: PodConfig;
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

export function PodConfigCard() {
  const [data, setData] = useState<ConfigData | null>(null);
  const [variantIdsText, setVariantIdsText] = useState("");
  const [feeTaka, setFeeTaka] = useState("0");
  const [textMaxChars, setTextMaxChars] = useState(20);
  const [allowImageUpload, setAllowImageUpload] = useState(false);
  const [colorsText, setColorsText] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/admin/pod/config", { cache: "no-store" });
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
      setVariantIdsText(cfg.podVariantIds.join("\n"));
      setFeeTaka(poishaToTakaInput(cfg.printFeePoisha));
      setTextMaxChars(cfg.textMaxChars);
      setAllowImageUpload(cfg.allowImageUpload);
      setColorsText(cfg.colors.join("\n"));
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
    const printFeePoisha = takaInputToPoisha(feeTaka);
    if (printFeePoisha === null) {
      setError("প্রিন্ট ফি সঠিক সংখ্যা হতে হবে (ঋণাত্মক নয়)।");
      return;
    }
    const podVariantIds = variantIdsText
      .split("\n")
      .map((v) => v.trim())
      .filter((v) => v !== "");
    const colors = colorsText
      .split("\n")
      .map((v) => v.trim())
      .filter((v) => v !== "");
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/v1/admin/pod/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          podVariantIds,
          printFeePoisha,
          textMaxChars,
          allowImageUpload,
          colors,
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
    <section aria-label="প্রিন্ট-অন-ডিমান্ড কনফিগ" className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <h2 className="text-base font-bold text-text-main">প্রিন্ট-অন-ডিমান্ড কনফিগ</h2>
      <p className="mt-1 text-sm text-text-muted">
        কোন ভ্যারিয়েন্টে কাস্টম প্রিন্ট হবে, প্রতি আইটেমে প্রিন্ট ফি কত, আর লেখার সর্বোচ্চ দৈর্ঘ্য — সব এখান থেকে।
        ফি বা সীমা বদলালে শুধু নতুন অর্ডারে প্রযোজ্য হয়; আগের অর্ডারের লেখা ও ফি অর্ডারের নোটেই নির্ধারিত (frozen) থাকে।
        {data && (
          <>
            {" "}
            উৎস: <strong className="text-text-main">{data.source === "saved" ? "সংরক্ষিত" : "ডিফল্ট"}</strong>
            {!data.moduleEnabled && (
              <> · মডিউল এখন বন্ধ (module.print_on_demand) — কনফিগ আগে থেকে তৈরি রাখা যায়।</>
            )}
          </>
        )}
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-text-main">প্রিন্ট ফি (টাকা / আইটেম)</span>
          <input
            type="number"
            min={0}
            step="0.01"
            value={feeTaka}
            onChange={(e) => setFeeTaka(e.target.value)}
            className={INPUT_CLASS}
          />
          <span className="mt-1 block text-xs text-text-muted">
            ০ মানে প্রিন্ট ফি নেই — ছাপানোর খরচ পণ্যের দামেই ধরা আছে।
          </span>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-text-main">লেখার সর্বোচ্চ দৈর্ঘ্য (অক্ষর)</span>
          <input
            type="number"
            min={1}
            max={200}
            value={textMaxChars}
            onChange={(e) => setTextMaxChars(Number(e.target.value))}
            className={INPUT_CLASS}
          />
        </label>
        <label className="flex items-start gap-2.5">
          <input
            type="checkbox"
            checked={allowImageUpload}
            onChange={(e) => setAllowImageUpload(e.target.checked)}
            className="mt-1 h-4 w-4 shrink-0 accent-brand-600"
          />
          <span>
            <span className="block text-sm font-medium text-text-main">ছবি/আর্টওয়ার্ক আপলোড (ভবিষ্যতের জন্য)</span>
            <span className="mt-1 block text-xs text-text-muted">
              এখন শুধু পছন্দটি সংরক্ষিত থাকে — স্টোরেজ (R2/S3) সেটআপ না হওয়া পর্যন্ত কোথাও আপলোডের
              সুবিধা দেখানো হয় না। এই সংস্করণে কাস্টম প্রিন্ট মানে শুধু লেখা + রঙ।
            </span>
          </span>
        </label>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-text-main">
            কাস্টম-প্রিন্টযোগ্য ভ্যারিয়েন্ট ID (প্রতি লাইনে একটি)
          </span>
          <textarea
            value={variantIdsText}
            onChange={(e) => setVariantIdsText(e.target.value)}
            rows={4}
            placeholder={"variant-id-1\nvariant-id-2"}
            className={`${INPUT_CLASS} font-mono text-xs`}
          />
          <span className="mt-1 block text-xs text-text-muted">
            তালিকার বাইরের কোনো ভ্যারিয়েন্টে কাস্টম প্রিন্ট হবে না। ভ্যারিয়েন্ট ID পণ্যের সম্পাদনা পেজে পাওয়া যায়।
          </span>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-text-main">
            প্রিন্টের রঙের তালিকা (প্রতি লাইনে একটি, ঐচ্ছিক)
          </span>
          <textarea
            value={colorsText}
            onChange={(e) => setColorsText(e.target.value)}
            rows={4}
            placeholder={"কালো\nসাদা\n#C0392B"}
            className={`${INPUT_CLASS} font-mono text-xs`}
          />
          <span className="mt-1 block text-xs text-text-muted">
            গ্রাহক চেকআউটে এই তালিকা থেকেই রঙ বেছে নেবেন; তালিকা ফাঁকা থাকলে রঙ বেছে নেওয়ার সুবিধাই থাকবে না
            (দোকানের ডিফল্ট কালিতেই ছাপা হবে)। #RRGGBB আকারে লিখলে চেকআউটে রঙের নমুনা দেখাবে।
          </span>
        </label>
      </div>
      <label className="mt-4 block">
        <span className="mb-1.5 block text-sm font-medium text-text-main">পরিবর্তনের কারণ (আবশ্যক)</span>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="যেমন: নতুন কাস্টম টি-শার্ট যোগ করা হলো"
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
