"use client";

/**
 * Call-scripts editor (client) — C3. Receives the effective scripts as
 * plain props from the server page and saves per source via
 * PUT /api/v1/admin/call-center/scripts. Each save bumps the source's
 * version (built-in = v1); the response's saved script replaces local
 * state so the new version shows immediately. Steps can be added,
 * removed and reordered; the Bangla prompt is required, English is an
 * optional training gloss.
 */
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

export interface ScriptStepData {
  key: string;
  promptBn: string;
  promptEn: string;
}

export interface ScriptSourceData {
  source: string;
  version: number;
  versionLabel: string;
  isDefault: boolean;
  steps: ScriptStepData[];
  updatedAt: string | null;
}

const SOURCE_LABELS: Record<string, { bn: string; en: string }> = {
  PENDING_ORDER: { bn: "পেন্ডিং অর্ডার নিশ্চিতকরণ", en: "Pending order confirmation" },
  FAILED_DELIVERY: { bn: "ব্যর্থ ডেলিভারি উদ্ধার", en: "Failed delivery rescue" },
  ABANDONED_CHECKOUT: { bn: "পরিত্যক্ত চেকআউট", en: "Abandoned checkout" },
  MANUAL: { bn: "ম্যানুয়াল টাস্ক", en: "Manual task" },
  DEFAULT: { bn: "ডিফল্ট", en: "Default fallback" },
};

function slugifyKey(text: string, index: number): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || `step-${index + 1}`;
}

export function ScriptsEditor({ initialScripts }: { initialScripts: ScriptSourceData[] }) {
  const [scripts, setScripts] = useState<ScriptSourceData[]>(initialScripts);
  const [savingSource, setSavingSource] = useState<string | null>(null);
  const [notice, setNotice] = useState<Record<string, string>>({});
  const [error, setError] = useState<Record<string, string>>({});

  function patch(source: string, steps: ScriptStepData[]) {
    setScripts((prev) => prev.map((s) => (s.source === source ? { ...s, steps } : s)));
  }

  function patchStep(source: string, idx: number, field: keyof ScriptStepData, value: string) {
    const script = scripts.find((s) => s.source === source);
    if (!script) return;
    patch(source, script.steps.map((st, i) => (i === idx ? { ...st, [field]: value } : st)));
  }

  function moveStep(source: string, idx: number, dir: -1 | 1) {
    const script = scripts.find((s) => s.source === source);
    if (!script) return;
    const target = idx + dir;
    if (target < 0 || target >= script.steps.length) return;
    const steps = [...script.steps];
    const [item] = steps.splice(idx, 1);
    steps.splice(target, 0, item);
    patch(source, steps);
  }

  async function save(script: ScriptSourceData) {
    setSavingSource(script.source);
    setError((p) => ({ ...p, [script.source]: "" }));
    setNotice((p) => ({ ...p, [script.source]: "" }));
    try {
      const steps = script.steps.map((st, i) => ({
        key: slugifyKey(st.key || st.promptBn, i),
        promptBn: st.promptBn.trim(),
        ...(st.promptEn.trim() ? { promptEn: st.promptEn.trim() } : {}),
      }));
      const res = await fetch("/api/v1/admin/call-center/scripts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: script.source, steps }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        data?: { script: ScriptSourceData };
        error?: { message?: string };
      };
      if (!res.ok || !json.data?.script) {
        setError((p) => ({ ...p, [script.source]: json.error?.message ?? `সেভ ব্যর্থ হয়েছে (${res.status})` }));
        return;
      }
      const saved = json.data.script;
      setScripts((prev) =>
        prev.map((s) =>
          s.source === saved.source
            ? {
                ...saved,
                steps: saved.steps.map((st) => ({ key: st.key, promptBn: st.promptBn, promptEn: st.promptEn ?? "" })),
                updatedAt: saved.updatedAt ?? null,
              }
            : s,
        ),
      );
      setNotice((p) => ({ ...p, [script.source]: `সেভ হয়েছে — নতুন সংস্করণ ${saved.versionLabel}।` }));
    } catch {
      setError((p) => ({ ...p, [script.source]: "নেটওয়ার্ক ত্রুটি — আবার চেষ্টা করুন।" }));
    } finally {
      setSavingSource(null);
    }
  }

  return (
    <div className="space-y-8">
      {scripts.map((script) => {
        const label = SOURCE_LABELS[script.source] ?? { bn: script.source, en: script.source };
        return (
          <Card key={script.source} className="p-5">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold">{label.bn}</h2>
              <span className="text-sm text-text-muted">({label.en})</span>
              <Badge tone={script.isDefault ? "warning" : "success"}>{script.versionLabel}</Badge>
              {script.isDefault ? (
                <Badge tone="warning">বিল্ট-ইন ডিফল্ট — এখনো কাস্টম সেভ হয়নি</Badge>
              ) : (
                <Badge tone="info">কাস্টম স্ক্রিপ্ট</Badge>
              )}
            </div>
            <p className="mb-4 text-sm text-text-muted">
              {script.isDefault
                ? "এই ধরনের জন্য এখনো আলাদা স্ক্রিপ্ট সেভ হয়নি — নিচের ধাপগুলো বিল্ট-ইন কনফার্মেশন স্ক্রিপ্ট (শুরুর খসড়া হিসেবে)। সেভ করলেই এটি এই ধরনের নিজস্ব স্ক্রিপ্ট হয়ে যাবে।"
                : `সর্বশেষ সেভ: ${script.updatedAt ? new Date(script.updatedAt).toLocaleString("bn-BD", { timeZone: "Asia/Dhaka" }) : "—"}`}
            </p>

            <div className="space-y-3">
              {script.steps.map((step, idx) => (
                <div key={idx} className="rounded-md border border-border p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">ধাপ {idx + 1}</span>
                    <input
                      className="h-9 w-44 rounded-md border border-border px-2 text-sm"
                      value={step.key}
                      onChange={(e) => patchStep(script.source, idx, "key", e.target.value)}
                      placeholder="step-key"
                      aria-label="Step key"
                    />
                    <span className="ml-auto flex gap-1">
                      <button type="button" className="rounded-md border border-border px-2 py-1 text-sm" onClick={() => moveStep(script.source, idx, -1)} disabled={idx === 0} aria-label="Move up">↑</button>
                      <button type="button" className="rounded-md border border-border px-2 py-1 text-sm" onClick={() => moveStep(script.source, idx, 1)} disabled={idx === script.steps.length - 1} aria-label="Move down">↓</button>
                      <button
                        type="button"
                        className="rounded-md border border-border px-2 py-1 text-sm text-rose-700"
                        onClick={() => patch(script.source, script.steps.filter((_, i) => i !== idx))}
                        disabled={script.steps.length <= 1}
                        aria-label="Remove step"
                      >
                        মুছুন
                      </button>
                    </span>
                  </div>
                  <textarea
                    className="mb-2 w-full rounded-md border border-border px-2 py-2 text-sm"
                    rows={2}
                    value={step.promptBn}
                    onChange={(e) => patchStep(script.source, idx, "promptBn", e.target.value)}
                    placeholder="বাংলা স্ক্রিপ্ট (আবশ্যক) — {name}, {total} জাতীয় placeholder ব্যবহার করা যায়"
                    aria-label="Bangla prompt"
                  />
                  <input
                    className="w-full rounded-md border border-border px-2 py-2 text-sm"
                    value={step.promptEn}
                    onChange={(e) => patchStep(script.source, idx, "promptEn", e.target.value)}
                    placeholder="English gloss (optional, for training)"
                    aria-label="English prompt"
                  />
                </div>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="rounded-md border border-border px-3 py-2 text-sm"
                onClick={() => patch(script.source, [...script.steps, { key: "", promptBn: "", promptEn: "" }])}
              >
                + ধাপ যোগ করুন
              </button>
              <button
                type="button"
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                onClick={() => save(script)}
                disabled={savingSource === script.source || script.steps.some((st) => !st.promptBn.trim())}
              >
                {savingSource === script.source ? "সেভ হচ্ছে…" : `সেভ করুন (নতুন সংস্করণ হবে)`}
              </button>
              {notice[script.source] ? <span className="text-sm text-emerald-700">{notice[script.source]}</span> : null}
              {error[script.source] ? <span className="text-sm text-rose-700">{error[script.source]}</span> : null}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
