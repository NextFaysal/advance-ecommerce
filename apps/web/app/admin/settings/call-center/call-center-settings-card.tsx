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
  label: string;
  suffix: string;
  help: string;
  min: number;
  max: number;
  defaultValue: number;
}

const FIELD_GROUPS: { title: string; note?: string; fields: FieldDef[] }[] = [
  {
    title: "SLA সীমা (সুপারভাইজার বোর্ড)",
    fields: [
      {
        id: "slaConfirm",
        label: "কনফার্মেশন SLA",
        suffix: "মিনিট",
        help: "PENDING_ORDER টাস্ক তৈরি হওয়ার পর এতক্ষণ চেষ্টা না হলে সুপারভাইজার বোর্ডে SLA ভঙ্গ হিসেবে দেখায়।",
        min: 1,
        max: 1440,
        defaultValue: 30,
      },
      {
        id: "slaRescue",
        label: "রেসকিউ SLA",
        suffix: "মিনিট",
        help: "FAILED_DELIVERY রেসকিউ টাস্কের জন্য একই নিয়ম — এতক্ষণ চেষ্টা না হলে SLA ভঙ্গ।",
        min: 1,
        max: 1440,
        defaultValue: 60,
      },
    ],
  },
  {
    title: "ফলো-আপ অটোমেশন SMS-এর সময়",
    note: "এই সময়গুলো তখনই কাজ করে যখন অটোমেশন চালু থাকে (module.call_center_automation kill-switch) এবং worker চলমান থাকে — মান সেভ করলেই SMS যাবে না।",
    fields: [
      {
        id: "autoSmsNoAnswer",
        label: "NO_ANSWER SMS-এর বিরতি",
        suffix: "মিনিট",
        help: "ফোন না ধরলে (NO_ANSWER) এত মিনিট পর 'আমরা যোগাযোগের চেষ্টা করেছি' SMS পাঠানো হয়। 0 = সাথে সাথে।",
        min: 0,
        max: 1440,
        defaultValue: 15,
      },
      {
        id: "callbackReminder",
        label: "কলব্যাক রিমাইন্ডার SMS",
        suffix: "মিনিট আগে",
        help: "নির্ধারিত কলব্যাকের এত মিনিট আগে রিমাইন্ডার SMS যায় (সেই মুহূর্ত পার হয়ে গেলে সাথে সাথে)।",
        min: 0,
        max: 1440,
        defaultValue: 10,
      },
    ],
  },
  {
    title: "কলিং সময়সীমা (ঢাকা সময়)",
    note: "NO_ANSWER রিট্রাই শুধু এই উইন্ডোর মধ্যেই নির্ধারিত হয় — বাইরে পড়লে পরের উইন্ডো খোলার সময়ে সরিয়ে নেওয়া হয়। উইন্ডো হলো [শুরু, শেষ) — যেমন 9–21 মানে সকাল ৯টা থেকে রাত ৯টার আগ পর্যন্ত।",
    fields: [
      {
        id: "callingStartHour",
        label: "কলিং শুরুর ঘণ্টা",
        suffix: "টা",
        help: "0–23-এর মধ্যে পূর্ণ ঘণ্টা।",
        min: 0,
        max: 23,
        defaultValue: 9,
      },
      {
        id: "callingEndHour",
        label: "কলিং শেষের ঘণ্টা",
        suffix: "টা",
        help: "শুরুর ঘণ্টার চেয়ে বড় হতে হবে। 24 = মধ্যরাত (রাত ১২টা) পর্যন্ত।",
        min: 1,
        max: 24,
        defaultValue: 21,
      },
    ],
  },
  {
    title: "ডেটা সংরক্ষণ",
    fields: [
      {
        id: "logRetentionMonths",
        label: "কল-লগ সংরক্ষণের মেয়াদ",
        suffix: "মাস",
        help: "এর চেয়ে পুরনো কল-লগের free-text (নোট/QA মন্তব্য) ও শেষ হয়ে যাওয়া টাস্কের ব্যক্তিগত তথ্য (পুরো ফোন, নাম, নোট) retention job বেনামি করে — ফলাফল, disposition, স্কোর ও সময় থেকে যায়। Job-টি নির্ধারিত সময়ে চালালে তবেই প্রয়োগ হয়।",
        min: 1,
        max: 60,
        defaultValue: 12,
      },
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
function parseField(raw: string, def: FieldDef): { value: number } | { error: string } {
  const trimmed = raw.trim();
  if (trimmed === "") return { error: `${def.label}: মান খালি রাখা যাবে না — একটি সংখ্যা লিখুন।` };
  if (!/^\d+$/.test(trimmed)) return { error: `${def.label}: শুধু পূর্ণ সংখ্যা লিখুন (দশমিক বা অক্ষর নয়)।` };
  const value = Number.parseInt(trimmed, 10);
  if (value < def.min || value > def.max) {
    return { error: `${def.label}: মান ${def.min} থেকে ${def.max}-এর মধ্যে হতে হবে।` };
  }
  return { value };
}

export function CallCenterSettingsCard({ initial, dbReady }: CallCenterSettingsCardProps) {
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
  for (const def of ALL_FIELDS) parsed.set(def.id, parseField(values[def.id], def));

  // Cross-field rule: the calling window [start, end) must be non-empty.
  const startParsed = parsed.get("callingStartHour");
  const endParsed = parsed.get("callingEndHour");
  const windowError =
    startParsed && "value" in startParsed && endParsed && "value" in endParsed && endParsed.value <= startParsed.value
      ? "কলিং উইন্ডো অবৈধ: শেষের ঘণ্টা শুরুর ঘণ্টার চেয়ে বড় হতে হবে।"
      : null;

  async function postSetting(key: string, value: string): Promise<string | null> {
    const res = await fetch("/api/v1/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value, reason: reason.trim() }),
    });
    if (res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    return data.error?.message ?? `সেভ করা যায়নি (${res.status})`;
  }

  async function handleSave() {
    setStatus("");
    if (reason.trim() === "") {
      setStatusOk(false);
      setStatus("পরিবর্তনের কারণ লিখুন — এটি অডিট লগে সংরক্ষিত থাকে।");
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
      setStatus("কোনো পরিবর্তন নেই — সব মান আগের মতোই আছে, কিছুই সেভ করা হয়নি।");
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
              ? `${w.key} সেভ করা যায়নি: ${failure} — তবে আগের ${savedKeys.length}টি পরিবর্তন সেভ হয়ে গেছে (${savedKeys.join(", ")})।`
              : `${w.key} সেভ করা যায়নি: ${failure}`,
          );
          return;
        }
        savedKeys.push(w.key);
      }
      setStatusOk(true);
      setStatus(
        `সেভ হয়েছে — ${savedKeys.length}টি সেটিং বদলেছে (${savedKeys.join(", ")})। নতুন মান পরের সিদ্ধান্ত/পাঠানোর মুহূর্ত থেকেই কার্যকর (কোড নতুন করে চালু করা লাগবে না)।`,
      );
    } catch {
      setStatusOk(false);
      setStatus("সার্ভারের সঙ্গে যোগাযোগ করা যায়নি — কোন সেটিং সেভ হয়েছে তা নিশ্চিত নয়; পেজটি আবার লোড করে যাচাই করুন।");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-card">
      <div className="brand-gradient h-1.5 w-full" aria-hidden="true" />
      <div className="p-5">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="brand-gradient flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-md">
            <Icon name="phone" size={20} />
          </span>
          <h2 className="font-display text-base font-semibold text-text-main">কল সেন্টার সময়সীমা ও সংরক্ষণ</h2>
        </div>

        <div className="mt-4 rounded-xl border border-border bg-surface-2 px-4 py-3.5 text-sm">
          <p className="leading-relaxed">
            বর্তমানে কার্যকর: SLA — কনফার্ম <strong>{initial.slaConfirm} মিনিট</strong> · রেসকিউ{" "}
            <strong>{initial.slaRescue} মিনিট</strong> · কলিং উইন্ডো{" "}
            <strong>
              {initial.callingStartHour}:00–{initial.callingEndHour}:00
            </strong>{" "}
            (ঢাকা) · কল-লগ সংরক্ষণ <strong>{initial.logRetentionMonths} মাস</strong>।
          </p>
          {!dbReady && (
            <span className="mt-1.5 block leading-relaxed text-rose-600">
              সতর্কতা: ডাটাবেস থেকে বর্তমান মান পড়া যায়নি — উপরে বিল্ট-ইন ডিফল্ট দেখানো হচ্ছে। সেভ করলে সার্ভার ত্রুটি দেখালে কিছুই বদলাবে না।
            </span>
          )}
        </div>

        {FIELD_GROUPS.map((group) => (
          <fieldset key={group.title} className="mt-6">
            <legend className="text-sm font-semibold text-text-main">{group.title}</legend>
            {group.note && <p className="mt-1 text-xs leading-relaxed text-text-muted">{group.note}</p>}
            <div className="mt-3 grid gap-5 md:grid-cols-2">
              {group.fields.map((def) => {
                const p = parsed.get(def.id);
                return (
                  <label key={def.id} className="block">
                    <span className="text-sm font-medium">{def.label}</span>
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
                      <span className="text-sm text-text-muted">{def.suffix}</span>
                      <span className="text-xs text-text-muted">
                        ({def.min}–{def.max} · ডিফল্ট {def.defaultValue})
                      </span>
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-text-muted">{def.help}</span>
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
            <span className="text-sm font-medium">পরিবর্তনের কারণ (অডিটের জন্য আবশ্যিক)</span>
            <input
              type="text"
              placeholder="যেমন: ঈদের ভিড়ে কনফার্মেশন SLA 30 থেকে 45 মিনিট করা হলো"
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
            {saving ? "সেভ হচ্ছে…" : "সেটিংস সেভ করুন"}
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
