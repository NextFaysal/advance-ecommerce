import { PageHeader } from "@/components/ui/page-header";
import { coursesEnabled } from "@/courses/flags";
import { CoursesConfigCard } from "./courses-config-card";
import { CoursesContentCard } from "./courses-content-card";

// Admin > Courses — ADV-23 vertical 6 (doc 23, wave 56), the last
// ADV-23 vertical. Locked state: while module.courses is OFF (the
// seeded default — paid add-on), the page renders the lock panel
// instead of data, matching the sibling vertical pages. The config
// and content APIs stay reachable without the flag (settings- /
// products-guarded) so a merchant can prepare courses before
// enabling the module.

export const dynamic = "force-dynamic";

export default function CoursesPage() {
  if (!coursesEnabled()) {
    return (
      <main style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1>কোর্স (LMS-lite)</h1>
        <p role="status">
          🔒 This module is locked for this install. Courses is a paid add-on — enable{" "}
          <code>module.courses</code> in Admin &gt; Settings &gt; Feature Flags to unlock it.
        </p>
      </main>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="কোর্স (LMS-lite)"
        description="কোর্স হলো সাধারণ DIGITAL পণ্য — কনফিগে তালিকাভুক্ত ভ্যারিয়েন্ট কিনলেই ক্রেতা পাঠ্যক্রমের অ্যাক্সেস পায়। আলাদা এনরোলমেন্ট টেবিল নেই: অ্যাক্সেস প্রতিবার অর্ডার থেকে যাচাই হয় — পেইড (বা ডেলিভার্ড) অর্ডার অ্যাক্সেস দেয়, রিফান্ড/রিটার্ন/বাতিল হলে অ্যাক্সেস সরে যায় (আংশিক রিফান্ডেও)। ভিডিও লেসনে শুধু YouTube/Vimeo এম্বেড — ভিডিও হোস্টিং এই প্ল্যাটফর্মে হয় না।"
      />
      <CoursesContentCard />
      <CoursesConfigCard />
    </div>
  );
}
