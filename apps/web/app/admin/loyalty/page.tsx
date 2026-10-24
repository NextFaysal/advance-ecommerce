import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Money, formatPoisha } from "@/components/ui/money";
import { Phone } from "@/components/ui/phone";
import {
  DEFAULT_LOYALTY_CONFIG as config,
  availableBalance,
  demoAffiliates,
  demoCommissionEntries,
  demoLoyaltyFlag,
  demoMemberEntries,
  demoMembers,
  demoReferrals,
  lifetimeEarnedPoints,
  summarizeAffiliatePayout,
  tierForLifetimePoints,
} from "@/loyalty/index";

// Loyalty + Referral + Affiliate admin — Agent 36, Step 27 gap.
// TEMPORARY DEMO: all rows are SAMPLE data from the in-memory demo store
// (src/loyalty/store.ts). The program flag below is a page-local demo
// flag: `module.loyalty` now exists in the seed FEATURE_FLAGS (OFF,
// added 2026-10-24), but until the DB flag reader lands nothing here is
// DB-gated — the page says so plainly.
const nowIso = "2026-10-24T00:00:00.000Z";

export default function LoyaltyPage() {
  const memberRows = demoMembers.map((m) => {
    const entries = demoMemberEntries.filter((e) => e.customerId === m.customerId);
    const lifetime = lifetimeEarnedPoints(entries);
    const tier = tierForLifetimePoints(lifetime);
    return {
      name: m.name,
      phone: <Phone phone={m.phone} />,
      balance: String(availableBalance(entries, nowIso)),
      lifetime: String(lifetime),
      tier: <Badge>{`${tier.labelBn} (${tier.labelEn})`}</Badge>,
      redeemValue: <Money poisha={availableBalance(entries, nowIso) * config.redeemPoishaPerPoint} />,
    };
  });

  const referralRows = demoReferrals.map((r) => ({
    code: r.code,
    referrer: demoMembers.find((m) => m.customerId === r.referrerCustomerId)?.name ?? r.referrerCustomerId,
    status: <Badge>{r.status}</Badge>,
    reward: `${config.referrerRewardPoints} / ${config.refereeRewardPoints} পয়েন্ট`,
    order: r.qualifyingOrderId ?? "—",
  }));

  const affiliateRows = demoAffiliates.map((a) => {
    const s = summarizeAffiliatePayout(demoCommissionEntries, a.id);
    return {
      name: a.name,
      code: a.code,
      commission: `${(a.commissionBps / 100).toFixed(2)}%`,
      pending: <Money poisha={s.pendingPoisha} />,
      payable: <Money poisha={s.payablePoisha} />,
      paid: <Money poisha={s.paidPoisha} />,
    };
  });

  const totalPayable = demoAffiliates.reduce(
    (sum, a) => sum + summarizeAffiliatePayout(demoCommissionEntries, a.id).payablePoisha,
    0,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="লয়্যালটি, রেফারেল ও অ্যাফিলিয়েট"
        description="TEMPORARY DEMO — নমুনা ডেটা, ইন-মেমরি স্টোর। পয়েন্ট লেজার append-only: ব্যালেন্স কখনো সরাসরি বদলানো যায় না।"
      />

      <Card className="border-amber-300 bg-amber-50 text-sm text-amber-900">
        ⚠️ ফিচার ফ্ল্যাগ: <strong>{demoLoyaltyFlag.key}</strong> — এই ফ্ল্যাগটি seed-এর FEATURE_FLAGS তালিকায় আছে (seededInDb: হ্যাঁ)
        এবং এখন unified flag reader (src/lib/feature-flags.ts) দিয়ে গেট করা হয়। DB চালু হলে একই reader DB থেকে পড়বে।
      </Card>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="সদস্য (নমুনা)" value={String(demoMembers.length)} delta="ডেমো" icon="🎁" />
        <StatCard label="রেফারেল (নমুনা)" value={String(demoReferrals.length)} delta="ডেমো" icon="🔗" />
        <StatCard label="অ্যাফিলিয়েট পার্টনার" value={String(demoAffiliates.length)} delta="ডেমো" icon="🤝" />
        <StatCard label="পরিশোধযোগ্য কমিশন" value={formatPoisha(totalPayable)} delta="ডেমো" icon="💸" />
      </div>

      <Card>
        <h2 className="font-semibold">প্রোগ্রাম কনফিগ (ডেমো)</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-text-muted">
          <li>আয়: প্রতি ১০০ পয়সা (৳১) খরচে {config.earnPointsPer100Poisha} পয়েন্ট — শুধু DELIVERED অর্ডারে</li>
          <li>রিডিম: ১ পয়েন্ট = {formatPoisha(config.redeemPoishaPerPoint)}; সাবটোটালের সর্বোচ্চ {(config.maxRedeemBpsOfSubtotal / 100).toFixed(0)}% পর্যন্ত</li>
          <li>পয়েন্টের মেয়াদ: {config.pointsExpiryDays} দিন</li>
          <li>রেফারেল পুরস্কার: রেফারার {config.referrerRewardPoints} পয়েন্ট, নতুন গ্রাহক {config.refereeRewardPoints} পয়েন্ট — প্রথম অর্ডার DELIVERED হলে</li>
          <li>অ্যাফিলিয়েট: ডিফল্ট কমিশন {(config.affiliateDefaultCommissionBps / 100).toFixed(0)}%, কুকি উইন্ডো {config.affiliateCookieWindowDays} দিন, কমিশন পরিশোধযোগ্য হয় ডেলিভারির {config.affiliateReturnWindowDays} দিন পর (রিটার্ন উইন্ডো — ফ্রড গার্ড)</li>
        </ul>
      </Card>

      <DataTable
        caption="সদস্য — নমুনা (TEMPORARY DEMO)"
        columns={[
          { key: "name", header: "নাম" },
          { key: "phone", header: "ফোন" },
          { key: "balance", header: "ব্যালেন্স (পয়েন্ট)" },
          { key: "lifetime", header: "মোট আয় (পয়েন্ট)" },
          { key: "tier", header: "টিয়ার" },
          { key: "redeemValue", header: "রিডিম মূল্য" },
        ]}
        rows={memberRows}
      />

      <DataTable
        caption="রেফারেল — নমুনা (TEMPORARY DEMO)"
        columns={[
          { key: "code", header: "কোড" },
          { key: "referrer", header: "রেফারার" },
          { key: "status", header: "অবস্থা" },
          { key: "reward", header: "পুরস্কার (রেফারার/নতুন)" },
          { key: "order", header: "যোগ্য অর্ডার" },
        ]}
        rows={referralRows}
      />

      <DataTable
        caption="অ্যাফিলিয়েট পেআউট — নমুনা (TEMPORARY DEMO)"
        columns={[
          { key: "name", header: "পার্টনার" },
          { key: "code", header: "কোড" },
          { key: "commission", header: "কমিশন" },
          { key: "pending", header: "অপেক্ষমাণ" },
          { key: "payable", header: "পরিশোধযোগ্য" },
          { key: "paid", header: "পরিশোধিত" },
        ]}
        rows={affiliateRows}
      />
    </div>
  );
}
