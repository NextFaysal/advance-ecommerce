import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Icon } from "@/components/ui/icon";
import { SETTING_DEFAULTS, getSetting } from "@/lib/settings";
import { CallCenterSettingsCard, type CallCenterSettingsInitial } from "./call-center-settings-card";

// Admin > Settings > Call Center — SLA thresholds, automation SMS
// timings, calling window, log retention (doc 21, G3-17). Until now
// the seven `call_center.*` keys could only be changed by writing the
// Settings store through the generic API — no UI existed, the same gap
// the wave-28 Orders card closed for orders.rules.*. This page is
// that UI: it reads the effective values server-side through
// getSetting() (DB row -> env -> built-in default — the same
// resolution the consumers use), and the card saves through the
// standard Settings API, which requires a reason and writes the
// settings.update audit row. No call-center behaviour changes here —
// only who can edit the values its code already reads live:
//   - SLA thresholds: src/callcenter/supervisor-store.ts
//   - automation timings + calling window: src/callcenter/automation.ts
//   - retention window: src/callcenter/retention.ts
export const dynamic = "force-dynamic";

const KEY_DEFS = [
  { id: "slaConfirm", key: "call_center.sla_confirm_minutes" },
  { id: "slaRescue", key: "call_center.sla_rescue_minutes" },
  { id: "autoSmsNoAnswer", key: "call_center.auto_sms_no_answer_minutes" },
  { id: "callbackReminder", key: "call_center.callback_reminder_minutes" },
  { id: "callingStartHour", key: "call_center.calling_start_hour" },
  { id: "callingEndHour", key: "call_center.calling_end_hour" },
  { id: "logRetentionMonths", key: "call_center.log_retention_months" },
] as const;

/** Effective integer for a key: the stored string parsed, falling
 *  back to the registered built-in default when missing or invalid —
 *  the same fail-safe shape the consumers apply at read time. */
function effectiveInt(key: string, raw: string | null): number {
  const fallback = Number.parseInt(SETTING_DEFAULTS[key]?.value ?? "0", 10);
  if (raw === null) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

export default async function CallCenterSettingsPage() {
  let dbReady = true;
  const initial = {} as CallCenterSettingsInitial;
  try {
    const raws = await Promise.all(KEY_DEFS.map((d) => getSetting(d.key)));
    KEY_DEFS.forEach((d, i) => {
      initial[d.id] = effectiveInt(d.key, raws[i] ?? null);
    });
  } catch {
    dbReady = false;
    for (const d of KEY_DEFS) initial[d.id] = effectiveInt(d.key, null);
  }

  return (
    <main className="min-w-0">
      <PageHeader
        title="কল সেন্টার — SLA, অটোমেশন সময় ও সংরক্ষণ"
        description="সুপারভাইজার বোর্ডের SLA সীমা, ফলো-আপ অটোমেশন SMS-এর সময়, বৈধ কলিং উইন্ডো এবং কল-লগ সংরক্ষণের মেয়াদ — সব এই পেজ থেকে। প্রতিটি পরিবর্তন কারণসহ অডিট লগে থাকে।"
        breadcrumb="সেটিংস / কল সেন্টার"
        actions={
          <Link
            href="/admin/settings"
            className="inline-flex min-h-[44px] items-center rounded-md border border-border bg-card px-4 text-sm font-medium transition motion-fast hover:border-brand-300"
          >
            ← সব সেটিংস
          </Link>
        }
      />

      <section className="mt-4 rounded-lg border border-border/70 bg-card p-5 shadow-card">
        <h2 className="flex items-center gap-2.5 font-display text-base font-semibold text-text-main">
          <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-brand-50 text-brand-600">
            <Icon name="info" size={17} />
          </span>
          এই পেজের মানগুলো দিয়ে কী হয়?
        </h2>
        <ul className="mt-3 space-y-2.5 text-sm leading-relaxed text-text-muted">
          <li className="flex gap-2.5">
            <span aria-hidden="true" className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-inset ring-emerald-100">
              <Icon name="check" size={12} />
            </span>
            <span>
              <strong>SLA সীমা:</strong> সুপারভাইজার বোর্ড প্রতিটি খোলা টাস্কের বয়স এই সীমার সঙ্গে তুলনা
              করে — কনফার্মেশন (PENDING_ORDER) ও রেসকিউ (FAILED_DELIVERY) টাস্কের জন্য আলাদা সীমা। মান দুটি
              বোর্ড প্রতিবার পড়ে, তাই বদলালেই পরের লোড থেকে কার্যকর।
            </span>
          </li>
          <li className="flex gap-2.5">
            <span aria-hidden="true" className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-inset ring-emerald-100">
              <Icon name="check" size={12} />
            </span>
            <span>
              <strong>অটোমেশন SMS-এর সময়:</strong> NO_ANSWER-এর পর ফলো-আপ SMS কতক্ষণ পরে যাবে এবং
              কলব্যাকের কতক্ষণ আগে রিমাইন্ডার যাবে। সতর্কতা: এই অটোমেশন শুধু তখনই চলে যখন{" "}
              <code>module.call_center_automation</code> kill-switch চালু থাকে <strong>এবং</strong> worker
              প্রসেস চলমান থাকে (doc 21, G2) — মান বদলালেই SMS পাঠানো শুরু হবে না।
            </span>
          </li>
          <li className="flex gap-2.5">
            <span aria-hidden="true" className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-inset ring-emerald-100">
              <Icon name="check" size={12} />
            </span>
            <span>
              <strong>কলিং উইন্ডো:</strong> অটোমেশন রিট্রাই শুধু এই সময়সীমার (ঢাকা সময়) মধ্যেই নির্ধারিত
              হয় — বাইরের সময় পরের উইন্ডো খোলা পর্যন্ত পিছিয়ে যায়।
            </span>
          </li>
          <li className="flex gap-2.5">
            <span aria-hidden="true" className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-inset ring-emerald-100">
              <Icon name="check" size={12} />
            </span>
            <span>
              <strong>সংরক্ষণের মেয়াদ:</strong> retention job চালালে এর চেয়ে পুরনো কল-লগের ব্যক্তিগত তথ্য
              বেনামি করা হয় — রিপোর্টের সংখ্যা (ফলাফল, স্কোর, সময়) থেকে যায়।
            </span>
          </li>
          <li className="flex gap-2.5">
            <span aria-hidden="true" className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-inset ring-emerald-100">
              <Icon name="check" size={12} />
            </span>
            <span>
              সব মানই <strong>সেভ করার মুহূর্ত থেকে</strong> পড়া হয় — কোনো মান অবৈধ হলে সংশ্লিষ্ট পাঠক
              নিজের ডিফল্টে ফিরে যায় (fail-safe), কিছুই আটকে থাকে না।
            </span>
          </li>
        </ul>
      </section>

      <div className="mt-4">
        <CallCenterSettingsCard initial={initial} dbReady={dbReady} />
      </div>

      <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm text-text-muted">
        সেটিং কী:
        {KEY_DEFS.map((d) => (
          <code
            key={d.key}
            className="inline-flex h-6 items-center rounded-full bg-surface-2 px-2.5 font-mono text-xs ring-1 ring-inset ring-black/5"
          >
            {d.key}
          </code>
        ))}
        — সব মান পূর্ণ সংখ্যা হিসেবে সংরক্ষিত হয়। প্রতিটি পরিবর্তন কারণসহ অডিট লগে (
        <span className="font-mono text-xs">settings.update</span>) লেখা থাকে।
      </p>
    </main>
  );
}
