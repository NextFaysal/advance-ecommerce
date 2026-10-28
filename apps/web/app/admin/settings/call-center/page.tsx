import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Icon } from "@/components/ui/icon";
import { SETTING_DEFAULTS, getSetting } from "@/lib/settings";
import { CallCenterSettingsCard, type CallCenterSettingsInitial } from "./call-center-settings-card";
import { getRequestLocale } from "@/i18n/server";
import { pick } from "@/i18n/locale";
import { SETTINGS_B_STRINGS } from "../strings-b";

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
  const locale = await getRequestLocale();
  const s = pick(locale, SETTINGS_B_STRINGS);
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
        title={s.ccTitle}
        description={s.ccDesc}
        breadcrumb={s.ccBreadcrumb}
        actions={
          <Link
            href="/admin/settings"
            className="inline-flex min-h-[44px] items-center rounded-md border border-border bg-card px-4 text-sm font-medium transition motion-fast hover:border-brand-300"
          >
            {s.allSettings}
          </Link>
        }
      />

      <section className="mt-6 rounded-2xl border border-border/60 bg-card p-5 shadow-card">
        <h2 className="flex items-center gap-2.5 font-display text-base font-semibold text-text-main">
          <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-brand-50 text-brand-600">
            <Icon name="info" size={17} />
          </span>
          {s.ccWhatTitle}
        </h2>
        <ul className="mt-3 space-y-2.5 text-sm leading-relaxed text-text-muted">
          <li className="flex gap-2.5">
            <span aria-hidden="true" className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-inset ring-emerald-100">
              <Icon name="check" size={12} />
            </span>
            <span>
              <strong>{s.ccSlaStrong}</strong>
              {s.ccSlaBody}
            </span>
          </li>
          <li className="flex gap-2.5">
            <span aria-hidden="true" className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-inset ring-emerald-100">
              <Icon name="check" size={12} />
            </span>
            <span>
              <strong>{s.ccAutoStrong}</strong>
              {s.ccAutoBodyA}
              <code>module.call_center_automation</code>
              {s.ccAutoBodyB}
              <strong>{s.ccAutoBodyStrong}</strong>
              {s.ccAutoBodyC}
            </span>
          </li>
          <li className="flex gap-2.5">
            <span aria-hidden="true" className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-inset ring-emerald-100">
              <Icon name="check" size={12} />
            </span>
            <span>
              <strong>{s.ccWindowStrong}</strong>
              {s.ccWindowBody}
            </span>
          </li>
          <li className="flex gap-2.5">
            <span aria-hidden="true" className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-inset ring-emerald-100">
              <Icon name="check" size={12} />
            </span>
            <span>
              <strong>{s.ccRetentionStrong}</strong>
              {s.ccRetentionBody}
            </span>
          </li>
          <li className="flex gap-2.5">
            <span aria-hidden="true" className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-inset ring-emerald-100">
              <Icon name="check" size={12} />
            </span>
            <span>
              {s.ccFailSafeA}
              <strong>{s.ccFailSafeStrong}</strong>
              {s.ccFailSafeB}
            </span>
          </li>
        </ul>
      </section>

      <div className="mt-6">
        <CallCenterSettingsCard initial={initial} dbReady={dbReady} />
      </div>

      <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm text-text-muted">
        {s.ccKeysPrefix}
        {KEY_DEFS.map((d) => (
          <code
            key={d.key}
            className="inline-flex h-6 items-center rounded-full bg-surface-2 px-2.5 font-mono text-xs ring-1 ring-inset ring-black/5"
          >
            {d.key}
          </code>
        ))}
        {s.ccKeysSuffix}
        <span className="font-mono text-xs">settings.update</span>
        {s.ccKeysSuffix2}
      </p>
    </main>
  );
}
