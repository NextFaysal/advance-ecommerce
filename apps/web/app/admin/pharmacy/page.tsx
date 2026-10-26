// /admin/pharmacy (ADV-22) — pharmacist verification queue.
// Locked-add-on page: while module.pharmacy is OFF this renders the
// lock panel; the queue mounts only when on. Every API behind it
// re-checks orders.view/orders.edit + the flag.
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { isPackEnabled } from "@/business-modules/packs";
import { RxQueuePanel } from "./rx-queue-panel";

export const dynamic = "force-dynamic";

export default async function PharmacyQueuePage() {
  await ensureDbFeatureFlags();
  const enabled = isPackEnabled("pharmacy");
  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="text-2xl font-extrabold text-slate-900">প্রেসক্রিপশন যাচাই</h1>
      <p className="mt-1 text-sm text-slate-500">
        প্রেসক্রিপশন-আবশ্যক পণ্যের অর্ডারগুলো এখানে ফার্মাসিস্টের সিদ্ধান্তের অপেক্ষায় থাকে —
        অনুমোদন ছাড়া এই অর্ডার নিশ্চিত (CONFIRMED) করা যায় না। গ্রাহকের দেওয়া তথ্য একটি
        রেকর্ড মাত্র; যাচাইয়ের সিদ্ধান্ত এখানেই নথিভুক্ত হয়।
      </p>
      {enabled ? (
        <RxQueuePanel />
      ) : (
        <div className="mt-6 rounded-2xl bg-white p-8 text-center ring-1 ring-slate-200">
          <p className="text-4xl" aria-hidden>
            🔒
          </p>
          <h2 className="mt-3 text-lg font-bold text-slate-900">এই মডিউলটি লক করা আছে</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
            ফার্মেসি প্যাক একটি পেইড অ্যাড-অন (ADV-22)। চালু করতে Admin → Feature Flags থেকে{" "}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[13px]">module.pharmacy</code>{" "}
            সক্রিয় করুন।
          </p>
        </div>
      )}
    </div>
  );
}
