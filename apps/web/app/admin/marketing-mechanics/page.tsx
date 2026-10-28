// /admin/marketing-mechanics (ADV-18B) — spin wheel + A/B
// experiments + WhatsApp broadcast admin. Locked-add-on page:
// while module.marketing_mechanics is OFF this renders the lock
// panel (the resellers pattern); the manager mounts only when on.
// Every API behind it re-checks marketing.campaign + the flag.
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { marketingMechanicsEnabled } from "@/marketing/docs";
import { MechanicsManager } from "./mechanics-manager";
import { CampaignsCard } from "./campaigns-card";

export const dynamic = "force-dynamic";

export default function MarketingMechanicsPage() {
  const enabled = marketingMechanicsEnabled();
  return (
    <main>
      <PageHeader
        title="মার্কেটিং মেকানিক্স"
        description="স্পিন হুইল, A/B এক্সপেরিমেন্ট, EMI ডিসপ্লে ও WhatsApp ব্রডকাস্ট — সব সেটিংস ডাটাবেসে থাকে, কোডে নয়।"
      />
      {enabled ? (
        <>
          <MechanicsManager />
          <CampaignsCard />
        </>
      ) : (
        <Card className="mt-6 text-center">
          <p className="text-4xl" aria-hidden>
            🔒
          </p>
          <h2 className="mt-3 text-lg font-bold text-text-main">এই মডিউলটি লক করা আছে</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-text-muted">
            মার্কেটিং মেকানিক্স একটি পেইড অ্যাড-অন (ADV-18)। চালু করতে Admin → Feature Flags থেকে{" "}
            <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px] text-text-main">module.marketing_mechanics</code>{" "}
            সক্রিয় করুন।
          </p>
        </Card>
      )}
    </main>
  );
}
