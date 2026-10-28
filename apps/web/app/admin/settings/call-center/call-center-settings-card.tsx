"use client";

// Call Center settings card — Settings > Call Center (doc 21, G3-17).
// Edits the seven `call_center.*` Settings keys that call-center code
// reads LIVE at decision time:
//   - supervisor board SLA thresholds (src/callcenter/supervisor-store.ts)
//   - follow-up automation timings + calling window
//     (src/callcenter/automation.ts, intSetting-clamped at read time)
//   - call-log retention window (src/callcenter/retention.ts)
// Until now they were writable only through the generic Settings API —
// no UI existed, the same gap the wave-28 Orders card closed for
// orders.rules.*. Every save goes through that same API
// (POST /api/v1/admin/settings { key, value, reason }), so each change
// is audited (settings.update) exactly like every other settings
// write, and a reason is required.
//
// Only keys whose value actually changed are written — saving an
// untouched form is a true no-op, which guarantees the round-trip
// property: consumers see exactly the same effective values before and
// after an untouched save.
//
// Editor ranges mirror the consumers' accepted ranges: SLA minutes
// 1–1440 (the supervisor store falls back to its default unless the
// value is a positive integer); the two automation minute keys accept
// 0–1440 because the registry + automation reader define 0 as a real
// value (0 = immediately for the no-answer SMS); the calling window is
// [start, end) in whole Dhaka hours, start 0–23, end 1–24 (24 =
// midnight, per automation.ts's clamp); retention 1–60 months
// (retention.ts accepts any positive integer; 60 is the editor cap).
import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { SETTINGS_B_STRINGS, type SettingsBStrings } from "../strings-b";

type SKey = keyof SettingsBStrings;

const KEYS = {
  slaConfirm: "call_center.sla_confirm_minutes",
  slaRescue: "call_center.sla_rescue_minutes",
  autoSmsNoAnswer: "call_center.auto_sms_no_answer_minutes",
  callbackReminder: "call_center.callback_reminder_minutes",
  callingStartHour: "call_center.calling_start_hour",
  callingEndHour: "call_center.calling_end_hour",
  logRetentionMonths: "call_center.log_retention_months",
} as const;

type FieldId = keyof typeof KEYS;

interface FieldDef {
  id: FieldId;
  labelKey: SKey;
  suffixKey: SKey;
  helpKey: SKey;
  min: number;
  max: number;
  defaultValue: number;
}

interface FieldGroupDef { titleKey: SKey; noteKey?: SKey; fields: FieldDef[] }

const FIELD_GROUPS: FieldGroupDef[] = [
  {
    titleKey: "ccGroupSla",
    fields: [
      { id: "slaConfirm", labelKey: "ccSlaConfirmLabel", suffixKey: "ccSuffixMinutes", helpKey: "ccSlaConfirmHelp", min: 1, max: 1440, defaultValue: 30 },
      { id: "slaRescue", labelKey: "ccSlaRescueLabel", suffixKey: "ccSuffixMinutes", helpKey: "ccSlaRescueHelp", min: 1, max: 1440, defaultValue: 60 },
    ],
  },
  {
    titleKey: "ccGroupAuto",
    noteKey: "ccGroupAutoNote",
    fields: [
      { id: "autoSmsNoAnswer", labelKey: "ccAutoSmsLabel", suffixKey: "ccSuffixMinutes", helpKey: "ccAutoSmsHelp", min: 0, max: 1440, defaultValue: 15 },
      { id: "callbackReminder", labelKey: "ccCallbackLabel", suffixKey: "ccSuffixMinutesBefore", helpKey: "ccCallbackHelp", min: 0, max: 1440, defaultValue: 10 },
    ],
  },
  {
    titleKey: "ccGroupWindow",
    noteKey: "ccGroupWindowNote",
    fields: [
      { id: "callingStartHour", labelKey: "ccStartLabel", suffixKey: "ccSuffixHour", helpKey: "ccStartHelp", min: 0, max: 23, defaultValue: 9 },
      { id: "callingEndHour", labelKey: "ccEndLabel", suffixKey: "ccSuffixHour", helpKey: "ccEndHelp", min: 1, max: 24, defaultValue: 21 },
    ],
  },
  {
    titleKey: "ccGroupRetention",
    fields: [
      { id: "logRetentionMonths", labelKey: "ccRetentionLabel", suffixKey: "ccSuffixMonths", helpKey: "ccRetentionHelp", min: 1, max: 60, defaultValue: 12 },
    ],
  },
];

const ALL_FIELDS: FieldDef[] = FIELD_GROUPS.flatMap((g) => g.fields);

export type CallCenterSettingsInitial = Record<FieldId, number>;

interface CallCenterSettingsCardProps {
  /** Effective values right now (DB row -> env -> built-in default,
   *  parsed server-side — the same numbers consumers enforce). */
  initial: CallCenterSettingsInitial;
  dbReady: boolean;
}

/** Parse an editor input: whole non-negative integers only. */
function parseField(raw: string, def: FieldDef, s: SettingsBStrings): { value: number } | { error: string } {
  const label = s[def.labelKey];
  const trimmed = raw.trim();
  if (trimmed === "") return { error: interpolate(s.ccErrEmpty, { label }) };
  if (!/^\d+$/.test(trimmed)) return { error: interpolate(s.ccErrInteger, { label }) };
  const value = Number.parseInt(trimmed, 10);
  if (value < def.min || value > def.max) {
    return { error: interpolate(s.ccErrRange, { label, min: def.min, max: def.max }) };
  }
  return { value };
}

export function CallCenterSettingsCard({ initial, dbReady }: CallCenterSettingsCardProps) {
  const { locale } = useLocale();
  const s = pick(locale, SETTINGS_B_STRINGS);
  const [values, setValues] = useState<Record<FieldId, string>>(() => {
    const out = {} as Record<FieldId, string>;
    for (const def of ALL_FIELDS) out[def.id] = String(initial[def.id]);
    return out;
  });
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState("");
  const [statusOk, setStatusOk] = useState(false);
  const [saving, setSaving] = useState(false);

  const parsed = new Map<FieldId, { value: number } | { error: string }>();
  for (const def of ALL_FIELDS) parsed.set(def.id, parseField(values[def.id], def, s));

  // Cross-field rule: the calling window [start, end) must be non-empty.
  const startParsed = parsed.get("callingStartHour");
  const endParsed = parsed.get("callingEndHour");
  const windowError =
    startParsed && "value" in startParsed && endParsed && "value" in endParsed && endParsed.value <= startParsed.value
      ? s.ccErrWindow
      : null;

  async function postSetting(key: string, value: string): Promise<string | null> {
    const res = await fetch("/api/v1/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value, reason: reason.trim() }),
    });
    if (res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    return data.error?.message ?? interpolate(s.saveFailedStatus, { status: res.status });
  }

  async function handleSave() {
    setStatus("");
    if (reason.trim() === "") {
      setStatusOk(false);
      setStatus(s.reasonRequired);
      return;
    }
    for (const def of ALL_FIELDS) {
      const p = parsed.get(def.id);
      if (p && "error" in p) {
        setStatusOk(false);
        setStatus(p.error);
        return;
      }
    }
    if (windowError !== null) {
      setStatusOk(false);
      setStatus(windowError);
      return;
    }

    // Diff against the effective initial state — only changed keys
    // are written; an untouched form writes nothing.
    const writes: { key: string; value: string }[] = [];
    for (const def of ALL_FIELDS) {
      const p = parsed.get(def.id);
      if (p && "value" in p && p.value !== initial[def.id]) {
        writes.push({ key: KEYS[def.id], value: String(p.value) });
      }
    }
    if (writes.length === 0) {
      setStatusOk(true);
      setStatus(s.noChanges);
      return;
    }

    setSaving(true);
    const savedKeys: string[] = [];
    try {
      for (const w of writes) {
        const failure = await postSetting(w.key, w.value);
        if (failure !== null) {
          setStatusOk(false);
          setStatus(
            savedKeys.length > 0
              ? interpolate(s.partialSave, { key: w.key, failure, count: savedKeys.length, keys: savedKeys.join(", ") })
              : interpolate(s.singleSaveFailed, { key: w.key, failure }),
          );
          return;
        }
        savedKeys.push(w.key);
      }
      setStatusOk(true);
      setStatus(interpolate(s.ccSavedMany, { count: savedKeys.length, keys: savedKeys.join(", ") }));
    } catch {
      setStatusOk(false);
      setStatus(s.networkUncertainSettings);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-card">
      <div className="brand-gradient h-1.5 w-full" aria-hidden="true" />
      <div className="p-5">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="brand-gradient flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-md">
            <Icon name="phone" size={20} />
          </span>
          <h2 className="font-display text-base font-semibold text-text-main">{s.ccCardTitle}</h2>
        </div>

        <div className="mt-4 rounded-xl border border-border bg-surface-2 px-4 py-3.5 text-sm">
          <p className="leading-relaxed">
            {s.ccCurrentA}
            <strong>{initial.slaConfirm}{s.ccCurrentMin}</strong>
            {s.ccCurrentRescue}
            <strong>{initial.slaRescue}{s.ccCurrentMin}</strong>
            {s.ccCurrentWindow}
            <strong>
              {initial.callingStartHour}:00–{initial.callingEndHour}:00
            </strong>
            {s.ccCurrentDhaka}
            <strong>{initial.logRetentionMonths}{s.ccCurrentMonths}</strong>.
          </p>
          {!dbReady && <span className="mt-1.5 block leading-relaxed text-rose-600">{s.ccDbWarning}</span>}
        </div>

        {FIELD_GROUPS.map((group) => (
          <fieldset key={group.titleKey} className="mt-6">
            <legend className="text-sm font-semibold text-text-main">{s[group.titleKey]}</legend>
            {group.noteKey && <p className="mt-1 text-xs leading-relaxed text-text-muted">{s[group.noteKey]}</p>}
            <div className="mt-3 grid gap-5 md:grid-cols-2">
              {group.fields.map((def) => {
                const p = parsed.get(def.id);
                return (
                  <label key={def.id} className="block">
                    <span className="text-sm font-medium">{s[def.labelKey]}</span>
                    <span className="mt-1 flex items-center gap-1.5">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={values[def.id]}
                        onChange={(e) =>
                          setValues((prev) => ({ ...prev, [def.id]: e.target.value }))
                        }
                        disabled={saving}
                        className="min-h-[44px] w-28 rounded-lg border border-border bg-card px-3 text-sm shadow-sm outline-none transition motion-fast focus:border-brand-500 focus:ring-[3px] focus:ring-brand-100"
                      />
                      <span className="text-sm text-text-muted">{s[def.suffixKey]}</span>
                      <span className="text-xs text-text-muted">
                        {interpolate(s.ccRangeDefault, { min: def.min, max: def.max, def: def.defaultValue })}
                      </span>
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-text-muted">{s[def.helpKey]}</span>
                    {p && "error" in p && <span className="mt-1 block text-xs text-rose-600">{p.error}</span>}
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}

        {windowError !== null && <p className="mt-3 text-xs text-rose-600">{windowError}</p>}

        <div className="mt-5 flex flex-wrap items-end gap-3">
          <label className="block grow basis-56">
            <span className="text-sm font-medium">{s.reasonRequiredShort}</span>
            <input
              type="text"
              placeholder={s.ccReasonPlaceholder}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={saving}
              className="mt-1 block min-h-[44px] w-full max-w-md rounded-lg border border-border bg-card px-3 text-sm shadow-sm outline-none transition motion-fast focus:border-brand-500 focus:ring-[3px] focus:ring-brand-100"
            />
          </label>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="brand-gradient inline-flex min-h-[44px] items-center rounded-md px-5 text-sm font-semibold text-white shadow-md transition motion-fast hover:shadow-lift hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? s.saving : s.saveSettings}
          </button>
        </div>

        {status && (
          <div
            role="status"
            className={`anim-pop-in mt-4 flex items-start gap-3 rounded-lg border px-4 py-3.5 text-sm ${
              statusOk ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"
            }`}
          >
            <span
              aria-hidden="true"
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                statusOk ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
              }`}
            >
              <Icon name={statusOk ? "check" : "alert"} size={16} />
            </span>
            <p className="leading-relaxed">{status}</p>
          </div>
        )}
      </div>
    </section>
  );
}
