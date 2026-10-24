import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { FilterBar } from "@/components/ui/filter-bar";
import { formatPoisha } from "@/components/ui/money";
import { demoFeatureFlags } from "@/automation/flags";
import { EXAMPLE_RULES } from "@/automation/examples";
import { processEvent, runRule } from "@/automation/engine";
import type {
  AutomationAction,
  AutomationEvent,
  ConditionField,
  ConditionNode,
  ConditionValue,
} from "@/automation/types";
import { RuleToggleList, type RuleListItem } from "./rule-list";

// Admin > Automation — Agent 20, Step 43 (A1) UI over Agent 13's engine.
// Locked state: while module.automation is OFF (seeded default — paid
// add-on), the page renders the lock panel, matching the API's 403
// FEATURE_LOCKED and the riders page pattern. Everything below the lock is
// computed by the pure engine in src/automation over TEMPORARY DEMO rules
// (EXAMPLE_RULES) and sample events — run logs here are dry-run output:
// nothing is applied, persisted, or sent. Real wiring: rules + run logs
// come from GET /api/v1/admin/automation and /runs (Prisma-backed store),
// toggles PATCH the rule, and the dry-run panel POSTs to /dry-run.

const TRIGGER_TEXT: Record<string, string> = {
  "order.created": "অর্ডার তৈরি হলে (order.created)",
  "order.status_changed": "অর্ডারের অবস্থা বদলালে (order.status_changed)",
  "payment.succeeded": "পেমেন্ট সফল হলে (payment.succeeded)",
  "stock.low": "মজুদ কমে গেলে (stock.low)",
  "checkout.abandoned": "চেকআউট পরিত্যক্ত হলে (checkout.abandoned)",
};

const FIELD_TEXT: Record<ConditionField, string> = {
  orderStatus: "অর্ডারের অবস্থা",
  paymentStatus: "পেমেন্টের অবস্থা",
  paymentMethod: "পেমেন্ট মাধ্যম",
  totalPoisha: "মোট টাকা",
  itemCount: "আইটেম সংখ্যা",
  district: "জেলা",
  division: "বিভাগ",
  courier: "কুরিয়ার",
  riskScore: "ঝুঁকি স্কোর",
  tags: "ট্যাগ",
  stockAvailable: "মজুদ",
  sku: "SKU",
  abandonedMinutes: "পরিত্যক্ত সময় (মিনিট)",
  paymentAmountPoisha: "পেমেন্টের পরিমাণ",
};

const OPERATOR_TEXT: Record<string, string> = {
  eq: "=",
  neq: "≠",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  in: "এর মধ্যে",
  not_in: "এর মধ্যে নয়",
  contains: "ধারণ করে",
  not_contains: "ধারণ করে না",
  exists: "আছে",
  not_exists: "নেই",
};

function valueText(field: ConditionField, value: ConditionValue | undefined): string {
  if (value === undefined) return "";
  if (Array.isArray(value)) return value.join(", ");
  if ((field === "totalPoisha" || field === "paymentAmountPoisha") && typeof value === "number") {
    return formatPoisha(value);
  }
  return String(value);
}

function describeConditions(node: ConditionNode): string {
  if (node.kind === "condition") {
    const v = valueText(node.field, node.value);
    return `${FIELD_TEXT[node.field]} ${OPERATOR_TEXT[node.operator] ?? node.operator}${v ? ` ${v}` : ""}`;
  }
  const joined = node.nodes.map(describeConditions).join(node.logic === "AND" ? " এবং " : " অথবা ");
  return `(${joined})`;
}

function describeAction(action: AutomationAction): string {
  switch (action.type) {
    case "confirm_order":
      return "অর্ডার নিশ্চিত করুন";
    case "assign_courier":
      return `কুরিয়ার নির্ধারণ করুন: ${action.courier}`;
    case "send_sms":
      return `SMS পাঠান (টেমপ্লেট: ${action.templateKey})`;
    case "send_email":
      return `ইমেইল পাঠান (টেমপ্লেট: ${action.templateKey})`;
    case "add_tag":
      return `ট্যাগ যোগ করুন: ${action.tag}`;
    case "remove_tag":
      return `ট্যাগ সরান: ${action.tag}`;
    case "notify_staff":
      return `স্টাফকে জানান: ${action.message}`;
  }
}

/** Sample events for the demo run log + dry-run panel (fixed times, deterministic). */
const SAMPLE_EVENTS: AutomationEvent[] = [
  {
    type: "order.created",
    occurredAt: "2026-10-24T09:15:00.000Z",
    order: {
      id: "ord_demo_1",
      orderNo: "DEMO-1001",
      status: "PENDING",
      paymentStatus: "UNPAID",
      paymentMethod: "cod",
      totalPoisha: 185000,
      itemCount: 2,
      customerPhone: "+8801712345678",
      district: "Dhaka",
      division: "Dhaka",
      riskScore: 12,
      tags: [],
    },
  },
  {
    type: "checkout.abandoned",
    occurredAt: "2026-10-24T09:40:00.000Z",
    checkout: { id: "chk_demo_1", totalPoisha: 75000, abandonedMinutes: 45 },
  },
  {
    type: "stock.low",
    occurredAt: "2026-10-24T10:05:00.000Z",
    stock: { variantId: "var_demo_1", sku: "SKU-DEMO-001", available: 3 },
  },
  {
    type: "payment.succeeded",
    occurredAt: "2026-10-24T10:20:00.000Z",
    payment: { amountPoisha: 1200000, method: "bkash" },
  },
];

export default function AdminAutomationPage() {
  if (!demoFeatureFlags.isEnabled("module.automation")) {
    return (
      <main>
        <PageHeader title="অটোমেশন (Automation)" description="নিয়মভিত্তিক অটোমেশন ইঞ্জিন (ধাপ ৪৩, A1)" />
        <p role="status">
          🔒 এই মডিউলটি এই ইনস্টলের জন্য লক করা আছে। অটোমেশন একটি পেইড অ্যাড-অন —
          আনলক করতে Admin &gt; Settings &gt; Feature Flags-এ <code>module.automation</code> চালু করুন।
        </p>
      </main>
    );
  }

  const rules = EXAMPLE_RULES;
  const allRuns = SAMPLE_EVENTS.flatMap((event, ei) =>
    processEvent(rules, event, { dryRun: true, runIdFor: (rule, ri) => `demo-run-${ei}-${ri}` }),
  );
  const matchedRuns = allRuns.filter((r) => r.matched);

  const ruleItems: RuleListItem[] = rules.map((rule) => ({
    id: rule.id,
    name: rule.name,
    description: rule.description ?? "",
    triggerText: TRIGGER_TEXT[rule.trigger] ?? rule.trigger,
    conditionsText: describeConditions(rule.conditions),
    actionsText: rule.actions.map(describeAction).join(" · "),
    delayText: rule.delaySeconds === 0 ? "সাথে সাথে" : `${rule.delaySeconds} সেকেন্ড পরে (সময়সূচি অনুযায়ী)`,
    enabled: rule.enabled,
  }));

  const runRows = matchedRuns.map((run) => ({
    rule: <span className="font-medium">{run.ruleName}</span>,
    trigger: TRIGGER_TEXT[run.trigger] ?? run.trigger,
    status: (
      <Badge tone={run.status === "scheduled" ? "warning" : "info"}>
        {run.status === "scheduled" ? "◷ সময়সূচি" : run.dryRun ? "ড্রাই-রান মিলেছে" : "✓ মিলেছে"}
      </Badge>
    ),
    order: run.orderId ? <span className="font-mono">{run.orderId}</span> : "—",
    customer: run.customerPhoneMasked ? <span className="font-mono tabular-nums">{run.customerPhoneMasked}</span> : "—",
    effects: run.effects.length > 0 ? run.effects.map((e) => e.description).join(" · ") : "—",
    at: <span className="font-mono text-xs">{run.evaluatedAt}</span>,
  }));

  // Dry-run panel: first example rule against the first sample event.
  const dryRule = rules[0];
  const dryEvent = SAMPLE_EVENTS[0];
  const dryRun = dryRule && dryEvent ? runRule(dryRule, dryEvent, { dryRun: true, runId: "dry-run-panel" }) : null;

  return (
    <main>
      <PageHeader
        title="অটোমেশন (Automation)"
        description="TEMPORARY DEMO — উদাহরণ নিয়ম ও নমুনা ইভেন্ট দিয়ে তৈরি। ড্রাই-রান আউটপুট: কিছুই প্রয়োগ বা সংরক্ষণ হয়নি।"
        breadcrumb="Admin / Automation"
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="মোট নিয়ম" value={String(rules.length)} delta="উদাহরণ নিয়ম" icon="⚙" />
        <StatCard label="সক্রিয় নিয়ম" value={String(rules.filter((r) => r.enabled).length)} delta="ডেমো store" icon="✓" />
        <StatCard label="নমুনা ইভেন্ট" value={String(SAMPLE_EVENTS.length)} delta="ড্রাই-রান" icon="▸" />
        <StatCard label="মিল পাওয়া রান" value={String(matchedRuns.length)} delta={`${allRuns.length}টি মূল্যায়নের মধ্যে`} icon="↻" />
      </div>

      <h2 className="mb-3 text-lg font-semibold">নিয়মের তালিকা</h2>
      <div className="mb-3">
        <FilterBar chips={["ডেমো"]} />
      </div>
      <RuleToggleList initialRules={ruleItems} />

      <h2 className="mb-3 mt-8 text-lg font-semibold">ড্রাই-রান প্যানেল (রূপরেখা)</h2>
      <Card>
        {dryRule && dryEvent && dryRun ? (
          <>
            <p className="text-sm">
              নিয়ম: <span className="font-medium">{dryRule.name}</span> · ইভেন্ট:{" "}
              <span className="font-mono text-xs">{dryEvent.type}</span> · অর্ডার{" "}
              <span className="font-mono">{dryEvent.order?.orderNo ?? "—"}</span> — ফলাফল:{" "}
              <Badge tone={dryRun.matched ? "success" : "neutral"}>{dryRun.matched ? "✓ মিলেছে" : "মিলেনি"}</Badge>
            </p>
            <p className="mt-1 text-xs text-text-muted">
              ড্রাই-রানে প্রতিটি শর্ত যাচাই হয়, কিন্তু কোনো কাজ প্রয়োগ হয় না এবং রান লগ সংরক্ষণ হয় না।
            </p>
            <div className="mt-4">
              <DataTable
                caption="শর্ত যাচাই (trace)"
                columns={[
                  { key: "field", header: "ক্ষেত্র" },
                  { key: "operator", header: "অপারেটর" },
                  { key: "expected", header: "প্রত্যাশিত" },
                  { key: "actual", header: "প্রকৃত" },
                  { key: "result", header: "ফলাফল" },
                ]}
                rows={dryRun.trace.map((t) => ({
                  field: FIELD_TEXT[t.field],
                  operator: OPERATOR_TEXT[t.operator] ?? t.operator,
                  expected: t.expected === undefined ? "—" : valueText(t.field, t.expected),
                  actual: t.actual === undefined ? "—" : valueText(t.field, t.actual),
                  result: <Badge tone={t.matched ? "success" : "danger"}>{t.matched ? "✓ মিলেছে" : "✕ মিলেনি"}</Badge>,
                }))}
              />
            </div>
            {dryRun.effects.length > 0 ? (
              <ul className="mt-4 list-disc space-y-1 pl-5 text-sm">
                {dryRun.effects.map((e, i) => (
                  <li key={i}>
                    <Badge tone="info">পরিকল্পিত</Badge> {e.description}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-text-muted">ড্রাই-রানের জন্য কোনো নিয়ম পাওয়া যায়নি।</p>
        )}
      </Card>

      <h2 className="mb-3 mt-8 text-lg font-semibold">রান লগ (ডেমো)</h2>
      <DataTable
        caption="নমুনা ইভেন্টগুলোর ড্রাই-রান মূল্যায়ন — শুধু মিল পাওয়া রান দেখানো হচ্ছে; ফোন সবসময় মাস্ক করা"
        columns={[
          { key: "rule", header: "নিয়ম" },
          { key: "trigger", header: "ট্রিগার" },
          { key: "status", header: "অবস্থা" },
          { key: "order", header: "অর্ডার" },
          { key: "customer", header: "গ্রাহক (মাস্ক করা)" },
          { key: "effects", header: "পরিকল্পিত কাজ" },
          { key: "at", header: "মূল্যায়নের সময়" },
        ]}
        rows={runRows}
      />
    </main>
  );
}
