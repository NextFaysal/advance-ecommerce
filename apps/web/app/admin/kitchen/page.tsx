import { PageHeader } from "@/components/ui/page-header";
import { isRestaurantEnabled } from "@/restaurant/flags";
import { pick } from "@/i18n/locale";
import { getRequestLocale } from "@/i18n/server";
import { KITCHEN_STRINGS } from "./strings";
import { KitchenBoard } from "./kitchen-board";
import { KitchenConfigCard } from "./kitchen-config-card";

// Admin > Kitchen (KDS) — ADV-23 vertical 1 (doc 23, wave 56).
// Locked state: while module.restaurant is OFF (the seeded default —
// paid add-on), the page renders the lock panel instead of data,
// matching the APIs' 403 FEATURE_LOCKED. Data: real KitchenTicket
// rows joined to their orders (src/restaurant/tickets.ts) — the
// board below self-fetches and polls; nothing on this page moves
// money, and the ticket flow never changes the order's own status.

export const dynamic = "force-dynamic";

export default async function KitchenPage() {
  const s = pick(await getRequestLocale(), KITCHEN_STRINGS);
  if (!isRestaurantEnabled()) {
    return (
      <main style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1>{s.title}</h1>
        <p role="status">
          {s.lockedPrefix} <code>module.restaurant</code> {s.lockedSuffix}
        </p>
      </main>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={s.title} description={s.description} />
      <KitchenBoard />
      <KitchenConfigCard />
    </div>
  );
}
