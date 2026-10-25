import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { DataTable } from "@/components/ui/table";
import { demoCallCenterFlags, isCallCenterEnabled } from "@/callcenter/flags";
import {
  defaultReportRange,
  getCallCenterReport,
  parseReportRange,
  type CallCenterReport,
} from "@/callcenter/reports";
import { daysAgoInDhaka, todayInDhaka } from "@/reports/db-rows";
import type { DateRange } from "@/reports/types";
import { ReportsExportButton } from "./export-button";

// Call-center Reports (C5) — real aggregations over the CallTask /
// CallLogEntry tables via src/callcenter/reports.ts. Every rate is
// labelled with its exact definition (the module header carries the
// full text); empty ranges render honest zeros, never NaN. The module
// is a paid add-on: while module.call_center is OFF this page shows the
// same lock panel as the queue page instead of any numbers.
export const dynamic = "force-dynamic";

const SOURCE_LABELS: Record<string, string> = {
  PENDING_ORDER: "অর্ডার কনফার্মেশন",
  FAILED_DELIVERY: "ডেলিভারি রেসকিউ",
  ABANDONED_CHECKOUT: "ছেড়ে যাওয়া চেকআউট",
  MANUAL: "ম্যানুয়াল",
};

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

export default async function AdminCallCenterReportsPage({
  searchParams,
}: {
  searchParams: { days?: string; from?: string; to?: string };
}) {
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
      className={`rounded-md border px-3 py-1.5 text-sm ${
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
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
            <StatCard
              label="মোট কল চেষ্টা"
              value={String(report.attempts)}
              delta={`নতুন টাস্ক ${report.tasksCreated}টি`}
              icon="📞"
            />
            <StatCard
              label="যোগাযোগের হার"
              value={pct(report.contactRateBps)}
              delta={`কথা হয়েছে ${report.contactedAttempts}/${report.attempts} — No Answer ও Wrong Number বাদে`}
              icon="🤝"
            />
            <StatCard
              label="কনফার্মেশন হার"
              value={pct(report.confirmation.rateBps)}
              delta={`সম্পন্ন ${report.confirmation.completed}টির মধ্যে কনফার্ম ${report.confirmation.confirmed}টি`}
              icon="✅"
            />
            <StatCard
              label="রেসকিউ হার"
              value={pct(report.rescue.rateBps)}
              delta={`ব্যর্থ ডেলিভারির সম্পন্ন ${report.rescue.completed}টির মধ্যে কনফার্ম ${report.rescue.confirmed}টি (শুধু কল outcome অনুযায়ী)`}
              icon="🛟"
            />
            <StatCard
              label="কলব্যাক রাখার হার"
              value={pct(report.callbacks.rateBps)}
              delta={`কলব্যাক ${report.callbacks.total}টির মধ্যে পরে কনফার্ম ${report.callbacks.kept}টি`}
              icon="↩️"
            />
            <StatCard
              label="সম্পন্নপ্রতি গড় চেষ্টা"
              value={String(report.avgAttemptsPerCompletedTask)}
              delta={`সম্পন্ন টাস্ক ${report.tasksCompleted}টির উপর`}
              icon="🔁"
            />
          </div>

          <h2 className="mb-3 text-lg font-semibold">উৎস অনুযায়ী</h2>
          <DataTable
            caption="উৎস (source) অনুযায়ী টাস্ক — তৈরি, সম্পন্ন, শেষ outcome কনফার্ম, আর ওই উৎসের টাস্কে মোট কল চেষ্টা"
            columns={[
              { key: "source", header: "উৎস" },
              { key: "created", header: "তৈরি" },
              { key: "completed", header: "সম্পন্ন" },
              { key: "confirmedFinal", header: "কনফার্ম (শেষ outcome)" },
              { key: "attempts", header: "কল চেষ্টা" },
            ]}
            rows={report.bySource.map((s) => ({
              source: <span className="font-medium">{SOURCE_LABELS[s.source] ?? s.source}</span>,
              created: String(s.created),
              completed: String(s.completed),
              confirmedFinal: String(s.confirmedFinal),
              attempts: String(s.attempts),
            }))}
          />

          <h2 className="mb-3 mt-8 text-lg font-semibold">ঘণ্টা অনুযায়ী কল (ঢাকা সময়)</h2>
          <div className="rounded-md border border-border p-4">
            <div className="flex h-28 items-end gap-1">
              {report.byHour.map((b) => {
                const max = Math.max(1, ...report.byHour.map((x) => x.attempts));
                return (
                  <div
                    key={b.hour}
                    className="flex flex-1 flex-col items-center justify-end gap-1"
                    title={`${b.hour}:00 — চেষ্টা ${b.attempts}টি, কথা হয়েছে ${b.contacted}টি`}
                  >
                    <div
                      className="w-full rounded-sm bg-primary/70"
                      style={{ height: `${Math.max(2, (b.attempts / max) * 100)}%` }}
                    />
                    <span className="text-[10px] text-text-muted">{b.hour}</span>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-text-muted">
              প্রতিটি বার = ওই ঘণ্টায় মোট কল চেষ্টা। বার উপর মাউস রাখলে কথা-হওয়ার সংখ্যা দেখা যাবে।
            </p>
          </div>

          <h2 className="mb-3 mt-8 text-lg font-semibold">এজেন্ট অনুযায়ী</h2>
          <DataTable
            caption="এজেন্টের কার্যকারিতা — agentPerformance() হেল্পার থেকে; কলব্যাক-রক্ষা এই রিপোর্টে যোগ করা। দ্রষ্টব্য: সংরক্ষিত কল লগে কথার সময় (duration) থাকে না, তাই মোট সময় বর্তমানে ০ দেখায়।"
            columns={[
              { key: "agent", header: "এজেন্ট" },
              { key: "totalCalls", header: "মোট কল" },
              { key: "confirmed", header: "কনফার্ম" },
              { key: "callbacks", header: "কলব্যাক" },
              { key: "cancelled", header: "বাতিল" },
              { key: "noAnswer", header: "No Answer" },
              { key: "wrongNumber", header: "Wrong Number" },
              { key: "confirmRate", header: "কনফার্ম হার" },
              { key: "callbacksKept", header: "কলব্যাক রক্ষা" },
              { key: "talk", header: "মোট সময় (সেকেন্ড)" },
            ]}
            rows={report.agents.map((a) => ({
              agent: <span className="font-medium">{a.agentName ?? a.agentId}</span>,
              totalCalls: String(a.totalCalls),
              confirmed: String(a.confirmed),
              callbacks: String(a.callbacks),
              cancelled: String(a.cancelled),
              noAnswer: String(a.noAnswer),
              wrongNumber: String(a.wrongNumber),
              confirmRate: pct(a.confirmRateBps),
              callbacksKept: `${a.callbacksKept} (${pct(a.callbackKeptRateBps)})`,
              talk: String(a.totalTalkSeconds),
            }))}
          />
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
