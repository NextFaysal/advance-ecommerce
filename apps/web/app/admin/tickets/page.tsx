import { PageHeader } from "@/components/ui/page-header";
import { TicketsManager } from "./tickets-manager";

// Support ticket queue (ADV-16b) — real SupportTicket rows written
// by signed-in customers from /account/tickets. Staff reply moves a
// ticket to PENDING; a customer reply reopens it to OPEN. The list
// and thread are REAL — <TicketsManager> reads GET
// /api/v1/admin/tickets; replies and status changes go through the
// admin tickets API. Guarded by customers.view (reads) /
// customers.edit (writes) in the API — no dedicated support
// permission exists in PERMISSIONS.
export const dynamic = "force-dynamic";

export default function AdminTicketsPage() {
  return (
    <main>
      <PageHeader
        title="সাপোর্ট টিকিট"
        description="গ্রাহকদের খোলা সাপোর্ট টিকিটের কিউ। উত্তর দিলে টিকিট PENDING হয়, গ্রাহক আবার লিখলে OPEN হয়ে যায়; সমাধান হলে বন্ধ করে দিন। ফোন নম্বর এখানে মাস্ক করা দেখানো হয়। (Support Tickets — customers.view / customers.edit)"
        breadcrumb="Admin / Customers"
      />
      <TicketsManager />
    </main>
  );
}
