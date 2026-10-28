import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Money, formatPoisha } from "@/components/ui/money";
import { Phone } from "@/components/ui/phone";
import {
  DEFAULT_LOYALTY_CONFIG as config,
  availableBalance,
  lifetimeEarnedPoints,
  summarizeAffiliatePayout,
  tierForLifetimePoints,
} from "@/loyalty/index";
import { loyaltyStore } from "@/loyalty/db-store";
import { featureFlags } from "@/lib/feature-flags";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";

export const dynamic = "force-dynamic";

// Loyalty + Referral + Affiliate admin.
// REAL DATA (rewired 2026-10-25): members are the customers holding rows
// in the append-only PointsLedgerEntry ledger; balances and tiers are
// DERIVED by folding the ledger (src/loyalty/points.ts) — a balance is
// never stored or edited. Referrals and affiliate partners/commissions
// come from their DB tables via src/loyalty/db-store.ts — the same
// store the admin API (GET /api/v1/admin/loyalty) reads. An empty
// ledger renders honest empty states, never sample rows; a failed DB
// read renders an error state, never demo data.
export default async function LoyaltyPage() {
  const nowIso = new Date().toISOString();

  let view: {
    members: {
      customerId: string;
      name: string;
      phone: string;
      balance: number;
      lifetime: number;
      tierLabel: string;
    }[];
    referrals: {
      code: string;
      referrerName: string;
      status: string;
      qualifyingOrderId: string | null;
    }[];
    affiliates: {
      name: string;
      code: string;
      commissionBps: number;
      pendingPoisha: number;
      payablePoisha: number;
      paidPoisha: number;
    }[];
    totalPayable: number;
    loyaltyFlagOn: boolean;
  } | null = null;

  try {
    const memberRows = await loyaltyStore.listMembers();
    const members = await Promise.all(
      memberRows.map(async (m) => {
        const entries = await loyaltyStore.listEntries(m.customerId);
        const lifetime = lifetimeEarnedPoints(entries);
        const tier = tierForLifetimePoints(lifetime);
        return {
          customerId: m.customerId,
          name: m.name,
          phone: m.phone,
          balance: availableBalance(entries, nowIso),
          lifetime,
          tierLabel: `${tier.labelBn} (${tier.labelEn})`,
        };
      }),
    );
    const nameByCustomerId = new Map(members.map((m) => [m.customerId, m.name]));

    const [referralRows, affiliateRows, commissions] = await Promise.all([
      loyaltyStore.listReferrals(),
      loyaltyStore.listAffiliates(),
      loyaltyStore.listCommissions(),
    ]);
    const affiliates = affiliateRows.map((a) => {
      const s = summarizeAffiliatePayout(commissions, a.id);
      return {
        name: a.name,
        code: a.code,
        commissionBps: a.commissionBps,
        pendingPoisha: s.pendingPoisha,
        payablePoisha: s.payablePoisha,
        paidPoisha: s.paidPoisha,
      };
    });

    await ensureDbFeatureFlags();
    const loyaltyFlagOn = featureFlags.isFeatureEnabled("module.loyalty");

    view = {
      members,
      referrals: referralRows.map((r) => ({
        code: r.code,
        referrerName: nameByCustomerId.get(r.referrerCustomerId) ?? r.referrerCustomerId,
        status: r.status,
        qualifyingOrderId: r.qualifyingOrderId,
      })),
      affiliates,
      totalPayable: affiliates.reduce((sum, a) => sum + a.payablePoisha, 0),
      loyaltyFlagOn,
    };
  } catch {
    view = null;
  }

  if (view === null) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="লয়্যালটি, রেফারেল ও অ্যাফিলিয়েট"
          description="পয়েন্ট লেজার append-only: ব্যালেন্স কখনো সরাসরি বদলানো যায় না।"
        />
        <Card className="border-rose-300 bg-rose-50 text-sm text-rose-900">
          ডাটাবেস থেকে লয়্যালটি ডেটা পড়া যায়নি — তাই কোনো সংখ্যা দেখানো হচ্ছে না (আগের ডেমো সারি
          আর দেখানো হয় না)। ডাটাবেস সংযোগ ঠিক করে পেজটি আবার লোড করুন।
        </Card>
      </div>
    );
  }

  const memberTableRows = view.members.map((m) => ({
    name: m.name,
    phone: <Phone phone={m.phone} />,
    balance: <span className="tnum">{m.balance}</span>,
    lifetime: <span className="tnum">{m.lifetime}</span>,
    tier: <Badge>{m.tierLabel}</Badge>,
    redeemValue: <Money poisha={m.balance * config.redeemPoishaPerPoint} />,
  }));

  const referralTableRows = view.referrals.map((r) => ({
    code: r.code,
    referrer: r.referrerName,
    status: <Badge>{r.status}</Badge>,
    reward: <span className="tnum">{`${config.referrerRewardPoints} / ${config.refereeRewardPoints} পয়েন্ট`}</span>,
    order: r.qualifyingOrderId ?? "—",
  }));

  const affiliateTableRows = view.affiliates.map((a) => ({
    name: a.name,
    code: a.code,
    commission: <span className="tnum">{`${(a.commissionBps / 100).toFixed(2)}%`}</span>,
    pending: <Money poisha={a.pendingPoisha} />,
    payable: <Money poisha={a.payablePoisha} />,
    paid: <Money poisha={a.paidPoisha} />,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="লয়্যালটি, রেফারেল ও অ্যাফিলিয়েট"
        description="আসল ডেটা — পয়েন্ট লেজার (PointsLedgerEntry) থেকে হিসাব করা। পয়েন্ট লেজার append-only: ব্যালেন্স কখনো সরাসরি বদলানো যায় না।"
      />

      <Card className="border-amber-300 bg-amber-50 text-sm text-amber-900">
        ফিচার ফ্ল্যাগ: <strong>module.loyalty</strong> — বর্তমান অবস্থা (DB থেকে পড়া):{" "}
        <strong>{view.loyaltyFlagOn ? "চালু (ON)" : "বন্ধ (OFF)"}</strong>। ফ্ল্যাগ বদলাতে
        ফিচার ফ্ল্যাগ পেজে যান — প্রতিটি বদল কারণসহ অডিট লগে থাকে।
      </Card>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="সদস্য" value={String(view.members.length)} delta="আসল লেজার" icon={<Icon name="users" size={22} />} />
        <StatCard label="রেফারেল" value={String(view.referrals.length)} delta="আসল ডেটা" icon={<Icon name="sparkles" size={22} />} />
        <StatCard label="অ্যাফিলিয়েট পার্টনার" value={String(view.affiliates.length)} delta="আসল ডেটা" icon={<Icon name="store" size={22} />} />
        <StatCard label="পরিশোধযোগ্য কমিশন" value={formatPoisha(view.totalPayable)} delta="PAYABLE অবস্থা" icon={<Icon name="banknote" size={22} />} />
      </div>

      <Card>
        <h2 className="font-semibold">প্রোগ্রাম কনফিগ</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-text-muted">
          <li>আয়: প্রতি ১০০ পয়সা (৳১) খরচে {config.earnPointsPer100Poisha} পয়েন্ট — শুধু DELIVERED অর্ডারে</li>
          <li>রিডিম: ১ পয়েন্ট = {formatPoisha(config.redeemPoishaPerPoint)}; সাবটোটালের সর্বোচ্চ {(config.maxRedeemBpsOfSubtotal / 100).toFixed(0)}% পর্যন্ত</li>
          <li>পয়েন্টের মেয়াদ: {config.pointsExpiryDays} দিন</li>
          <li>রেফারেল পুরস্কার: রেফারার {config.referrerRewardPoints} পয়েন্ট, নতুন গ্রাহক {config.refereeRewardPoints} পয়েন্ট — প্রথম অর্ডার DELIVERED হলে</li>
          <li>অ্যাফিলিয়েট: ডিফল্ট কমিশন {(config.affiliateDefaultCommissionBps / 100).toFixed(0)}%, কুকি উইন্ডো {config.affiliateCookieWindowDays} দিন, কমিশন পরিশোধযোগ্য হয় ডেলিভারির {config.affiliateReturnWindowDays} দিন পর (রিটার্ন উইন্ডো — ফ্রড গার্ড)</li>
        </ul>
      </Card>

      <div>
        <DataTable
          caption="সদস্য — আসল লেজার থেকে"
          columns={[
            { key: "name", header: "নাম" },
            { key: "phone", header: "ফোন" },
            { key: "balance", header: "ব্যালেন্স (পয়েন্ট)" },
            { key: "lifetime", header: "মোট আয় (পয়েন্ট)" },
            { key: "tier", header: "টিয়ার" },
            { key: "redeemValue", header: "রিডিম মূল্য" },
          ]}
          rows={memberTableRows}
        />
        {view.members.length === 0 ? (
          <p className="mt-2 text-sm text-text-muted">
            এখনো কোনো সদস্য নেই — কোনো অর্ডার DELIVERED হলেই ওই গ্রাহকের লেজারে পয়েন্ট জমা হয়ে
            তিনি এখানে দেখা যাবেন।
          </p>
        ) : null}
      </div>

      <div>
        <DataTable
          caption="রেফারেল — আসল ডেটা"
          columns={[
            { key: "code", header: "কোড" },
            { key: "referrer", header: "রেফারার" },
            { key: "status", header: "অবস্থা" },
            { key: "reward", header: "পুরস্কার (রেফারার/নতুন)" },
            { key: "order", header: "যোগ্য অর্ডার" },
          ]}
          rows={referralTableRows}
        />
        {view.referrals.length === 0 ? (
          <p className="mt-2 text-sm text-text-muted">এখনো কোনো রেফারেল তৈরি হয়নি।</p>
        ) : null}
      </div>

      <div>
        <DataTable
          caption="অ্যাফিলিয়েট পেআউট — আসল ডেটা"
          columns={[
            { key: "name", header: "পার্টনার" },
            { key: "code", header: "কোড" },
            { key: "commission", header: "কমিশন" },
            { key: "pending", header: "অপেক্ষমাণ" },
            { key: "payable", header: "পরিশোধযোগ্য" },
            { key: "paid", header: "পরিশোধিত" },
          ]}
          rows={affiliateTableRows}
        />
        {view.affiliates.length === 0 ? (
          <p className="mt-2 text-sm text-text-muted">
            এখনো কোনো অ্যাফিলিয়েট পার্টনার নেই — পার্টনার যোগ হলে তাদের কমিশনের হিসাব এখানে আসবে।
          </p>
        ) : null}
      </div>
    </div>
  );
}
