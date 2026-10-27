import { PageHeader } from "@/components/ui/page-header";
import { isRentalEnabled } from "@/rental/flags";
import { pick } from "@/i18n/locale";
import { getRequestLocale } from "@/i18n/server";
import { RENTALS_STRINGS } from "./strings";
import { RentalsBoard } from "./rentals-board";
import { RentalsConfigCard } from "./rentals-config-card";

// Admin > Rentals — ADV-23 vertical 3 (doc 23, wave 56).
// Locked state: while module.rental is OFF (the seeded default —
// paid add-on), the page renders the lock panel instead of data,
// matching the APIs' 403 FEATURE_LOCKED. Data: real RentalBooking
// rows joined to their orders (src/rental/bookings.ts) — the board
// below self-fetches and polls. Advancing a rental never changes
// the order's own status and never moves money: marking RETURNED
// stamps the return; the frozen deposit shown on each row is
// refunded to the customer MANUALLY in v1 (there is no auto-refund
// flow), and the configured late fee is a contractual rate staff
// settle by hand — nothing charges it automatically.

export const dynamic = "force-dynamic";

export default async function RentalsPage() {
  const s = pick(await getRequestLocale(), RENTALS_STRINGS);
  if (!isRentalEnabled()) {
    return (
      <main style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1>{s.title}</h1>
        <p role="status">
          {s.lockedPrefix} <code>module.rental</code> {s.lockedSuffix}
        </p>
      </main>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={s.title} description={s.description} />
      <RentalsBoard />
      <RentalsConfigCard />
    </div>
  );
}
