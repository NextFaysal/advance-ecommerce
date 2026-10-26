"use client";

// Spin-the-wheel widget (ADV-18B). The SERVER decides every outcome
// from the configured weights (POST /api/v1/public/marketing/spin);
// this component only animates the wheel to the segment the server
// returned. Slice arcs are PROPORTIONAL to the configured weights
// and the true odds are printed under the wheel — no fake odds, no
// fake winners. Dismissal is remembered for the rest of the Dhaka
// day in localStorage.
import { useEffect, useMemo, useState } from "react";

export interface SpinWidgetSegment {
  id: string;
  labelBn: string;
  couponCode: string | null;
  weightBps: number;
  oddsPercent: number;
}

interface SpinAward {
  couponCode: string;
  templateCode: string;
  expiresAt: string;
}

interface SpinSuccess {
  outcome: "prize" | "none";
  segment: { id: string; labelBn: string };
  award: SpinAward | null;
  spinsLeftToday: number;
}

const SLICE_COLORS = ["#7c3aed", "#f59e0b", "#0ea5e9", "#ec4899", "#10b981", "#f97316", "#6366f1", "#84cc16", "#14b8a6", "#e11d48", "#8b5cf6", "#0891b2"];
const DISMISS_KEY = "ae:spin:dismissed";

function dhakaToday(): string {
  try {
    return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" });
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export function SpinWheelWidget({
  segments,
  dailyLimit,
  signedIn,
}: {
  segments: SpinWidgetSegment[];
  dailyLimit: number;
  signedIn: boolean;
}) {
  const [dismissed, setDismissed] = useState(true); // until localStorage is read
  const [phone, setPhone] = useState("");
  const [spinning, setSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [result, setResult] = useState<SpinSuccess | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(DISMISS_KEY) === dhakaToday());
    } catch {
      setDismissed(false);
    }
  }, []);

  const totalWeight = useMemo(() => segments.reduce((s, x) => s + x.weightBps, 0), [segments]);
  const gradient = useMemo(() => {
    let cursor = 0;
    const stops = segments.map((segment, i) => {
      const start = (cursor / totalWeight) * 360;
      cursor += segment.weightBps;
      const end = (cursor / totalWeight) * 360;
      return `${SLICE_COLORS[i % SLICE_COLORS.length]} ${start}deg ${end}deg`;
    });
    return `conic-gradient(from -90deg, ${stops.join(", ")})`;
  }, [segments, totalWeight]);

  const segmentCenterDeg = (id: string): number => {
    let cursor = 0;
    for (const segment of segments) {
      const start = (cursor / totalWeight) * 360;
      cursor += segment.weightBps;
      if (segment.id === id) return start + (segment.weightBps / totalWeight) * 180;
    }
    return 0;
  };

  if (dismissed || segments.length === 0) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, dhakaToday());
    } catch {
      // storage unavailable — dismissal lasts this render only
    }
    setDismissed(true);
  };

  const spin = async () => {
    setError(null);
    setResult(null);
    setSpinning(true);
    try {
      const res = await fetch("/api/v1/public/marketing/spin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(signedIn ? {} : { phone: phone.trim() }),
      });
      const json: unknown = await res.json().catch(() => null);
      const payload = (json ?? {}) as {
        data?: SpinSuccess;
        error?: { code?: string; message?: string };
      };
      if (!res.ok || payload.data === undefined) {
        setError(payload.error?.message ?? "কিছু একটা সমস্যা হয়েছে, আবার চেষ্টা করুন।");
        setSpinning(false);
        return;
      }
      const data = payload.data;
      // Rotate so the server-picked segment's centre lands at the
      // top pointer: five full turns + the offset to that centre.
      const center = segmentCenterDeg(data.segment.id);
      setRotation((prev) => {
        const base = Math.ceil(prev / 360) * 360 + 360 * 5;
        return base + (360 - center);
      });
      window.setTimeout(() => {
        setResult(data);
        setSpinning(false);
      }, 4300);
    } catch {
      setError("নেটওয়ার্ক সমস্যা — আবার চেষ্টা করুন।");
      setSpinning(false);
    }
  };

  return (
    <section aria-label="স্পিন হুইল" className="relative mt-5 overflow-hidden rounded-3xl bg-surface p-6 shadow-md ring-1 ring-border sm:p-8">
      <button
        type="button"
        onClick={dismiss}
        aria-label="বন্ধ করুন"
        className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-surface-2 text-text-muted transition hover:bg-surface-3"
      >
        ✕
      </button>
      <div className="flex flex-wrap items-center gap-8">
        <div className="relative mx-auto h-64 w-64 shrink-0 sm:h-72 sm:w-72">
          <div
            className="h-full w-full rounded-full shadow-inner ring-4 ring-white/60"
            style={{
              background: gradient,
              transform: `rotate(${rotation}deg)`,
              transition: spinning || rotation > 0 ? "transform 4.2s cubic-bezier(0.12, 0.8, 0.16, 1)" : undefined,
            }}
          />
          <div className="absolute left-1/2 top-0 h-0 w-0 -translate-x-1/2 -translate-y-1 border-x-8 border-t-[14px] border-x-transparent border-t-text-main" />
          <div className="absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-center text-[11px] font-extrabold text-brand-700 shadow">
            স্পিন
          </div>
          <div className="pointer-events-none absolute inset-0">
            {segments.map((segment) => {
              const center = segmentCenterDeg(segment.id);
              return (
                <span
                  key={segment.id}
                  className="absolute left-1/2 top-1/2 max-w-[6.5rem] -translate-x-1/2 text-center text-[11px] font-bold leading-tight text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.45)]"
                  style={{ transform: `translate(-50%,-50%) rotate(${center}deg) translateY(-6.4rem)` }}
                >
                  {segment.labelBn}
                </span>
              );
            })}
          </div>
        </div>

        <div className="min-w-64 flex-1">
          <h2 className="text-2xl font-extrabold text-text-main">ঘোরান আর জিতুন!</h2>
          <p className="mt-1 text-sm text-text-muted">
            প্রতিদিন {dailyLimit}টি স্পিন। ফলাফল সার্ভার থেকে নির্ধারিত হয় — প্রতিটি অংশের আসল জেতার সম্ভাবনা নিচে দেওয়া আছে।
          </p>
          <ul className="mt-3 space-y-1 text-sm text-text-muted">
            {segments.map((segment, i) => (
              <li key={segment.id} className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-sm" style={{ background: SLICE_COLORS[i % SLICE_COLORS.length] }} />
                <span className="font-medium text-text-main">{segment.labelBn}</span>
                <span>— {segment.oddsPercent}%</span>
                {segment.couponCode !== null ? <span className="text-text-subtle">(কুপন পুরস্কার)</span> : null}
              </li>
            ))}
          </ul>

          {!signedIn ? (
            <label className="mt-4 block text-sm font-medium text-text-main">
              মোবাইল নম্বর
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                inputMode="tel"
                placeholder="01XXXXXXXXX"
                className="mt-1 w-full max-w-xs rounded-xl border border-border bg-surface px-3 py-2 text-text-main"
              />
            </label>
          ) : null}

          <button
            type="button"
            onClick={() => void spin()}
            disabled={spinning || (!signedIn && phone.trim().length < 11)}
            className="mt-4 rounded-full bg-brand-600 px-6 py-2.5 font-bold text-white shadow transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {spinning ? "ঘুরছে…" : "স্পিন করুন"}
          </button>

          {error !== null ? (
            <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </p>
          ) : null}

          {result !== null ? (
            <div className="mt-4 rounded-2xl bg-surface-2 p-4" role="status">
              {result.outcome === "prize" && result.award !== null ? (
                <>
                  <p className="font-bold text-text-main">অভিনন্দন! আপনি জিতেছেন: {result.segment.labelBn}</p>
                  <p className="mt-2">
                    আপনার কুপন কোড:{" "}
                    <code className="rounded-lg bg-surface px-2 py-1 font-mono text-base font-extrabold text-brand-700 ring-1 ring-border">
                      {result.award.couponCode}
                    </code>
                  </p>
                  <p className="mt-1 text-sm text-text-muted">
                    চেকআউটে কোডটি ব্যবহার করুন। মেয়াদ:{" "}
                    {new Date(result.award.expiresAt).toLocaleDateString("bn-BD", { day: "numeric", month: "long", year: "numeric" })}
                  </p>
                </>
              ) : (
                <p className="font-bold text-text-main">{result.segment.labelBn}</p>
              )}
              <p className="mt-1 text-sm text-text-muted">
                {result.spinsLeftToday > 0 ? `আজ আরও ${result.spinsLeftToday}টি স্পিন বাকি আছে।` : "আজকের স্পিন শেষ — আগামীকাল আবার আসুন!"}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
