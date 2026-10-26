"use client";

import { useState } from "react";
import type { ThemeTokens } from "@/lib/themes";

interface Props {
  tokens: ThemeTokens;
  themeName: string;
}

export function ThemeLivePreview({ tokens, themeName }: Props) {
  const [previewMode, setPreviewMode] = useState<"light" | "dark">("light");

  const currentTokens =
    previewMode === "light"
      ? tokens.light
      : { ...tokens.light, ...tokens.dark };

  const styleObject = Object.entries(currentTokens).reduce(
    (acc, [k, v]) => {
      acc[k] = v;
      return acc;
    },
    {} as Record<string, string>,
  );

  return (
    <div className="sticky top-6 rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between border-b border-border pb-3">
        <div>
          <h3 className="text-sm font-bold text-text-main">লাইভ প্রিভিউ</h3>
          <p className="text-xs text-text-muted">
            {themeName || "নামহীন থিম"} ({previewMode === "light" ? "লাইট মোড" : "ডার্ক মোড"})
          </p>
        </div>
        <div className="inline-flex rounded-lg border border-border bg-muted p-0.5 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setPreviewMode("light")}
            className={`rounded-md px-2.5 py-1 transition-colors ${
              previewMode === "light"
                ? "bg-card text-text-main shadow-sm"
                : "text-text-muted hover:text-text-main"
            }`}
          >
            ☀️ Light
          </button>
          <button
            type="button"
            onClick={() => setPreviewMode("dark")}
            className={`rounded-md px-2.5 py-1 transition-colors ${
              previewMode === "dark"
                ? "bg-card text-text-main shadow-sm"
                : "text-text-muted hover:text-text-main"
            }`}
          >
            🌙 Dark
          </button>
        </div>
      </div>

      {/* Styled sandbox container */}
      <div
        className={`rounded-xl border border-border p-4 transition-colors ${
          previewMode === "dark" ? "dark bg-background text-foreground" : "bg-background text-foreground"
        }`}
        style={styleObject as React.CSSProperties}
      >
        {/* Mock Store Header */}
        <div className="mb-4 flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2 shadow-sm">
          <div className="flex items-center gap-2">
            <span
              className="h-6 w-6 rounded-md shadow-sm"
              style={{ background: currentTokens["--brand-gradient"] || "hsl(var(--primary))" }}
            />
            <span className="text-xs font-bold text-text-main">শপ প্রিভিউ</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-success" />
            <span className="text-[11px] font-medium text-text-muted">অনলাইন</span>
          </div>
        </div>

        {/* Mock Hero Banner */}
        <div
          className="mb-4 rounded-xl p-4 text-center text-primary-foreground shadow-sm"
          style={{ background: currentTokens["--brand-gradient"] || "hsl(var(--primary))" }}
        >
          <p className="text-xs uppercase tracking-wider opacity-90">স্পেশাল অফার</p>
          <h4 className="font-display text-base font-bold">নতুন কালেকশন ২৫% ছাড়</h4>
          <button
            type="button"
            className="mt-2 rounded-full bg-card px-3 py-1 text-xs font-bold text-text-main shadow-sm hover:opacity-90"
          >
            এখনই দেখুন →
          </button>
        </div>

        {/* Mock Product Card */}
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="relative mb-2 aspect-[4/3] w-full rounded-lg bg-muted flex items-center justify-center text-xs text-muted-foreground overflow-hidden">
            <span>📦 প্রোডাক্ট ফটো</span>
            <span className="absolute left-2 top-2 rounded bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">
              NEW
            </span>
          </div>
          <p className="text-[11px] text-text-muted">ক্যাটাগরি • প্রিমিয়াম</p>
          <h5 className="text-xs font-bold text-text-main">ওয়্যারলেস হেডফোন প্রো</h5>
          <div className="mt-2 flex items-center justify-between">
            <div>
              <span className="text-xs font-bold text-primary">৳ ২,৪৯৯</span>
              <span className="ml-1 text-[10px] line-through text-text-muted">৳ ৩,২০০</span>
            </div>
            <button
              type="button"
              className="rounded-lg bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground shadow-sm transition hover:opacity-90"
            >
              কার্টে যোগ করুন
            </button>
          </div>
        </div>

        {/* Mock UI State Chips */}
        <div className="mt-4 flex flex-wrap gap-1.5">
          <span className="rounded bg-success/15 px-2 py-0.5 text-[10px] font-semibold text-success">
            স্টকে আছে
          </span>
          <span className="rounded bg-accent/20 px-2 py-0.5 text-[10px] font-semibold text-accent">
            অ্যাকসেন্ট
          </span>
          <span className="rounded bg-destructive/15 px-2 py-0.5 text-[10px] font-semibold text-destructive">
            সীমিত স্টক
          </span>
        </div>
      </div>
    </div>
  );
}
