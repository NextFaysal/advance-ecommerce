"use client";

// Admin > Automation — wired client (UI wiring pass).
// All data comes from the real, DB-backed admin APIs:
//   GET    /api/v1/admin/automation          — rule list
//   POST   /api/v1/admin/automation          — create rule
//   PATCH  /api/v1/admin/automation/[id]     — edit / enable-disable toggle
//   DELETE /api/v1/admin/automation/[id]     — delete rule
//   POST   /api/v1/admin/automation/dry-run  — evaluate a rule against a
//                                              SAMPLE event (input fixture)
//   GET    /api/v1/admin/automation/runs     — persisted run logs
// The module is a paid add-on: when the API answers 403 FEATURE_LOCKED the
// page renders the same lock panel as before. The sample events below are
// INPUT FIXTURES for the dry-run tester only — they are never presented
// as stored data, and dry-run results are never persisted (API contract).
import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { formatPoisha } from "@/components/ui/money";
import {
  AUTOMATION_TRIGGERS,
  CONDITION_FIELDS,
  CONDITION_OPERATORS,
  type AutomationAction,
  type AutomationEvent,
  type AutomationRule,
  type AutomationRunLog,
  type Condition,
  type ConditionField,
  type ConditionNode,
  type ConditionOperator,
  type ConditionValue,
} from "@/automation/types";

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

const NUMERIC_FIELDS: ReadonlySet<ConditionField> = new Set([
  "totalPoisha",
  "paymentAmountPoisha",
  "itemCount",
  "riskScore",
  "stockAvailable",
  "abandonedMinutes",
]);

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

const ACTION_TYPE_TEXT: Record<AutomationAction["type"], string> = {
  confirm_order: "অর্ডার নিশ্চিত করুন",
  assign_courier: "কুরিয়ার নির্ধারণ",
  send_sms: "SMS পাঠান",
  send_email: "ইমেইল পাঠান",
  add_tag: "ট্যাগ যোগ",
  remove_tag: "ট্যাগ সরান",
  notify_staff: "স্টাফকে জানান",
};

const ACTION_PARAM_LABEL: Partial<Record<AutomationAction["type"], string>> = {
  assign_courier: "কুরিয়ারের নাম",
  send_sms: "টেমপ্লেট কী",
  send_email: "টেমপ্লেট কী",
  add_tag: "ট্যাগ",
  remove_tag: "ট্যাগ",
  notify_staff: "বার্তা",
};

function actionParam(action: AutomationAction): string {
  switch (action.type) {
    case "assign_courier":
      return action.courier;
    case "send_sms":
    case "send_email":
      return action.templateKey;
    case "add_tag":
    case "remove_tag":
      return action.tag;
    case "notify_staff":
      return action.message;
    case "confirm_order":
      return "";
  }
}

function buildAction(type: AutomationAction["type"], param: string): AutomationAction {
  switch (type) {
    case "confirm_order":
      return { type };
    case "assign_courier":
      return { type, courier: param };
    case "send_sms":
      return { type, templateKey: param };
    case "send_email":
      return { type, templateKey: param };
    case "add_tag":
      return { type, tag: param };
    case "remove_tag":
      return { type, tag: param };
    case "notify_staff":
      return { type, message: param };
  }
}

/** Sample events — INPUT FIXTURES for the dry-run tester only (fixed times, deterministic). */
const SAMPLE_EVENTS: { label: string; event: AutomationEvent }[] = [
  {
    label: "নমুনা: নতুন COD অর্ডার (ঢাকা)",
    event: {
      type: "order.created",
      occurredAt: "2026-10-24T09:15:00.000Z",
      order: {
        id: "ord_sample_1",
        orderNo: "SAMPLE-1001",
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
  },
  {
    label: "নমুনা: পরিত্যক্ত চেকআউট (৪৫ মিনিট)",
    event: {
      type: "checkout.abandoned",
      occurredAt: "2026-10-24T09:40:00.000Z",
      checkout: { id: "chk_sample_1", totalPoisha: 75000, abandonedMinutes: 45 },
    },
  },
  {
    label: "নমুনা: মজুদ কম (৩টি বাকি)",
    event: {
      type: "stock.low",
      occurredAt: "2026-10-24T10:05:00.000Z",
      stock: { variantId: "var_sample_1", sku: "SKU-SAMPLE-001", available: 3 },
    },
  },
  {
    label: "নমুনা: bKash পেমেন্ট সফল",
    event: {
      type: "payment.succeeded",
      occurredAt: "2026-10-24T10:20:00.000Z",
      payment: { amountPoisha: 1200000, method: "bkash" },
    },
  },
];

type ApiError = { code?: string; message?: string };

async function apiJson<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data?: T; error?: ApiError }> {
  const res = await fetch(url, init);
  const body = (await res.json().catch(() => null)) as { data?: T; error?: ApiError } | null;
  return { ok: res.ok, status: res.status, data: body?.data, error: body?.error };
}

const SELECT_CLASS = "h-10 w-full rounded-[10px] border border-border bg-card px-3 text-sm outline-none focus:border-brand-500";

interface RuleFormState {
  name: string;
  description: string;
  trigger: string;
  delaySeconds: string;
  enabled: boolean;
  field: ConditionField;
  operator: ConditionOperator;
  value: string;
  actionType: AutomationAction["type"];
  actionParam: string;
}

const EMPTY_FORM: RuleFormState = {
  name: "",
  description: "",
  trigger: "order.created",
  delaySeconds: "0",
  enabled: true,
  field: "totalPoisha",
  operator: "gte",
  value: "",
  actionType: "confirm_order",
  actionParam: "",
};

function parseConditionValue(form: RuleFormState): ConditionValue | undefined {
  if (form.operator === "exists" || form.operator === "not_exists") return undefined;
  const raw = form.value.trim();
  if (form.operator === "in" || form.operator === "not_in") {
    const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
    return NUMERIC_FIELDS.has(form.field) ? parts.map((p) => Number(p)) : parts;
  }
  if (NUMERIC_FIELDS.has(form.field)) return Number(raw);
  return raw;
}

export function AutomationClient() {
  const [state, setState] = useState<"loading" | "locked" | "unauthenticated" | "error" | "ready">("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [runs, setRuns] = useState<AutomationRunLog[]>([]);

  const [form, setForm] = useState<RuleFormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingComplex, setEditingComplex] = useState(false);
  const [formStatus, setFormStatus] = useState<string | null>(null);
  const [formBusy, setFormBusy] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);

  const [dryRuleId, setDryRuleId] = useState<string>("");
  const [dryEventIdx, setDryEventIdx] = useState(0);
  const [dryResult, setDryResult] = useState<AutomationRunLog | null>(null);
  const [dryStatus, setDryStatus] = useState<string | null>(null);
  const [dryBusy, setDryBusy] = useState(false);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const [rulesRes, runsRes] = await Promise.all([
        apiJson<{ rules: AutomationRule[] }>("/api/v1/admin/automation"),
        apiJson<{ runs: AutomationRunLog[] }>("/api/v1/admin/automation/runs"),
      ]);
      const first = !rulesRes.ok ? rulesRes : !runsRes.ok ? runsRes : null;
      if (first) {
        if (first.error?.code === "FEATURE_LOCKED") return setState("locked");
        if (first.status === 401) return setState("unauthenticated");
        setErrorMessage(first.error?.message ?? `সার্ভার ত্রুটি (${first.status})`);
        return setState("error");
      }
      setRules(rulesRes.data?.rules ?? []);
      setRuns(runsRes.data?.runs ?? []);
      setState("ready");
    } catch {
      setErrorMessage("নেটওয়ার্ক ত্রুটি — সার্ভারে পৌঁছানো যায়নি।");
      setState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!dryRuleId && rules.length > 0) setDryRuleId(rules[0]?.id ?? "");
  }, [rules, dryRuleId]);

  async function toggleRule(rule: AutomationRule) {
    setRowBusyId(rule.id);
    try {
      const res = await apiJson<{ rule: AutomationRule }>(`/api/v1/admin/automation/${rule.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: !rule.enabled }),
      });
      if (res.ok && res.data?.rule) {
        setRules((prev) => prev.map((r) => (r.id === rule.id ? res.data!.rule : r)));
      } else {
        setFormStatus(`টগল ব্যর্থ: ${res.error?.message ?? `HTTP ${res.status}`}`);
      }
    } catch {
      setFormStatus("টগল ব্যর্থ: নেটওয়ার্ক ত্রুটি।");
    } finally {
      setRowBusyId(null);
    }
  }

  async function deleteRule(rule: AutomationRule) {
    setRowBusyId(rule.id);
    try {
      const res = await apiJson<{ deleted: boolean }>(`/api/v1/admin/automation/${rule.id}`, { method: "DELETE" });
      if (res.ok) {
        setRules((prev) => prev.filter((r) => r.id !== rule.id));
        setConfirmDeleteId(null);
        if (editingId === rule.id) {
          setEditingId(null);
          setForm(EMPTY_FORM);
        }
      } else {
        setFormStatus(`মুছতে ব্যর্থ: ${res.error?.message ?? `HTTP ${res.status}`}`);
      }
    } catch {
      setFormStatus("মুছতে ব্যর্থ: নেটওয়ার্ক ত্রুটি।");
    } finally {
      setRowBusyId(null);
    }
  }

  function startEdit(rule: AutomationRule) {
    const simpleCondition = rule.conditions.kind === "condition" ? rule.conditions : null;
    const simpleAction = rule.actions.length === 1 ? rule.actions[0] : undefined;
    setEditingComplex(!simpleCondition || !simpleAction);
    setForm({
      name: rule.name,
      description: rule.description ?? "",
      trigger: rule.trigger,
      delaySeconds: String(rule.delaySeconds),
      enabled: rule.enabled,
      field: simpleCondition?.field ?? "totalPoisha",
      operator: simpleCondition?.operator ?? "gte",
      value: simpleCondition ? valueText(simpleCondition.field, simpleCondition.value) : "",
      actionType: simpleAction?.type ?? "confirm_order",
      actionParam: simpleAction ? actionParam(simpleAction) : "",
    });
    setEditingId(rule.id);
    setFormStatus(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditingComplex(false);
    setForm(EMPTY_FORM);
    setFormStatus(null);
  }

  async function submitForm(e: React.FormEvent) {
    e.preventDefault();
    setFormBusy(true);
    setFormStatus(null);
    const delay = Number.parseInt(form.delaySeconds, 10);
    const base = {
      name: form.name.trim(),
      description: form.description.trim() === "" ? undefined : form.description.trim(),
      trigger: form.trigger,
      delaySeconds: Number.isFinite(delay) ? delay : 0,
      enabled: form.enabled,
    };
    try {
      if (editingId) {
        // Complex rules (condition groups / multiple actions) keep their
        // stored conditions+actions — the form only edits the simple
        // fields for them, and says so above the form.
        const body: Record<string, unknown> = { ...base };
        if (!editingComplex) {
          body.conditions = { kind: "condition", field: form.field, operator: form.operator, value: parseConditionValue(form) };
          if (parseConditionValue(form) === undefined && form.operator !== "exists" && form.operator !== "not_exists") {
            delete (body.conditions as { value?: unknown }).value;
          }
          body.actions = [buildAction(form.actionType, form.actionParam.trim())];
        }
        const res = await apiJson<{ rule: AutomationRule }>(`/api/v1/admin/automation/${editingId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.ok && res.data?.rule) {
          setRules((prev) => prev.map((r) => (r.id === editingId ? res.data!.rule : r)));
          setFormStatus(`সংরক্ষিত হয়েছে: ${res.data.rule.name} (ডাটাবেসে)`);
          cancelEdit();
        } else {
          setFormStatus(`সংরক্ষণ ব্যর্থ: ${res.error?.message ?? `HTTP ${res.status}`} — কিছুই বদলায়নি।`);
        }
      } else {
        const condition: Condition = { kind: "condition", field: form.field, operator: form.operator };
        const value = parseConditionValue(form);
        if (value !== undefined) condition.value = value;
        const res = await apiJson<{ rule: AutomationRule }>("/api/v1/admin/automation", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...base, conditions: condition, actions: [buildAction(form.actionType, form.actionParam.trim())] }),
        });
        if (res.ok && res.data?.rule) {
          setRules((prev) => [...prev, res.data!.rule]);
          setFormStatus(`তৈরি হয়েছে: ${res.data.rule.name} (ডাটাবেসে সংরক্ষিত)`);
          setForm(EMPTY_FORM);
        } else {
          setFormStatus(`তৈরি ব্যর্থ: ${res.error?.message ?? `HTTP ${res.status}`} — কিছুই সংরক্ষিত হয়নি।`);
        }
      }
    } catch {
      setFormStatus("নেটওয়ার্ক ত্রুটি — কিছুই সংরক্ষিত হয়নি।");
    } finally {
      setFormBusy(false);
    }
  }

  async function runDryRun() {
    const sample = SAMPLE_EVENTS[dryEventIdx];
    if (!dryRuleId || !sample) return;
    setDryBusy(true);
    setDryStatus(null);
    setDryResult(null);
    try {
      const res = await apiJson<{ log: AutomationRunLog }>("/api/v1/admin/automation/dry-run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ruleId: dryRuleId, event: sample.event }),
      });
      if (res.ok && res.data?.log) {
        setDryResult(res.data.log);
      } else {
        setDryStatus(`ড্রাই-রান ব্যর্থ: ${res.error?.message ?? `HTTP ${res.status}`}`);
      }
    } catch {
      setDryStatus("ড্রাই-রান ব্যর্থ: নেটওয়ার্ক ত্রুটি।");
    } finally {
      setDryBusy(false);
    }
  }

  if (state === "locked") {
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

  if (state === "unauthenticated") {
    return (
      <main>
        <PageHeader title="অটোমেশন (Automation)" description="নিয়মভিত্তিক অটোমেশন ইঞ্জিন (ধাপ ৪৩, A1)" />
        <p role="status">লগইন প্রয়োজন — ডেটা দেখতে আগে অ্যাডমিন হিসেবে লগইন করুন।</p>
      </main>
    );
  }

  if (state === "loading" || state === "error") {
    return (
      <main>
        <PageHeader title="অটোমেশন (Automation)" description="নিয়মভিত্তিক অটোমেশন ইঞ্জিন (ধাপ ৪৩, A1)" breadcrumb="Admin / Automation" />
        {state === "loading" ? (
          <p role="status" className="text-sm text-text-muted">নিয়ম ও রান লগ লোড হচ্ছে…</p>
        ) : (
          <div>
            <p role="alert" className="text-sm text-rose-500">⚠ ডেটা লোড হয়নি: {errorMessage}</p>
            <Button type="button" className="mt-3" onClick={() => void load()}>আবার চেষ্টা করুন</Button>
          </div>
        )}
      </main>
    );
  }

  const matchedRuns = runs.filter((r) => r.matched);
  const runRows = runs.map((run) => ({
    rule: <span className="font-medium">{run.ruleName}</span>,
    trigger: TRIGGER_TEXT[run.trigger] ?? run.trigger,
    status: (
      <Badge tone={run.status === "scheduled" ? "warning" : run.matched ? "success" : "neutral"}>
        {run.status === "scheduled" ? "◷ সময়সূচি" : run.matched ? "✓ মিলেছে" : "মিলেনি"}
        {run.dryRun ? " (ড্রাই-রান)" : ""}
      </Badge>
    ),
    order: run.orderId ? <span className="font-mono">{run.orderId}</span> : "—",
    customer: run.customerPhoneMasked ? <span className="font-mono tabular-nums">{run.customerPhoneMasked}</span> : "—",
    effects: run.effects.length > 0 ? run.effects.map((e) => e.description).join(" · ") : "—",
    at: <span className="font-mono text-xs">{run.evaluatedAt}</span>,
  }));

  return (
    <main>
      <PageHeader
        title="অটোমেশন (Automation)"
        description="নিয়ম, ড্রাই-রান ও রান লগ — সব ডাটাবেস থেকে (Automation API)। ড্রাই-রানে কিছুই প্রয়োগ বা সংরক্ষণ হয় না।"
        breadcrumb="Admin / Automation"
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="মোট নিয়ম" value={String(rules.length)} delta="ডাটাবেসে সংরক্ষিত" icon="⚙" />
        <StatCard label="সক্রিয় নিয়ম" value={String(rules.filter((r) => r.enabled).length)} delta="চালু আছে" icon="✓" />
        <StatCard label="রান লগ" value={String(runs.length)} delta="সংরক্ষিত লগ" icon="↻" />
        <StatCard label="মিল পাওয়া রান" value={String(matchedRuns.length)} delta={`${runs.length}টি লগের মধ্যে`} icon="▸" />
      </div>

      <h2 className="mb-3 text-lg font-semibold">নিয়মের তালিকা</h2>
      {rules.length === 0 ? (
        <EmptyState title="কোনো নিয়ম নেই" description="ডাটাবেসে এখনো কোনো অটোমেশন নিয়ম তৈরি হয়নি — নিচের ফর্ম দিয়ে প্রথম নিয়মটি তৈরি করুন।" />
      ) : (
        <div className="space-y-3">
          {rules.map((rule) => (
            <article key={rule.id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold">{rule.name}</h3>
                  {rule.description ? <p className="mt-0.5 text-sm text-text-muted">{rule.description}</p> : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={rule.enabled ? "success" : "neutral"}>{rule.enabled ? "✓ সক্রিয়" : "✕ বন্ধ"}</Badge>
                  <Button type="button" size="sm" variant={rule.enabled ? "outline" : "secondary"} loading={rowBusyId === rule.id} onClick={() => void toggleRule(rule)}>
                    {rule.enabled ? "বন্ধ করুন" : "চালু করুন"}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => startEdit(rule)}>সম্পাদনা</Button>
                  {confirmDeleteId === rule.id ? (
                    <>
                      <Button type="button" size="sm" variant="destructive" loading={rowBusyId === rule.id} onClick={() => void deleteRule(rule)}>নিশ্চিত মুছুন</Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmDeleteId(null)}>বাতিল</Button>
                    </>
                  ) : (
                    <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmDeleteId(rule.id)}>মুছুন</Button>
                  )}
                </div>
              </div>
              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-medium text-text-muted">ট্রিগার</dt>
                  <dd>{TRIGGER_TEXT[rule.trigger] ?? rule.trigger}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-text-muted">বিলম্ব</dt>
                  <dd>{rule.delaySeconds === 0 ? "সাথে সাথে" : `${rule.delaySeconds} সেকেন্ড পরে (সময়সূচি অনুযায়ী)`}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium text-text-muted">শর্ত</dt>
                  <dd>{describeConditions(rule.conditions)}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium text-text-muted">কাজ</dt>
                  <dd>{rule.actions.map(describeAction).join(" · ")}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      )}

      <h2 className="mb-3 mt-8 text-lg font-semibold">{editingId ? "নিয়ম সম্পাদনা" : "নতুন নিয়ম তৈরি"}</h2>
      <Card>
        {editingComplex ? (
          <p className="mb-3 text-xs text-text-muted">
            এই নিয়মে শর্ত-গ্রুপ বা একাধিক কাজ আছে — ফর্ম দিয়ে শুধু নাম, বিবরণ, ট্রিগার, বিলম্ব ও অবস্থা বদলানো যাবে;
            শর্ত ও কাজ আগের মতোই ডাটাবেসে থাকবে।
          </p>
        ) : null}
        <form onSubmit={(e) => void submitForm(e)} className="grid gap-3 sm:grid-cols-2">
          <Input label="নিয়মের নাম" name="rule-name" required minLength={3} maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <div>
            <span className="mb-1 block text-xs font-medium text-text-muted">ট্রিগার *</span>
            <select className={SELECT_CLASS} value={form.trigger} onChange={(e) => setForm({ ...form, trigger: e.target.value })}>
              {AUTOMATION_TRIGGERS.map((t) => (
                <option key={t} value={t}>{TRIGGER_TEXT[t] ?? t}</option>
              ))}
            </select>
          </div>
          <Input label="বিবরণ (ঐচ্ছিক)" name="rule-description" maxLength={500} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <Input label="বিলম্ব (সেকেন্ড)" name="rule-delay" type="number" min={0} max={604800} value={form.delaySeconds} onChange={(e) => setForm({ ...form, delaySeconds: e.target.value })} />
          <div>
            <span className="mb-1 block text-xs font-medium text-text-muted">শর্তের ক্ষেত্র</span>
            <select className={SELECT_CLASS} disabled={editingComplex} value={form.field} onChange={(e) => setForm({ ...form, field: e.target.value as ConditionField })}>
              {CONDITION_FIELDS.map((f) => (
                <option key={f} value={f}>{FIELD_TEXT[f]}</option>
              ))}
            </select>
          </div>
          <div>
            <span className="mb-1 block text-xs font-medium text-text-muted">অপারেটর</span>
            <select className={SELECT_CLASS} disabled={editingComplex} value={form.operator} onChange={(e) => setForm({ ...form, operator: e.target.value as ConditionOperator })}>
              {CONDITION_OPERATORS.map((o) => (
                <option key={o} value={o}>{OPERATOR_TEXT[o] ?? o}</option>
              ))}
            </select>
          </div>
          <Input
            label="শর্তের মান"
            name="rule-value"
            helper={form.operator === "in" || form.operator === "not_in" ? "কমা দিয়ে আলাদা করুন" : form.operator === "exists" || form.operator === "not_exists" ? "এই অপারেটরে মান লাগে না" : NUMERIC_FIELDS.has(form.field) ? "সংখ্যা (টাকার ক্ষেত্রে পয়সা)" : undefined}
            disabled={editingComplex || form.operator === "exists" || form.operator === "not_exists"}
            value={form.value}
            onChange={(e) => setForm({ ...form, value: e.target.value })}
          />
          <div>
            <span className="mb-1 block text-xs font-medium text-text-muted">কাজ</span>
            <select className={SELECT_CLASS} disabled={editingComplex} value={form.actionType} onChange={(e) => setForm({ ...form, actionType: e.target.value as AutomationAction["type"] })}>
              {(Object.keys(ACTION_TYPE_TEXT) as AutomationAction["type"][]).map((t) => (
                <option key={t} value={t}>{ACTION_TYPE_TEXT[t]}</option>
              ))}
            </select>
          </div>
          {ACTION_PARAM_LABEL[form.actionType] ? (
            <Input label={ACTION_PARAM_LABEL[form.actionType] ?? ""} name="rule-action-param" disabled={editingComplex} value={form.actionParam} onChange={(e) => setForm({ ...form, actionParam: e.target.value })} />
          ) : null}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
            নিয়মটি সক্রিয় থাকবে
          </label>
          <div className="flex items-center gap-2">
            <Button type="submit" loading={formBusy}>{editingId ? "সংরক্ষণ করুন" : "নিয়ম তৈরি করুন"}</Button>
            {editingId ? (
              <Button type="button" variant="ghost" onClick={cancelEdit}>বাতিল</Button>
            ) : null}
          </div>
        </form>
        {formStatus ? <p role="status" className="mt-3 text-sm">{formStatus}</p> : null}
      </Card>

      <h2 className="mb-3 mt-8 text-lg font-semibold">ড্রাই-রান টেস্টার (নমুনা ইভেন্ট)</h2>
      <Card>
        <p className="mb-3 text-xs text-text-muted">
          নমুনা ইভেন্টগুলো শুধু টেস্টের ইনপুট ফিক্সচার — এগুলো সংরক্ষিত ডেটা নয়। ড্রাই-রান আসল API দিয়ে চালানো হয়:
          শর্ত যাচাই হয়, কিন্তু কোনো কাজ প্রয়োগ হয় না এবং রান লগ সংরক্ষণ হয় না।
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <span className="mb-1 block text-xs font-medium text-text-muted">নিয়ম</span>
            <select className={SELECT_CLASS} value={dryRuleId} onChange={(e) => setDryRuleId(e.target.value)}>
              {rules.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
          <div>
            <span className="mb-1 block text-xs font-medium text-text-muted">নমুনা ইভেন্ট</span>
            <select className={SELECT_CLASS} value={dryEventIdx} onChange={(e) => setDryEventIdx(Number(e.target.value))}>
              {SAMPLE_EVENTS.map((s, i) => (
                <option key={s.label} value={i}>{s.label}</option>
              ))}
            </select>
          </div>
        </div>
        <Button type="button" className="mt-3" loading={dryBusy} disabled={rules.length === 0} onClick={() => void runDryRun()}>
          ড্রাই-রান চালান
        </Button>
        {dryStatus ? <p role="status" className="mt-3 text-sm">{dryStatus}</p> : null}
        {dryResult ? (
          <div className="mt-4">
            <p className="text-sm">
              নিয়ম: <span className="font-medium">{dryResult.ruleName}</span> — ফলাফল:{" "}
              <Badge tone={dryResult.matched ? "success" : "neutral"}>{dryResult.matched ? "✓ মিলেছে" : "মিলেনি"}</Badge>
            </p>
            <div className="mt-4">
              <DataTable
                caption="শর্ত যাচাই (trace) — API-র উত্তর"
                columns={[
                  { key: "field", header: "ক্ষেত্র" },
                  { key: "operator", header: "অপারেটর" },
                  { key: "expected", header: "প্রত্যাশিত" },
                  { key: "actual", header: "প্রকৃত" },
                  { key: "result", header: "ফলাফল" },
                ]}
                rows={dryResult.trace.map((t) => ({
                  field: FIELD_TEXT[t.field],
                  operator: OPERATOR_TEXT[t.operator] ?? t.operator,
                  expected: t.expected === undefined ? "—" : valueText(t.field, t.expected),
                  actual: t.actual === undefined ? "—" : valueText(t.field, t.actual),
                  result: <Badge tone={t.matched ? "success" : "danger"}>{t.matched ? "✓ মিলেছে" : "✕ মিলেনি"}</Badge>,
                }))}
              />
            </div>
            {dryResult.effects.length > 0 ? (
              <ul className="mt-4 list-disc space-y-1 pl-5 text-sm">
                {dryResult.effects.map((e, i) => (
                  <li key={i}>
                    <Badge tone="info">পরিকল্পিত</Badge> {e.description}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </Card>

      <h2 className="mb-3 mt-8 flex items-center gap-3 text-lg font-semibold">
        রান লগ
        <Button type="button" size="sm" variant="outline" onClick={() => void load()}>রিফ্রেশ</Button>
      </h2>
      {runs.length === 0 ? (
        <EmptyState title="কোনো রান লগ নেই" description="এখনো কোনো ইভেন্ট রান সংরক্ষণ হয়নি। ইভেন্ট ডিসপ্যাচ (POST /runs) হলে লগ এখানে ডাটাবেস থেকে দেখা যাবে।" />
      ) : (
        <DataTable
          caption="ডাটাবেসে সংরক্ষিত রান লগ — ফোন সবসময় মাস্ক করা। ইফেক্ট worker (automation-run) দিয়ে কার্যকর হয় — API meta: execution automation-run-worker।"
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
      )}
    </main>
  );
}
