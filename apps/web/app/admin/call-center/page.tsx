import { demoCallCenterFlags, isCallCenterEnabled } from "@/callcenter/flags";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { toQueueItemView } from "@/callcenter/queue";
import { loadCallTasks } from "@/callcenter/store";
import { CONFIRMATION_SCRIPT } from "@/callcenter/types";
import { formatBdt } from "@/checkout/pricing";
import { pick } from "@/i18n/locale";
import { getRequestLocale } from "@/i18n/server";
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
      <main style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1>{s.queueTitle}</h1>
        <p role="status">
          {s.lockedA} <code>module.call_center</code> {s.lockedB}
        </p>
      </main>
    );
  }
  const tasks = await loadCallTasks();
  const views = tasks.map((t) => toQueueItemView(t, false));
  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>{s.queueTitle}</h1>
      <CallCenterTabs active="workbench" />
      <p>{s.queueIntro}</p>
      <CallCenterWorkbench />
      <h2>{s.allTasksTitle}</h2>
      <table>
        <thead>
          <tr>
            <th>{s.colCustomer}</th><th>{s.colPhone}</th><th>{s.colSource}</th><th>{s.colOrder}</th><th>{s.colTotal}</th><th>{s.colStatus}</th><th>{s.colAttempts}</th>
          </tr>
        </thead>
        <tbody>
          {views.map((v) => (
            <tr key={v.id}>
              <td>{v.customerName}</td>
              <td>{v.phoneMasked}</td>
              <td>{SOURCE_LABEL[v.source][locale]}</td>
              <td>{v.orderNo ?? "—"}</td>
              <td>{v.orderTotalPoisha > 0 ? formatBdt(v.orderTotalPoisha) : "—"}</td>
              <td>{v.status}</td>
              <td>{v.attempts}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>{s.confirmScriptTitle}</h2>
      <ol>
        {CONFIRMATION_SCRIPT.map((step) => (
          <li key={step.key}><strong>{step.key}:</strong> {step.promptBn}</li>
        ))}
      </ol>
      <p>{s.outcomesNote}</p>
    </main>
  );
}
