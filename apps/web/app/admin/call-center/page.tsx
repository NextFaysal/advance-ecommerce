import { demoCallCenterFlags, isCallCenterEnabled } from "@/callcenter/flags";
import { toQueueItemView } from "@/callcenter/queue";
import { loadCallTasks } from "@/callcenter/store";
import { CONFIRMATION_SCRIPT } from "@/callcenter/types";
import { formatBdt } from "@/checkout/pricing";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { CallCenterTabs } from "./tabs";
import { CallCenterWorkbench } from "./workbench";

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
  await ensureDbFeatureFlags().catch(() => {});
  if (!isCallCenterEnabled(demoCallCenterFlags)) {
    return (
      <main style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1>Call Center</h1>
        <p role="status">
          🔒 This module is locked for this install. Call center is a paid add-on —
          enable <code>module.call_center</code> in Admin &gt; Settings &gt; Feature Flags to unlock it.
        </p>
      </main>
    );
  }
  const tasks = await loadCallTasks();
  const views = tasks.map((t) => toQueueItemView(t, false));
  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>Call Center — Queue</h1>
      <CallCenterTabs active="workbench" />
      <p>Live data from the database. Highest priority first: failed delivery, then pending orders, abandoned checkouts, manual.</p>
      <CallCenterWorkbench />
      <h2>সব টাস্ক (Supervisor Queue)</h2>
      <table>
        <thead>
          <tr>
            <th>Customer</th><th>Phone</th><th>Source</th><th>Order</th><th>Total</th><th>Status</th><th>Attempts</th>
          </tr>
        </thead>
        <tbody>
          {views.map((v) => (
            <tr key={v.id}>
              <td>{v.customerName}</td>
              <td>{v.phoneMasked}</td>
              <td>{v.source}</td>
              <td>{v.orderNo ?? "—"}</td>
              <td>{v.orderTotalPoisha > 0 ? formatBdt(v.orderTotalPoisha) : "—"}</td>
              <td>{v.status}</td>
              <td>{v.attempts}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Confirmation Script</h2>
      <ol>
        {CONFIRMATION_SCRIPT.map((s) => (
          <li key={s.key}><strong>{s.key}:</strong> {s.promptBn}</li>
        ))}
      </ol>
      <p>
        Outcomes: Confirmed, Callback (a time must be scheduled), Cancelled, No Answer
        (re-queues up to 3 attempts), Wrong Number. Recording an outcome via the API
        returns the agent&apos;s next task in the same response. A Confirmed/Cancelled
        outcome applies the corresponding order transition.
      </p>
    </main>
  );
}
