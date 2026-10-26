import { PageHeader } from "@/components/ui/page-header";
import { isRentalEnabled } from "@/rental/flags";
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

export default function RentalsPage() {
  if (!isRentalEnabled()) {
    return (
      <main style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1>ভাড়া</h1>
        <p role="status">
          🔒 This module is locked for this install. Rental is a paid add-on —
          enable <code>module.rental</code> in Admin &gt; Settings &gt; Feature Flags to unlock it.
        </p>
      </main>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="ভাড়া"
        description="চলমান ভাড়ার বোর্ড — ফেরতের তারিখ অনুযায়ী সাজানো। মেয়াদ পেরিয়ে গেলে ভাড়া নিজে থেকেই ‘মেয়াদোত্তীর্ণ’ দেখায় (আলাদা cron নেই)। বোর্ডটি প্রতি ৩০ সেকেন্ডে নিজে হালনাগাদ হয় (polling — live realtime নয়)। ফেরত নিলে জামানত গ্রাহককে ম্যানুয়ালি ফেরত দিন — সিস্টেম নিজে থেকে টাকা ফেরত দেয় না।"
      />
      <RentalsBoard />
      <RentalsConfigCard />
    </div>
  );
}
