import Link from "next/link";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { SourceChip } from "@/callcenter/components/badges";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { demoCallCenterFlags, isCallCenterEnabled } from "@/callcenter/flags";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import {
  defaultReportRange,
  getCallCenterReport,
  parseReportRange,
  type CallCenterReport,
} from "@/callcenter/reports";
import { CallCenterTabs } from "../tabs";
import { daysAgoInDhaka, todayInDhaka } from "@/reports/db-rows";
import type { DateRange } from "@/reports/types";
import { ReportsExportButton } from "./export-button";
import { heatRatio, outcomeMix, sharePct } from "./report-visuals";

// Call-center Reports (C5) — real aggregations over the CallTask /
// CallLogEntry tables via src/callcenter/reports.ts. Every rate is
// labelled with its exact definition (the module header carries the
// full text); empty ranges render honest zeros, never NaN. The module
// is a paid add-on: while module.call_center is OFF this page shows the
// same lock panel as the queue page instead of any numbers.
//
// CD3 (doc 20) presentation pass: the rate set renders as rate cards —
// hero % with the numerator/denominator ALWAYS visible as plain text
// (the ui StatCard delta chip is a trend arrow, which would fabricate
// a trend these rates do not have — same call as OD4). By-source rows
// carry proportion bars, by-hour is a 24-cell heat strip, and agent
// rows carry talk-time + outcome-mix bars. Every number still comes
// verbatim from the same report payload; report-visuals.ts only turns
// payload values into bar widths.
// Source chips consume CD0's SOURCE_VISUAL via SourceChip
// (src/callcenter/components) — the module's one source vocabulary.
export const dynamic = "force-dynamic";

/** Basis points -> trimmed percent text ("66.67%"). */
function pct(bpsValue: number): string {
  const v = (bpsValue / 100).toFixed(2).replace(/\.?0+$/, "");
  return `${v === "" ? "0" : v}%`;
}

function resolveRange(sp: { days?: string; from?: string; to?: string }): {
  range: DateRange;
  activeDays: number | null;
} {
  if (sp.from !== undefined || sp.to !== undefined) {
    return { range: parseReportRange(sp.from, sp.to) ?? defaultReportRange(), activeDays: null };
  }
  const days = [7, 30, 90].includes(Number(sp.days)) ? Number(sp.days) : 30;
  return { range: { from: daysAgoInDhaka(days - 1), to: todayInDhaka() }, activeDays: days };
}

/** Rate card — StatCard's visual language without its trend chip:
 *  the detail line (numerator/denominator + definition) is plain
 *  text under the hero value, always visible. */
function RateCard({
  label,
  value,
  detail,
  icon,
  accent,
}: {
  label: string;
  value: string;
  detail: ReactNode;
  icon: ReactNode;
  accent: string;
}) {
  return (
    <Card className="transition motion-base hover:shadow-lift">
      <div className="flex items-start justify-between gap-3">
        <span
          aria-hidden="true"
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] shadow-sm ${accent}`}
        >
          {icon}
        </span>
      </div>
      <p className="mt-4 text-xs font-medium text-text-muted">{label}</p>
      <p className="mt-0.5 font-mono text-[1.7rem] font-bold leading-9 tabular-nums text-text-main">
        {value}
      </p>
      <p className="mt-2 text-xs leading-relaxed text-text-muted">{detail}</p>
    </Card>
  );
}

/** Mono fraction span so every rate's n/d reads as one exact figure. */
function Frac({ n, d }: { n: number; d: number }) {
  return (
    <span className="font-mono font-semibold tabular-nums text-text-main">
      {n}/{d}
    </span>
  );
}

const MIX_BAR_CLASS: Record<string, string> = {
  confirmed: "bg-emerald-500",
  callbacks: "bg-amber-400",
  cancelled: "bg-rose-400",
  noAnswer: "bg-slate-300",
  wrongNumber: "bg-slate-500",
};

const MIX_DOT_CLASS: Record<string, string> = {
  confirmed: "bg-emerald-500",
  callbacks: "bg-amber-400",
  cancelled: "bg-rose-400",
  noAnswer: "bg-slate-300",
  wrongNumber: "bg-slate-500",
};

const MIX_LABELS: Record<string, string> = {
  confirmed: "কনফার্ম",
  callbacks: "কলব্যাক",
  cancelled: "বাতিল",
  noAnswer: "No Answer",
  wrongNumber: "Wrong Number",
};

export default async function AdminCallCenterReportsPage({
  searchParams,
}: {
  searchParams: { days?: string; from?: string; to?: string };
}) {
  await ensureDbFeatureFlags();
  if (!isCallCenterEnabled(demoCallCenterFlags)) {
    return (
      <main>
        <PageHeader
          title="কল রিপোর্ট"
          description="Call-center reporting (C5)"
          breadcrumb="Admin / Call Center"
        />
        <p role="status">
          🔒 এই মডিউলটি এই ইনস্টলে লক করা আছে। কল সেন্টার একটি পেইড অ্যাড-অন — খুলতে
          Admin &gt; Settings থেকে <code>module.call_center</code> ফিচার ফ্ল্যাগ চালু করুন।
          (This module is locked — enable the <code>module.call_center</code> feature flag to unlock it.)
        </p>
      </main>
    );
  }

  const { range, activeDays } = resolveRange(searchParams ?? {});
  let report: CallCenterReport | null = null;
  try {
    report = await getCallCenterReport(range);
  } catch {
    report = null;
  }

  const presets = [7, 30, 90].map((d) => (
    <Link
      key={d}
      href={`/admin/call-center/reports?days=${d}`}
      className={`rounded-md border px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 ${
        activeDays === d ? "border-primary bg-primary/10 font-semibold" : "border-border"
      }`}
    >
      {d} দিন
    </Link>
  ));

  return (
    <main>
      <PageHeader
        title="কল রিপোর্ট"
        description={`কল সেন্টারের কার্যকারিতা — আসল CallTask/CallLogEntry ডেটা থেকে। পরিসর: ${range.from} → ${range.to} (ঢাকা সময়)। (Call Reports — C5)`}
        breadcrumb="Admin / Call Center"
      />
      <CallCenterTabs active="reports" />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">{presets}</div>
        {report ? <ReportsExportButton from={range.from} to={range.to} /> : null}
      </div>

      {report === null ? (
        <p
          role="alert"
          className="rounded-md bg-rose-50 px-3.5 py-2.5 text-small leading-relaxed text-rose-700"
        >
          ডাটাবেস থেকে রিপোর্ট পড়া যায়নি — কোনো সংখ্যা দেখানো হচ্ছে না। (Could not read the
          report from the database; no numbers are shown.)
        </p>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <RateCard
              label="মোট কল চেষ্টা"
              value={String(report.attempts)}
              detail={
                <>
                  নতুন টাস্ক{" "}
                  <span className="font-mono font-semibold tabular-nums text-text-main">
                    {report.tasksCreated}
                  </span>
                  টি
                </>
              }
              icon={<Icon name="phone" size={22} />}
              accent="bg-brand-50 text-brand-600"
            />
            <RateCard
              label="যোগাযোগের হার"
              value={pct(report.contactRateBps)}
              detail={
                <>
                  কথা হয়েছে <Frac n={report.contactedAttempts} d={report.attempts} /> — No
                  Answer ও Wrong Number বাদে
                </>
              }
              icon={<Icon name="users" size={22} />}
              accent="bg-sky-50 text-sky-600"
            />
            <RateCard
              label="কনফার্মেশন হার"
              value={pct(report.confirmation.rateBps)}
              detail={
                <>
                  সম্পন্ন টাস্কের মধ্যে কনফার্ম{" "}
                  <Frac n={report.confirmation.confirmed} d={report.confirmation.completed} />
                </>
              }
              icon={<Icon name="check" size={22} />}
              accent="bg-emerald-50 text-emerald-600"
            />
            <RateCard
              label="রেসকিউ হার"
              value={pct(report.rescue.rateBps)}
              detail={
                <>
                  ব্যর্থ ডেলিভারির সম্পন্ন টাস্কের মধ্যে কনফার্ম{" "}
                  <Frac n={report.rescue.confirmed} d={report.rescue.completed} /> (শুধু কল
                  outcome অনুযায়ী)
                </>
              }
              icon={<Icon name="truck" size={22} />}
              accent="bg-amber-50 text-amber-600"
            />
            <RateCard
              label="কলব্যাক রাখার হার"
              value={pct(report.callbacks.rateBps)}
              detail={
                <>
                  কলব্যাক <Frac n={report.callbacks.kept} d={report.callbacks.total} /> পরে
                  কনফার্ম হয়েছে
                </>
              }
              icon={<Icon name="rotate-ccw" size={22} />}
              accent="bg-teal-50 text-teal-600"
            />
            <RateCard
              label="সম্পন্নপ্রতি গড় চেষ্টা"
              value={String(report.avgAttemptsPerCompletedTask)}
              detail={
                <>
                  সম্পন্ন টাস্ক <span className="font-mono font-semibold tabular-nums text-text-main">{report.tasksCompleted}</span>টির
                  উপর
                </>
              }
              icon={<Icon name="refresh-ccw" size={22} />}
              accent="bg-surface-2 text-text-muted"
            />
          </div>

          <h2 className="mb-1 text-lg font-semibold">উৎস অনুযায়ী</h2>
          <p className="mb-3 text-xs text-text-muted">
            উৎস (source) অনুযায়ী টাস্ক — তৈরি, সম্পন্ন, শেষ outcome কনফার্ম, আর ওই উৎসের
            টাস্কে মোট কল চেষ্টা। বার = মোট তৈরির মধ্যে ওই উৎসের অংশ।
          </p>
          <div className="space-y-3">
            {report.bySource.map((s) => {
              const totalCreated = report.bySource.reduce((sum, x) => sum + x.created, 0);
              return (
                <div key={s.source} className="rounded-md border border-border p-4">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <SourceChip source={s.source} />
                    <span className="font-mono text-xs tabular-nums text-text-muted">
                      তৈরি {s.created} · সম্পন্ন {s.completed} · কনফার্ম (শেষ outcome){" "}
                      {s.confirmedFinal} · কল চেষ্টা {s.attempts}
                    </span>
                  </div>
                  <div
                    className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2"
                    role="img"
                    aria-label={`তৈরি ${s.created}টি — মোট ${totalCreated}টির মধ্যে`}
                  >
                    <div
                      className="h-full rounded-full bg-brand-500"
                      style={{ width: `${sharePct(s.created, totalCreated)}%` }}
                    />
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                      <div
                        className="h-full rounded-full bg-emerald-500"
                        style={{ width: `${sharePct(s.completed, s.created)}%` }}
                      />
                    </div>
                    <span className="text-[11px] text-text-muted">
                      সম্পন্ন {s.completed}/{s.created}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <h2 className="mb-3 mt-8 text-lg font-semibold">ঘণ্টা অনুযায়ী কল (ঢাকা সময়)</h2>
          <div className="rounded-md border border-border p-4">
            <div className="flex gap-1 overflow-x-auto pb-2 lg:grid lg:grid-cols-12 lg:overflow-visible">
              {report.byHour.map((b) => {
                const max = Math.max(1, ...report.byHour.map((x) => x.attempts));
                const ratio = heatRatio(b.attempts, max);
                return (
                  <div
                    key={b.hour}
                    className="flex w-10 shrink-0 flex-col items-center gap-1 lg:w-auto"
                    title={`${b.hour}:00 — চেষ্টা ${b.attempts}টি, কথা হয়েছে ${b.contacted}টি`}
                  >
                    <div
                      className="flex h-12 w-full items-center justify-center rounded-md text-sm font-semibold tabular-nums"
                      style={{
                        // brand-600 (#4F46E5) as an alpha ramp — a data-viz
                        // tint, like the badge tone fills; 0-volume cells
                        // stay on the neutral surface tint.
                        backgroundColor:
                          b.attempts === 0
                            ? "rgb(var(--c-surface-2))"
                            : `rgba(79, 70, 229, ${(0.12 + 0.88 * ratio).toFixed(3)})`,
                        color: ratio > 0.55 ? "#ffffff" : undefined,
                      }}
                    >
                      {b.attempts}
                    </div>
                    <span className="text-[10px] text-text-muted">{b.hour}</span>
                  </div>
                );
              })}
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-[11px] text-text-muted">
              <span>কম</span>
              {[0.15, 0.4, 0.65, 0.9].map((a) => (
                <span
                  key={a}
                  aria-hidden="true"
                  className="h-3 w-5 rounded-sm"
                  style={{ backgroundColor: `rgba(79, 70, 229, ${a})` }}
                />
              ))}
              <span>বেশি</span>
            </div>
            <p className="mt-2 text-xs text-text-muted">
              প্রতিটি ঘর = ওই ঘণ্টায় মোট কল চেষ্টা (সংখ্যাটি ঘরের ভিতরেই)। ঘরের উপর মাউস
              রাখলে কথা-হওয়ার সংখ্যা দেখা যাবে।
            </p>
          </div>

          <h2 className="mb-1 mt-8 text-lg font-semibold">এজেন্ট অনুযায়ী</h2>
          <p className="mb-3 text-xs text-text-muted">
            এজেন্টের কার্যকারিতা — agentPerformance() হেল্পার থেকে; কলব্যাক-রক্ষা এই রিপোর্টে
            যোগ করা। মোট সময় = প্রতিটি কলের আসল duration (outcome-এর সময় সেভ হয়)।
          </p>
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-muted">
            {Object.keys(MIX_LABELS).map((k) => (
              <span key={k} className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className={`h-2 w-2 rounded-full ${MIX_DOT_CLASS[k]}`} />
                {MIX_LABELS[k]}
              </span>
            ))}
          </div>
          <div className="space-y-3">
            {report.agents.map((a) => {
              const maxTalk = Math.max(1, ...report.agents.map((x) => x.totalTalkSeconds));
              return (
                <div key={a.agentId} className="rounded-md border border-border p-4">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-medium">{a.agentName ?? a.agentId}</span>
                    <span className="font-mono text-xs tabular-nums text-text-muted">
                      মোট কল {a.totalCalls} · কনফার্ম হার {pct(a.confirmRateBps)}
                    </span>
                  </div>
                  <div
                    className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-surface-2"
                    role="img"
                    aria-label={`কনফার্ম ${a.confirmed}, কলব্যাক ${a.callbacks}, বাতিল ${a.cancelled}, No Answer ${a.noAnswer}, Wrong Number ${a.wrongNumber}`}
                  >
                    {outcomeMix(a).map((seg) =>
                      seg.value > 0 ? (
                        <div
                          key={seg.key}
                          className={`h-full ${MIX_BAR_CLASS[seg.key]}`}
                          style={{ width: `${seg.pct}%` }}
                          title={`${MIX_LABELS[seg.key]} ${seg.value}`}
                        />
                      ) : null,
                    )}
                  </div>
                  <p className="mt-2 font-mono text-xs tabular-nums text-text-muted">
                    কনফার্ম {a.confirmed} · কলব্যাক {a.callbacks} · বাতিল {a.cancelled} · No
                    Answer {a.noAnswer} · Wrong Number {a.wrongNumber} · কলব্যাক রক্ষা{" "}
                    {a.callbacksKept} ({pct(a.callbackKeptRateBps)})
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <span className="w-16 shrink-0 text-[11px] text-text-muted">মোট সময়</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                      <div
                        className="h-full rounded-full bg-brand-500"
                        style={{ width: `${sharePct(a.totalTalkSeconds, maxTalk)}%` }}
                      />
                    </div>
                    <span className="font-mono text-xs tabular-nums text-text-muted">
                      {a.totalTalkSeconds} সেকেন্ড
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          {report.agents.length === 0 ? (
            <p className="mt-3 text-sm text-text-muted">
              এই সময়ে কোনো এজেন্টের কল লগ নেই। (No agent call logs in this range.)
            </p>
          ) : null}
        </>
      )}
    </main>
  );
}
