import { PageHeader } from "@/components/ui/page-header";
import { isPodEnabled } from "@/pod/flags";
import { PrintQueueBoard } from "./print-queue-board";
import { PodConfigCard } from "./pod-config-card";
import { getRequestLocale } from "@/i18n/server";
import { pick } from "@/i18n/locale";
import { PRINT_QUEUE_STRINGS } from "./strings";

// Admin > Print Queue — ADV-23 vertical 5 (doc 23, wave 56).
// Locked state: while module.print_on_demand is OFF (the seeded
// default — paid add-on), the page renders the lock panel instead
// of data, matching the APIs' 403 FEATURE_LOCKED. Data: real
// orders whose create-time note carries a frozen custom print
// (src/pod/customisation.ts) — the board below self-fetches and
// polls. "ছাপানো হয়েছে" is a staff ATTESTATION: it appends a
// [pod-printed] note to the order and removes it from the queue;
// it changes no order status and moves no money. There is no POD
// table and no artwork upload in v1 — the customisation is text +
// an optional palette colour, frozen on the order note.

export const dynamic = "force-dynamic";

export default async function PrintQueuePage() {
  const s = pick(await getRequestLocale(), PRINT_QUEUE_STRINGS);
  if (!isPodEnabled()) {
    return (
      <main style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1>{s.lockedTitle}</h1>
        <p role="status">
          {s.lockedText1}
          <code>module.print_on_demand</code>
          {s.lockedText2}
        </p>
      </main>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={s.title}
        description={s.description}
      />
      <PrintQueueBoard />
      <PodConfigCard />
    </div>
  );
}
