import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Money } from "@/components/ui/money";
import { Phone } from "@/components/ui/phone";
import { RiskBadge } from "@/components/ui/status-badge";
import { demoFeatureFlags } from "@/automation/flags";
import { InMemoryFraudListStore } from "@/fraud/lists";
import { scoreFraud } from "@/fraud/scoring";
import type { FraudScoreInput, RiskLevel, SuggestedAction } from "@/fraud/types";

// Admin > Fraud — Agent 20, Step 43 (A2) UI over Agent 13's scorer.
// Locked state: while module.fraud_scoring is OFF (seeded default — paid
// add-on), the page renders the lock panel, matching the API's 403
// FEATURE_LOCKED and the riders page pattern. The score checker below
// calls the pure scoreFraud() with fixed SAMPLE inputs (deterministic,
// labelled TEMPORARY DEMO); lists are a locally seeded in-memory demo
// store. Real wiring: the checker form POSTs to
// /api/v1/admin/fraud-rules/score with an order assembled by the order
// service, and the lists come from the fraud-rules API (Prisma-backed
// FraudListEntry table) — full phone is never shown, masked only.

const NOW = "2026-10-24T10:00:00.000Z";

/** Locally seeded demo list store (the shared demoFraudListStore ships empty). */
const demoLists = new InMemoryFraudListStore({
  blacklist: [
    { id: "bl_demo_1", kind: "phone", value: "+8801911223344", reason: "বারবার ভুয়া COD অর্ডার (ডেমো)", createdAt: "2026-10-20T08:00:00.000Z" },
    { id: "bl_demo_2", kind: "address", value: "gazipur", district: "Gazipur", reason: "উচ্চ রিটার্ন এলাকা (ডেমো)", createdAt: "2026-10-21T08:00:00.000Z" },
  ],
  whitelist: [
    { id: "wl_demo_1", kind: "phone", value: "+8801512345678", reason: "যাচাই করা নিয়মিত গ্রাহক (ডেমো)", createdAt: "2026-10-18T08:00:00.000Z" },
  ],
});

const DHAKA = { division: "Dhaka", district: "Dhaka", upazila: "Mirpur" };

interface Scenario {
  label: string;
  input: Omit<FraudScoreInput, "lists" | "now">;
}

const SCENARIOS: Scenario[] = [
  {
    label: "পরিচ্ছন্ন প্রথম অর্ডার (প্রিপেইড)",
    input: {
      phone: "+8801812345678",
      shippingAddress: DHAKA,
      accountAddress: DHAKA,
      paymentMethod: "bkash",
      totalPoisha: 120000,
      itemKeys: ["SKU-DEMO-010"],
      recentOrders: [],
    },
  },
  {
    label: "ঝুঁকিপূর্ণ COD (ডুপ্লিকেট + কম কুরিয়ার সাফল্য)",
    input: {
      phone: "+8801712345678",
      shippingAddress: DHAKA,
      accountAddress: DHAKA,
      paymentMethod: "cod",
      totalPoisha: 1200000,
      itemKeys: ["SKU-DEMO-001"],
      recentOrders: [
        { id: "ord_recent_1", itemKeys: ["SKU-DEMO-001"], createdAt: "2026-10-24T09:30:00.000Z", status: "PENDING" },
      ],
      courierHistory: { totalBookings: 5, delivered: 2, failedOrReturned: 3 },
    },
  },
  {
    label: "কালো তালিকার ফোন",
    input: {
      phone: "+8801911223344",
      shippingAddress: DHAKA,
      paymentMethod: "bkash",
      totalPoisha: 250000,
      itemKeys: ["SKU-DEMO-020"],
      recentOrders: [],
    },
  },
  {
    label: "সাদা তালিকার গ্রাহক (একটি ডুপ্লিকেটসহ)",
    input: {
      phone: "+8801512345678",
      shippingAddress: DHAKA,
      accountAddress: DHAKA,
      paymentMethod: "cod",
      totalPoisha: 300000,
      itemKeys: ["SKU-DEMO-030"],
      recentOrders: [
        { id: "ord_recent_2", itemKeys: ["SKU-DEMO-030"], createdAt: "2026-10-24T09:45:00.000Z", status: "CONFIRMED" },
      ],
    },
  },
];

const ACTION_TEXT: Record<SuggestedAction, { label: string; tone: "success" | "warning" | "danger" | "info" }> = {
  auto_confirm: { label: "স্বয়ংক্রিয় নিশ্চিত", tone: "success" },
  manual_review: { label: "ম্যানুয়াল রিভিউ", tone: "warning" },
  require_advance: { label: "আগাম পেমেন্ট লাগবে", tone: "warning" },
  block: { label: "ব্লক করুন", tone: "danger" },
};

const SIGNAL_TEXT: Record<string, string> = {
  blacklist_hit: "কালো তালিকা মিল",
  whitelist: "সাদা তালিকা ছাড়",
  duplicate_order: "ডুপ্লিকেট অর্ডার",
  courier_success_rate: "কুরিয়ার সাফল্যের হার",
  high_cod_amount: "বড় COD পরিমাণ",
  address_mismatch: "ঠিকানার অমিল",
  return_history: "ফেরতের ইতিহাস",
};

const RISK_BADGE_LEVEL: Record<RiskLevel, "LOW" | "MEDIUM" | "HIGH"> = {
  Low: "LOW",
  Medium: "MEDIUM",
  High: "HIGH",
};

export default function AdminFraudPage() {
  if (!demoFeatureFlags.isEnabled("module.fraud_scoring")) {
    return (
      <main>
        <PageHeader title="প্রতারণা যাচাই (Fraud Scoring)" description="ঝুঁকি স্কোর ও কালো/সাদা তালিকা (ধাপ ৪৩, A2)" />
        <p role="status">
          🔒 এই মডিউলটি এই ইনস্টলের জন্য লক করা আছে। ফ্রড স্কোরিং একটি পেইড অ্যাড-অন —
          আনলক করতে Admin &gt; Settings &gt; Feature Flags-এ <code>module.fraud_scoring</code> চালু করুন।
        </p>
      </main>
    );
  }

  const lists = demoLists.snapshot();
  const results = SCENARIOS.map((s) => ({
    scenario: s,
    assessment: scoreFraud({ ...s.input, lists, now: NOW }),
  }));
  const highRisk = results.filter((r) => r.assessment.score >= 70).length;
  const breakdown = results[1]; // the risky COD scenario — richest signal mix

  const scenarioRows = results.map(({ scenario, assessment }) => {
    const action = ACTION_TEXT[assessment.suggestedAction];
    return {
      scenario: <span className="font-medium">{scenario.label}</span>,
      phone: <Phone phone={scenario.input.phone} />,
      total: <Money poisha={scenario.input.totalPoisha} />,
      score: <span className="font-mono font-bold tabular-nums">{assessment.score}</span>,
      level: <RiskBadge level={RISK_BADGE_LEVEL[assessment.level]} />,
      action: <Badge tone={action.tone}>{action.label}</Badge>,
      otp: assessment.requiresOtp ? <Badge tone="danger">⚠ OTP লাগবে</Badge> : <Badge tone="neutral">OTP লাগবে না</Badge>,
    };
  });

  const signalRows = breakdown
    ? breakdown.assessment.signals.map((sig) => ({
        signal: SIGNAL_TEXT[sig.key] ?? sig.key,
        points: (
          <span className="font-mono tabular-nums">
            {sig.points > 0 ? `+${sig.points}` : sig.points}
          </span>
        ),
        triggered: sig.triggered ? <Badge tone="warning">⚠ ট্রিগার হয়েছে</Badge> : <Badge tone="neutral">ট্রিগার হয়নি</Badge>,
        detail: sig.detail,
      }))
    : [];

  const listRows = [
    ...lists.blacklist.map((e) => ({ entry: e, listName: "কালো তালিকা", tone: "danger" as const })),
    ...lists.whitelist.map((e) => ({ entry: e, listName: "সাদা তালিকা", tone: "success" as const })),
  ].map(({ entry, listName, tone }) => ({
    list: <Badge tone={tone}>{listName}</Badge>,
    kind: entry.kind === "phone" ? "ফোন" : "ঠিকানা (জেলা)",
    value: entry.kind === "phone" ? <Phone phone={entry.value} /> : (entry.district ?? entry.value),
    reason: entry.reason,
    added: <span className="font-mono text-xs">{entry.createdAt.slice(0, 10)}</span>,
  }));

  return (
    <main>
      <PageHeader
        title="প্রতারণা যাচাই (Fraud Scoring)"
        description="TEMPORARY DEMO — নির্দিষ্ট নমুনা ইনপুটে scoreFraud() চালানো হয়েছে। আসল অর্ডারে স্কোর চেকআউটে গণনা হয়।"
        breadcrumb="Admin / Fraud"
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="যাচাই করা নমুনা" value={String(results.length)} delta="ডেমো দৃশ্য" icon="🔎" />
        <StatCard label="উচ্চ ঝুঁকি (৭০+)" value={String(highRisk)} delta={highRisk > 0 ? "ব্যবস্থা লাগবে" : "নেই"} deltaTone={highRisk > 0 ? "down" : "up"} icon="⚠" />
        <StatCard label="কালো তালিকা এন্ট্রি" value={String(lists.blacklist.length)} delta="ডেমো store" icon="⛔" />
        <StatCard label="সাদা তালিকা এন্ট্রি" value={String(lists.whitelist.length)} delta="ডেমো store" icon="✓" />
      </div>

      <h2 className="mb-3 text-lg font-semibold">স্কোর চেকার (নমুনা ইনপুট)</h2>
      <DataTable
        caption="প্রতিটি সারি একটি নমুনা অর্ডারের সারাংশ → স্কোর, স্তর, প্রস্তাবিত পদক্ষেপ ও OTP প্রয়োজনীয়তা। ফোন মাস্ক করা।"
        columns={[
          { key: "scenario", header: "নমুনা দৃশ্য" },
          { key: "phone", header: "ফোন (মাস্ক করা)" },
          { key: "total", header: "অর্ডারের মোট" },
          { key: "score", header: "স্কোর (০–১০০)" },
          { key: "level", header: "ঝুঁকির স্তর" },
          { key: "action", header: "প্রস্তাবিত পদক্ষেপ" },
          { key: "otp", header: "OTP" },
        ]}
        rows={scenarioRows}
      />

      <h2 className="mb-3 mt-8 text-lg font-semibold">সিগন্যাল বিবরণ — ঝুঁকিপূর্ণ COD নমুনা</h2>
      <DataTable
        caption={`মোট স্কোর ${breakdown?.assessment.score ?? "—"} — কোন সিগন্যাল কত পয়েন্ট দিয়েছে, স্টাফ যেন সিদ্ধান্তের কারণ দেখতে পায়`}
        columns={[
          { key: "signal", header: "সিগন্যাল" },
          { key: "points", header: "পয়েন্ট" },
          { key: "triggered", header: "অবস্থা" },
          { key: "detail", header: "বিবরণ" },
        ]}
        rows={signalRows}
      />

      <h2 className="mb-3 mt-8 text-lg font-semibold">কালো / সাদা তালিকা</h2>
      <DataTable
        caption="ডেমো তালিকা — ফোন সবসময় মাস্ক করা; পূর্ণ নম্বর কখনো এই পেজে দেখানো হয় না"
        columns={[
          { key: "list", header: "তালিকা" },
          { key: "kind", header: "ধরন" },
          { key: "value", header: "মান" },
          { key: "reason", header: "কারণ" },
          { key: "added", header: "যোগ করা" },
        ]}
        rows={listRows}
      />
    </main>
  );
}
