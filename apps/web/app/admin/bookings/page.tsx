import { PageHeader } from "@/admin-shell/PageHeader";
import { isServicesEnabled } from "@/services/flags";
import { pick } from "@/i18n/locale";
import { getRequestLocale } from "@/i18n/server";
import { BOOKINGS_STRINGS } from "./strings";
import { BookingsBoard } from "./bookings-board";
import { BookingsConfigCard } from "./bookings-config-card";

// Admin > Bookings — ADV-23 vertical 2 (doc 23, wave 56).
// Locked state: while module.services is OFF (the seeded default —
// paid add-on), the page renders the lock panel instead of data,
// matching the APIs' 403 FEATURE_LOCKED. Data: real ServiceBooking
// rows joined to their orders (src/services/bookings.ts) — the
// board below self-fetches and polls; nothing on this page moves
// money, and advancing a booking never changes the order's own
// status.

export const dynamic = "force-dynamic";

export default async function BookingsPage() {
  const s = pick(await getRequestLocale(), BOOKINGS_STRINGS);
  if (!isServicesEnabled()) {
    return (
      <main style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1>{s.title}</h1>
        <p role="status">
          {s.lockedPrefix} <code>module.services</code> {s.lockedSuffix}
        </p>
      </main>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={s.title} subtitle={s.description} />
      <BookingsBoard />
      <BookingsConfigCard />
    </div>
  );
}
