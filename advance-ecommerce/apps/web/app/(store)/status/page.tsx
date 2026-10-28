/**
 * /status — public system status page (ADV-29 remainder, doc 23).
 *
 * Deliberately force-dynamic — the one storefront page that must NOT
 * be ISR-cached: every component state below was probed live at the
 * moment this page was requested (src/status/checks.ts).
 *
 * What this page deliberately does NOT show: uptime percentages and
 * incident history. No such records exist, and inventing them would
 * be fabrication — the note at the bottom says so in plain words.
 */
import type { Metadata } from "next";
import { getSystemStatus, type ComponentState } from "@/status/checks";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "সিস্টেম অবস্থা — Advance Ecommerce",
  description:
    "Advance Ecommerce-এর ডাটাবেস, ক্যাশ, ব্যাকগ্রাউন্ড কিউ, সার্চ ও স্টোরেজের এই মুহূর্তের অবস্থা। Live status of the database, cache, job queues, search and storage.",
};

const STATE_PRESENTATION: Record<
  ComponentState | "degraded",
  { dot: string; labelBn: string; labelEn: string }
> = {
  operational: { dot: "bg-success", labelBn: "চালু আছে", labelEn: "Operational" },
  degraded: { dot: "bg-warning", labelBn: "সীমিত সেবা", labelEn: "Degraded" },
  down: { dot: "bg-danger", labelBn: "বন্ধ আছে", labelEn: "Down" },
  not_configured: { dot: "bg-slate-400", labelBn: "কনফিগার করা হয়নি", labelEn: "Not configured" },
};

const OVERALL_LINES = {
  operational: { bn: "সব সিস্টেম চালু আছে", en: "All systems operational" },
  degraded: {
    bn: "সিস্টেম চালু আছে — কয়েকটি সেবা সীমিত বা কনফিগার করা হয়নি",
    en: "Systems are running — some services are limited or not configured",
  },
  down: {
    bn: "কিছু সিস্টেমে সমস্যা দেখা দিয়েছে",
    en: "Some systems are experiencing problems",
  },
} as const;

function formatCheckedAt(date: Date): string {
  try {
    return new Intl.DateTimeFormat("bn-BD", {
      timeZone: "Asia/Dhaka",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

export default async function StatusPage() {
  const status = await getSystemStatus();
  const overall = OVERALL_LINES[status.overall];
  const overallDot = STATE_PRESENTATION[status.overall].dot;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-10">
      <h1 className="font-display text-2xl font-bold text-text-main">সিস্টেম অবস্থা</h1>
      <p className="mt-1.5 text-sm leading-6 text-text-muted">
        আমাদের প্রতিটি সেবার এই মুহূর্তের অবস্থা — পেজটি খোলার সময় প্রতিটি অংশ সরাসরি যাচাই করা হয়েছে।
        <span className="mt-0.5 block text-xs text-text-subtle">
          The live state of each service, probed at the moment this page was loaded.
        </span>
      </p>

      {/* Overall line — computed from the component probes below. */}
      <section className="mt-6 flex items-center gap-3 rounded-2xl border border-border bg-card p-5 shadow-card">
        <span aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 rounded-full ${overallDot}`} />
        <div>
          <p className="text-base font-bold text-text-main">{overall.bn}</p>
          <p className="text-xs text-text-subtle">{overall.en}</p>
        </div>
      </section>

      <ul className="mt-6 space-y-3">
        {status.components.map((component) => {
          const presentation = STATE_PRESENTATION[component.state];
          return (
            <li
              key={component.key}
              className="rounded-2xl border border-border bg-card p-5 shadow-card"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span
                    aria-hidden="true"
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${presentation.dot}`}
                  />
                  <div>
                    <p className="text-sm font-bold text-text-main">{component.labelBn}</p>
                    <p className="text-xs text-text-subtle">{component.labelEn}</p>
                  </div>
                </div>
                <p className="text-right text-xs font-semibold text-text-main">
                  {presentation.labelBn}
                  <span className="block font-normal text-text-subtle">
                    {presentation.labelEn} · {component.latencyMs} ms
                  </span>
                </p>
              </div>
              {component.detail ? (
                <p className="mt-2.5 text-sm leading-6 text-text-muted">{component.detail}</p>
              ) : null}
            </li>
          );
        })}
      </ul>

      <p className="mt-6 text-xs leading-5 text-text-subtle">
        সর্বশেষ যাচাই: {formatCheckedAt(status.checkedAt)} (ঢাকা সময়) — পেজটি রিফ্রেশ করলে আবার যাচাই
        হবে।
      </p>
      <p className="mt-2 text-xs leading-5 text-text-subtle">
        আপটাইমের শতাংশ বা আগের ঘটনার (ইনসিডেন্ট) ইতিহাস এখনো রেকর্ড করা হয় না — এই পেজ শুধু এই
        মুহূর্তের সরাসরি অবস্থা দেখায়, অতীতের কোনো দাবি করে না।
        <span className="block">
          Uptime percentages and incident history are not tracked yet — this page reports only the
          live state, with no claims about the past.
        </span>
      </p>
    </main>
  );
}
