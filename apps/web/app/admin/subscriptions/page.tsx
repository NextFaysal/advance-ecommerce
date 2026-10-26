import { cookies } from "next/headers";
import { PageHeader } from "@/components/ui/page-header";
import { validateSessionToken } from "@/lib/auth";
import { SubscriptionsList } from "@/components/admin/subscriptions-list";

// Customer subscriptions (ADV-18 remainder) — staff oversight list.
// The list itself is a self-fetching client component (no props cross
// the server->client boundary); this page only gates on a valid staff
// session, mirroring /admin/security. Row data is served by
// GET /api/v1/admin/subscriptions behind orders.view.
export const dynamic = "force-dynamic";

export default async function AdminSubscriptionsPage() {
  const token = cookies().get("admin_session")?.value;
  const session = token ? await validateSessionToken(token) : null;

  if (!session) {
    return (
      <main>
        <PageHeader
          title="সাবস্ক্রিপশন"
          description="কাস্টমার সাবস্ক্রিপশন ও অটো-রিপ্লেনিশ অর্ডার"
          breadcrumb="Admin / Sales"
        />
        <p role="status" className="text-sm text-text-muted">
          এই পেজ দেখতে আগে লগইন করুন।
        </p>
      </main>
    );
  }

  return (
    <main>
      <PageHeader
        title="সাবস্ক্রিপশন"
        description="কাস্টমার সাবস্ক্রিপশন — কোনটি কখন অর্ডার তৈরি করবে, কোনটি ব্যর্থ হয়েছে"
        breadcrumb="Admin / Sales"
      />
      <SubscriptionsList />
    </main>
  );
}
