import { PageHeader } from "@/components/ui/page-header";
import { isServicesEnabled } from "@/services/flags";
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

export default function BookingsPage() {
  if (!isServicesEnabled()) {
    return (
      <main style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1>বুকিং</h1>
        <p role="status">
          🔒 This module is locked for this install. Services + appointment booking is a paid add-on —
          enable <code>module.services</code> in Admin &gt; Settings &gt; Feature Flags to unlock it.
        </p>
      </main>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="বুকিং"
        description="সেবার অ্যাপয়েন্টমেন্ট বোর্ড — দিন অনুযায়ী স্লটভিত্তিক তালিকা। বোর্ডটি প্রতি ৩০ সেকেন্ডে নিজে হালনাগাদ হয় (polling — live realtime নয়)। অর্ডার বাতিল হলে তার বুকিংও নিজে থেকে বাতিল হয়ে যায়।"
      />
      <BookingsBoard />
      <BookingsConfigCard />
    </div>
  );
}
