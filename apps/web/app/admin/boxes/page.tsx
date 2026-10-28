import { PageHeader } from "@/admin-shell/PageHeader";
import { subscriptionBoxesEnabled } from "@/boxes/flags";
import { subscriptionsEnabled } from "@/subscriptions/flags";
import { BoxesList } from "./boxes-list";
import { BoxesConfigCard } from "./boxes-config-card";
import { BoxesContentsCard } from "./boxes-contents-card";
import { pick } from "@/i18n/locale";
import { getRequestLocale } from "@/i18n/server";
import { BOXES_STRINGS } from "./strings";

// Admin > Subscription Boxes — ADV-23 vertical 4 (doc 23, wave 56).
// Locked state: while module.subscription_boxes is OFF (the seeded
// default — paid add-on), the page renders the lock panel instead
// of data, matching the sibling vertical pages. The config and
// contents APIs stay reachable without the flag (settings-guarded)
// so a merchant can prepare boxes before enabling the module —
// but generation additionally needs the engine flag
// module.subscriptions ON, which the header copy states plainly.

export const dynamic = "force-dynamic";

export default async function BoxesPage() {
  const s = pick(await getRequestLocale(), BOXES_STRINGS);
  if (!subscriptionBoxesEnabled()) {
    return (
      <main style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1>{s.title}</h1>
        <p role="status">
          {s.lockedPrefix} <code>module.subscription_boxes</code> {s.lockedMid}{" "}
          <code>module.subscriptions</code>
          {s.lockedSuffix}
        </p>
      </main>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={s.title}
        subtitle={subscriptionsEnabled() ? s.descriptionEnabled : s.descriptionEngineOff}
      />
      <BoxesList />
      <BoxesContentsCard />
      <BoxesConfigCard />
    </div>
  );
}
