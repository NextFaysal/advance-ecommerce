"use client";

/**
 * Call-scripts editor (client) — C3. Receives the effective scripts as
 * plain props from the server page and saves per source via
 * PUT /api/v1/admin/call-center/scripts. Each save bumps the source's
 * version (built-in = v1); the response's saved script replaces local
 * state so the new version shows immediately. Steps can be added,
 * removed and reordered; the Bangla prompt is required, English is an
 * optional training gloss.
 *
 * CD3 (doc 20) presentation pass: each source card gains a state
 * accent (amber = built-in fallback in effect, emerald = custom
 * saved), an icon version chip (v{n} — the payload's versionLabel)
 * and numbered step discs. Fields and the save call are untouched.
 * The header carries CD0's SourceChip for the four real sources;
 * the DEFAULT pseudo-source has no SOURCE_VISUAL entry, so it keeps
 * this file's pre-existing SOURCE_LABELS title only. Version HISTORY
 * is not rendered: the effective-scripts payload carries only the
 * current version + updatedAt (src/callcenter/scripts-store.ts), no
 * history list.
 */
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { SourceChip } from "@/callcenter/components/badges";
import { SOURCE_VISUAL, type StatusVisual } from "@/callcenter/components/visuals";
import type { CallQueueSource } from "@/callcenter/types";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, intlLocale, pick } from "@/i18n/locale";
import { CALL_CENTER_STRINGS, type CallCenterStrings } from "../strings";

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

function sourceLabel(s: CallCenterStrings, source: string): string {
  switch (source) {
    case "PENDING_ORDER":
      return s.srcScriptPendingOrder;
    case "FAILED_DELIVERY":
      return s.srcScriptFailedDelivery;
    case "ABANDONED_CHECKOUT":
      return s.srcScriptAbandoned;
    case "MANUAL":
      return s.srcScriptManual;
    case "DEFAULT":
      return s.srcScriptDefault;
    default:
      return source;
  }
}

function slugifyKey(text: string, index: number): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || `step-${index + 1}`;
}

export function ScriptsEditor({ initialScripts }: { initialScripts: ScriptSourceData[] }) {
  const { locale } = useLocale();
  const s = pick(locale, CALL_CENTER_STRINGS);
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
        setError((p) => ({ ...p, [script.source]: json.error?.message ?? interpolate(s.saveFailed, { status: res.status }) }));
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
      setNotice((p) => ({ ...p, [script.source]: interpolate(s.savedNotice, { version: saved.versionLabel }) }));
    } catch {
      setError((p) => ({ ...p, [script.source]: s.networkErrorRetry }));
    } finally {
      setSavingSource(null);
    }
  }

  return (
    <div className="space-y-8">
      {scripts.map((script) => {
        const sourceV = (SOURCE_VISUAL as Record<string, StatusVisual>)[script.source];
        return (
          <Card
            key={script.source}
            className={`border-l-4 p-5 ${script.isDefault ? "border-l-amber-400" : "border-l-emerald-400"}`}
          >
            <div className="mb-1 flex flex-wrap items-center gap-2">
              {sourceV ? <SourceChip source={script.source as CallQueueSource} lang={locale} /> : null}
              <h2 className="text-base font-semibold">{sourceLabel(s, script.source)}</h2>
              <span className="ml-auto flex flex-wrap items-center gap-2">
                <Badge tone="info" icon={<Icon name="tag" size={12} />}>
                  {script.versionLabel}
                </Badge>
                {script.isDefault ? (
                  <Badge tone="warning" icon={<Icon name="info" size={12} />}>
                    {s.builtinBadge}
                  </Badge>
                ) : (
                  <Badge tone="success" icon={<Icon name="check" size={12} />}>
                    {s.customBadge}
                  </Badge>
                )}
              </span>
            </div>
            <p className="mb-4 text-sm text-text-muted">
              {script.isDefault
                ? s.defaultStepsNote
                : interpolate(s.lastSaved, { date: script.updatedAt ? new Date(script.updatedAt).toLocaleString(intlLocale(locale), { timeZone: "Asia/Dhaka" }) : "—" })}
            </p>

            <div className="space-y-3">
              {script.steps.map((step, idx) => (
                <div key={idx} className="rounded-md border border-border p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-2 text-sm font-medium">
                      <span
                        aria-hidden="true"
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 font-mono text-xs font-bold text-brand-700"
                      >
                        {idx + 1}
                      </span>
                      {s.stepWord}
                    </span>
                    <input
                      className="h-9 w-44 rounded-md border border-border px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                      value={step.key}
                      onChange={(e) => patchStep(script.source, idx, "key", e.target.value)}
                      placeholder="step-key"
                      aria-label={s.stepKeyAria}
                    />
                    <span className="ml-auto flex gap-1">
                      <button type="button" className="rounded-md border border-border px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300" onClick={() => moveStep(script.source, idx, -1)} disabled={idx === 0} aria-label={s.moveUpAria}>↑</button>
                      <button type="button" className="rounded-md border border-border px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300" onClick={() => moveStep(script.source, idx, 1)} disabled={idx === script.steps.length - 1} aria-label={s.moveDownAria}>↓</button>
                      <button
                        type="button"
                        className="rounded-md border border-border px-2 py-1 text-sm text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                        onClick={() => patch(script.source, script.steps.filter((_, i) => i !== idx))}
                        disabled={script.steps.length <= 1}
                        aria-label={s.removeStepAria}
                      >
                        {s.removeStepBtn}
                      </button>
                    </span>
                  </div>
                  <textarea
                    className="mb-2 w-full rounded-md border border-border px-2 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                    rows={2}
                    value={step.promptBn}
                    onChange={(e) => patchStep(script.source, idx, "promptBn", e.target.value)}
                    placeholder={s.banglaPromptPlaceholder}
                    aria-label={s.banglaPromptAria}
                  />
                  <input
                    className="w-full rounded-md border border-border px-2 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                    value={step.promptEn}
                    onChange={(e) => patchStep(script.source, idx, "promptEn", e.target.value)}
                    placeholder={s.englishPromptPlaceholder}
                    aria-label={s.englishPromptAria}
                  />
                </div>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="rounded-md border border-border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                onClick={() => patch(script.source, [...script.steps, { key: "", promptBn: "", promptEn: "" }])}
              >
                {s.addStepBtn}
              </button>
              <button
                type="button"
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                onClick={() => save(script)}
                disabled={savingSource === script.source || script.steps.some((st) => !st.promptBn.trim())}
              >
                {savingSource === script.source ? s.savingText : s.saveBtn}
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
