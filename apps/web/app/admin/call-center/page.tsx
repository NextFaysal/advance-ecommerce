import { demoCallCenterFlags, isCallCenterEnabled } from "@/callcenter/flags";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { toQueueItemView } from "@/callcenter/queue";
import { loadCallTasks } from "@/callcenter/store";
import { CONFIRMATION_SCRIPT } from "@/callcenter/types";
import { formatBdt } from "@/checkout/pricing";
import { pick } from "@/i18n/locale";
import { getRequestLocale } from "@/i18n/server";
import { DataTable } from "@/components/ui/table";
import { CallCenterTabs } from "./tabs";
import { CallCenterWorkbench } from "./workbench";
import { CALL_CENTER_STRINGS } from "./strings";
import { SOURCE_LABEL } from "./workbench/shared";

// Call center admin — Agent 14, Step 46 (A10).
// Locked state: while module.call_center is OFF (seeded default, paid
// add-on), the page renders the lock panel, matching the API's 403
// FEATURE_LOCKED. Queue phones are masked in this page — the full number is
// only ever served by the API to callers with customers.view_full_phone.
// Data: Prisma DB via src/callcenter/store.ts (tasks store masked phones
// only; names/totals come from the linked orders).
// Wave 8: the agent workbench (./workbench.tsx, client) is mounted below
// in the unlocked branch only — it drives the claim/outcome/manual APIs
// so an agent can actually work the queue; this page's table + script
// remain the supervisor view.
export default async function AdminCallCenterPage() {
  const locale = await getRequestLocale();
  const s = pick(locale, CALL_CENTER_STRINGS);
  await ensureDbFeatureFlags();
  if (!isCallCenterEnabled(demoCallCenterFlags)) {
    return (
      <main className="p-6">
        <h1 className="font-display text-page-title text-text-main">{s.queueTitle}</h1>
        <p role="status" className="mt-2 text-sm text-text-muted">
          {s.lockedA} <code>module.call_center</code> {s.lockedB}
        </p>
      </main>
    );
  }
  const tasks = await loadCallTasks();
  const views = tasks.map((t) => toQueueItemView(t, false));
  return (
    <main className="p-6">
      <h1 className="font-display text-page-title text-text-main">{s.queueTitle}</h1>
      <CallCenterTabs active="workbench" />
      <p className="mb-4 max-w-2xl text-sm leading-relaxed text-text-muted">{s.queueIntro}</p>
      <CallCenterWorkbench />
      <h2 className="mb-3 mt-8 font-display text-base font-semibold text-text-main">{s.allTasksTitle}</h2>
      <DataTable
        columns={[
          { key: "customer", header: s.colCustomer },
          { key: "phone", header: s.colPhone },
          { key: "source", header: s.colSource },
          { key: "order", header: s.colOrder },
          { key: "total", header: s.colTotal },
          { key: "status", header: s.colStatus },
          { key: "attempts", header: s.colAttempts },
        ]}
        rows={views.map((v) => ({
          customer: v.customerName,
          phone: v.phoneMasked,
          source: SOURCE_LABEL[v.source][locale],
          order: v.orderNo ?? "—",
          total: v.orderTotalPoisha > 0 ? formatBdt(v.orderTotalPoisha) : "—",
          status: v.status,
          attempts: v.attempts,
        }))}
      />
      <h2 className="mb-3 mt-8 font-display text-base font-semibold text-text-main">{s.confirmScriptTitle}</h2>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-text-main">
        {CONFIRMATION_SCRIPT.map((step) => (
          <li key={step.key}><strong>{step.key}:</strong> {step.promptBn}</li>
        ))}
      </ol>
      <p className="mt-4 text-sm text-text-muted">{s.outcomesNote}</p>
    </main>
  );
}
