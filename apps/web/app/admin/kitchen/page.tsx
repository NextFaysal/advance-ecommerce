import { PageHeader } from "@/components/ui/page-header";
import { isRestaurantEnabled } from "@/restaurant/flags";
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

export default function KitchenPage() {
  if (!isRestaurantEnabled()) {
    return (
      <main style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1>কিচেন (KDS)</h1>
        <p role="status">
          🔒 This module is locked for this install. Restaurant + kitchen display is a paid add-on —
          enable <code>module.restaurant</code> in Admin &gt; Settings &gt; Feature Flags to unlock it.
        </p>
      </main>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="কিচেন (KDS)"
        description="রেস্টুরেন্ট অর্ডারের রান্নাঘরের কিউ — অপেক্ষমাণ → তৈরি হচ্ছে → প্রস্তুত → পরিবেশন। বোর্ডটি প্রতি ১৫ সেকেন্ডে নিজে হালনাগাদ হয় (polling — live realtime নয়)। অর্ডার বাতিল হলে তার টিকিটও নিজে থেকে বাতিল হয়ে যায়।"
      />
      <KitchenBoard />
      <KitchenConfigCard />
    </div>
  );
}
