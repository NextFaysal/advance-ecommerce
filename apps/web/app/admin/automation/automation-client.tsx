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
import { DataTable, DataTableSkeleton } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { formatPoisha } from "@/components/ui/money";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, type Locale } from "@/i18n/locale";
import {
  ACTION_PARAM_LABEL,
  ACTION_TYPE_TEXT,
  AUTOMATION_STRINGS,
  FIELD_TEXT,
  OPERATOR_TEXT,
  TRIGGER_TEXT,
  type AutomationStrings,
} from "./strings";
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

function describeConditions(node: ConditionNode, t: AutomationStrings, locale: Locale): string {
  if (node.kind === "condition") {
    const v = valueText(node.field, node.value);
    return `${FIELD_TEXT[locale][node.field]} ${OPERATOR_TEXT[locale][node.operator] ?? node.operator}${v ? ` ${v}` : ""}`;
  }
  const joined = node.nodes.map((n) => describeConditions(n, t, locale)).join(node.logic === "AND" ? t.condAnd : t.condOr);
  return `(${joined})`;
}

function describeAction(action: AutomationAction, t: AutomationStrings): string {
  switch (action.type) {
    case "confirm_order":
      return t.actConfirmOrder;
    case "assign_courier":
      return interpolate(t.actAssignCourier, { courier: action.courier });
    case "send_sms":
      return interpolate(t.actSendSms, { key: action.templateKey });
    case "send_email":
      return interpolate(t.actSendEmail, { key: action.templateKey });
    case "add_tag":
      return interpolate(t.actAddTag, { tag: action.tag });
    case "remove_tag":
      return interpolate(t.actRemoveTag, { tag: action.tag });
    case "notify_staff":
      return interpolate(t.actNotifyStaff, { message: action.message });
  }
}

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

/** Sample events — INPUT FIXTURES for the dry-run tester only (fixed times, deterministic). Labels live in strings.ts (sample1…sample4, same order). */
const SAMPLE_EVENTS: AutomationEvent[] = [
  {
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
  {
    type: "checkout.abandoned",
    occurredAt: "2026-10-24T09:40:00.000Z",
    checkout: { id: "chk_sample_1", totalPoisha: 75000, abandonedMinutes: 45 },
  },
  {
    type: "stock.low",
    occurredAt: "2026-10-24T10:05:00.000Z",
    stock: { variantId: "var_sample_1", sku: "SKU-SAMPLE-001", available: 3 },
  },
  {
    type: "payment.succeeded",
    occurredAt: "2026-10-24T10:20:00.000Z",
    payment: { amountPoisha: 1200000, method: "bkash" },
  },
];

type ApiError = { code?: string; message?: string };

async function apiJson<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data?: T; error?: ApiError }> {
  const res = await fetch(url, init);
  const body = (await res.json().catch(() => null)) as { data?: T; error?: ApiError } | null;
  return { ok: res.ok, status: res.status, data: body?.data, error: body?.error };
}

const SELECT_CLASS = "h-11 w-full rounded-xl border border-border bg-card px-3 text-sm shadow-xs outline-none transition focus:border-brand-500";

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
  const { locale } = useLocale();
  const t = AUTOMATION_STRINGS[locale];
  const sampleLabels = [t.sample1, t.sample2, t.sample3, t.sample4];
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
        setErrorMessage(first.error?.message ?? interpolate(t.serverError, { status: first.status }));
        return setState("error");
      }
      setRules(rulesRes.data?.rules ?? []);
      setRuns(runsRes.data?.runs ?? []);
      setState("ready");
    } catch {
      setErrorMessage(t.networkError);
      setState("error");
    }
  }, [t]);

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
        setFormStatus(interpolate(t.toggleFailed, { message: res.error?.message ?? `HTTP ${res.status}` }));
      }
    } catch {
      setFormStatus(t.toggleNetwork);
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
        setFormStatus(interpolate(t.deleteFailed, { message: res.error?.message ?? `HTTP ${res.status}` }));
      }
    } catch {
      setFormStatus(t.deleteNetwork);
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
          setFormStatus(interpolate(t.savedEdit, { name: res.data.rule.name }));
          cancelEdit();
        } else {
          setFormStatus(interpolate(t.saveFailed, { message: res.error?.message ?? `HTTP ${res.status}` }));
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
          setFormStatus(interpolate(t.created, { name: res.data.rule.name }));
          setForm(EMPTY_FORM);
        } else {
          setFormStatus(interpolate(t.createFailed, { message: res.error?.message ?? `HTTP ${res.status}` }));
        }
      }
    } catch {
      setFormStatus(t.formNetwork);
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
        body: JSON.stringify({ ruleId: dryRuleId, event: sample }),
      });
      if (res.ok && res.data?.log) {
        setDryResult(res.data.log);
      } else {
        setDryStatus(interpolate(t.dryFailed, { message: res.error?.message ?? `HTTP ${res.status}` }));
      }
    } catch {
      setDryStatus(t.dryNetwork);
    } finally {
      setDryBusy(false);
    }
  }

  if (state === "locked") {
    return (
      <main>
        <PageHeader title={t.title} description={t.descShort} />
        <p role="status">
          {t.lockedA}
          <code>module.automation</code>
          {t.lockedB}
        </p>
      </main>
    );
  }

  if (state === "unauthenticated") {
    return (
      <main>
        <PageHeader title={t.title} description={t.descShort} />
        <p role="status">{t.loginRequired}</p>
      </main>
    );
  }

  if (state === "loading" || state === "error") {
    return (
      <main>
        <PageHeader title={t.title} description={t.descShort} breadcrumb={t.breadcrumb} />
        {state === "loading" ? (
          <div className="space-y-3">
            <p role="status" className="text-sm text-text-muted">{t.loading}</p>
            <DataTableSkeleton columns={5} rows={5} />
          </div>
        ) : (
          <div>
            <p role="alert" className="text-sm text-danger">{interpolate(t.loadFailed, { message: errorMessage })}</p>
            <Button type="button" className="mt-3" onClick={() => void load()}>{t.retry}</Button>
          </div>
        )}
      </main>
    );
  }

  const matchedRuns = runs.filter((r) => r.matched);
  const runRows = runs.map((run) => ({
    rule: <span className="font-medium">{run.ruleName}</span>,
    trigger: TRIGGER_TEXT[locale][run.trigger] ?? run.trigger,
    status: (
      <Badge tone={run.status === "scheduled" ? "warning" : run.matched ? "success" : "neutral"}>
        {run.status === "scheduled" ? t.statusScheduled : run.matched ? t.statusMatched : t.statusNotMatched}
        {run.dryRun ? t.dryRunSuffix : ""}
      </Badge>
    ),
    order: run.orderId ? <span className="font-mono">{run.orderId}</span> : "—",
    customer: run.customerPhoneMasked ? <span className="tnum font-mono tabular-nums">{run.customerPhoneMasked}</span> : "—",
    effects: run.effects.length > 0 ? run.effects.map((e) => e.description).join(" · ") : "—",
    at: <span className="tnum font-mono text-xs">{run.evaluatedAt}</span>,
  }));

  return (
    <main className="space-y-6">
      <PageHeader title={t.title} description={t.descLong} breadcrumb={t.breadcrumb} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={t.statTotalRules} value={String(rules.length)} delta={t.statTotalRulesDelta} icon="⚙" />
        <StatCard label={t.statActive} value={String(rules.filter((r) => r.enabled).length)} delta={t.statActiveDelta} icon="✓" />
        <StatCard label={t.statRuns} value={String(runs.length)} delta={t.statRunsDelta} icon="↻" />
        <StatCard label={t.statMatched} value={String(matchedRuns.length)} delta={interpolate(t.statMatchedDelta, { count: runs.length })} icon="▸" />
      </div>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold text-text-main">{t.rulesTitle}</h2>
      {rules.length === 0 ? (
        <EmptyState title={t.noRulesTitle} description={t.noRulesDesc} />
      ) : (
        <div className="space-y-3">
          {rules.map((rule) => (
            <article key={rule.id} className="rounded-2xl border border-border/60 bg-card p-5 shadow-xs">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-display text-sm font-semibold text-text-main">{rule.name}</h3>
                  {rule.description ? <p className="mt-0.5 text-sm text-text-muted">{rule.description}</p> : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={rule.enabled ? "success" : "neutral"}>{rule.enabled ? t.badgeActive : t.badgeOff}</Badge>
                  <Button type="button" size="sm" variant={rule.enabled ? "outline" : "secondary"} loading={rowBusyId === rule.id} onClick={() => void toggleRule(rule)}>
                    {rule.enabled ? t.disable : t.enable}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => startEdit(rule)}>{t.edit}</Button>
                  {confirmDeleteId === rule.id ? (
                    <>
                      <Button type="button" size="sm" variant="destructive" loading={rowBusyId === rule.id} onClick={() => void deleteRule(rule)}>{t.confirmDelete}</Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmDeleteId(null)}>{t.cancel}</Button>
                    </>
                  ) : (
                    <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmDeleteId(rule.id)}>{t.delete}</Button>
                  )}
                </div>
              </div>
              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-medium text-text-muted">{t.dtTrigger}</dt>
                  <dd>{TRIGGER_TEXT[locale][rule.trigger] ?? rule.trigger}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-text-muted">{t.dtDelay}</dt>
                  <dd>{rule.delaySeconds === 0 ? t.delayNow : interpolate(t.delayLater, { seconds: rule.delaySeconds })}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium text-text-muted">{t.dtConditions}</dt>
                  <dd>{describeConditions(rule.conditions, t, locale)}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium text-text-muted">{t.dtActions}</dt>
                  <dd>{rule.actions.map((a) => describeAction(a, t)).join(" · ")}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      )}

      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold text-text-main">{editingId ? t.formTitleEdit : t.formTitleNew}</h2>
        <Card>
        {editingComplex ? <p className="mb-3 text-xs text-text-muted">{t.complexNote}</p> : null}
        <form onSubmit={(e) => void submitForm(e)} className="grid gap-3 sm:grid-cols-2">
          <Input label={t.fName} name="rule-name" required minLength={3} maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <div>
            <span className="mb-1 block text-xs font-medium text-text-muted">{t.fTrigger}</span>
            <select className={SELECT_CLASS} value={form.trigger} onChange={(e) => setForm({ ...form, trigger: e.target.value })}>
              {AUTOMATION_TRIGGERS.map((tr) => (
                <option key={tr} value={tr}>{TRIGGER_TEXT[locale][tr] ?? tr}</option>
              ))}
            </select>
          </div>
          <Input label={t.fDescription} name="rule-description" maxLength={500} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <Input label={t.fDelay} name="rule-delay" type="number" min={0} max={604800} value={form.delaySeconds} onChange={(e) => setForm({ ...form, delaySeconds: e.target.value })} />
          <div>
            <span className="mb-1 block text-xs font-medium text-text-muted">{t.fField}</span>
            <select className={SELECT_CLASS} disabled={editingComplex} value={form.field} onChange={(e) => setForm({ ...form, field: e.target.value as ConditionField })}>
              {CONDITION_FIELDS.map((f) => (
                <option key={f} value={f}>{FIELD_TEXT[locale][f]}</option>
              ))}
            </select>
          </div>
          <div>
            <span className="mb-1 block text-xs font-medium text-text-muted">{t.fOperator}</span>
            <select className={SELECT_CLASS} disabled={editingComplex} value={form.operator} onChange={(e) => setForm({ ...form, operator: e.target.value as ConditionOperator })}>
              {CONDITION_OPERATORS.map((o) => (
                <option key={o} value={o}>{OPERATOR_TEXT[locale][o] ?? o}</option>
              ))}
            </select>
          </div>
          <Input
            label={t.fValue}
            name="rule-value"
            helper={form.operator === "in" || form.operator === "not_in" ? t.helperComma : form.operator === "exists" || form.operator === "not_exists" ? t.helperNoValue : NUMERIC_FIELDS.has(form.field) ? t.helperNumber : undefined}
            disabled={editingComplex || form.operator === "exists" || form.operator === "not_exists"}
            value={form.value}
            onChange={(e) => setForm({ ...form, value: e.target.value })}
          />
          <div>
            <span className="mb-1 block text-xs font-medium text-text-muted">{t.fAction}</span>
            <select className={SELECT_CLASS} disabled={editingComplex} value={form.actionType} onChange={(e) => setForm({ ...form, actionType: e.target.value as AutomationAction["type"] })}>
              {(Object.keys(ACTION_TYPE_TEXT[locale]) as AutomationAction["type"][]).map((ty) => (
                <option key={ty} value={ty}>{ACTION_TYPE_TEXT[locale][ty]}</option>
              ))}
            </select>
          </div>
          {ACTION_PARAM_LABEL[locale][form.actionType] ? (
            <Input label={ACTION_PARAM_LABEL[locale][form.actionType] ?? ""} name="rule-action-param" disabled={editingComplex} value={form.actionParam} onChange={(e) => setForm({ ...form, actionParam: e.target.value })} />
          ) : null}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
            {t.enabledLabel}
          </label>
          <div className="flex items-center gap-2">
            <Button type="submit" loading={formBusy}>{editingId ? t.saveButton : t.createButton}</Button>
            {editingId ? (
              <Button type="button" variant="ghost" onClick={cancelEdit}>{t.cancel}</Button>
            ) : null}
          </div>
        </form>
        {formStatus ? <p role="status" className="mt-3 text-sm">{formStatus}</p> : null}
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold text-text-main">{t.dryTitle}</h2>
        <Card>
        <p className="mb-3 text-xs text-text-muted">{t.dryNote}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <span className="mb-1 block text-xs font-medium text-text-muted">{t.dryRule}</span>
            <select className={SELECT_CLASS} value={dryRuleId} onChange={(e) => setDryRuleId(e.target.value)}>
              {rules.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
          <div>
            <span className="mb-1 block text-xs font-medium text-text-muted">{t.dryEvent}</span>
            <select className={SELECT_CLASS} value={dryEventIdx} onChange={(e) => setDryEventIdx(Number(e.target.value))}>
              {SAMPLE_EVENTS.map((s, i) => (
                <option key={s.type + i} value={i}>{sampleLabels[i]}</option>
              ))}
            </select>
          </div>
        </div>
        <Button type="button" className="mt-3" loading={dryBusy} disabled={rules.length === 0} onClick={() => void runDryRun()}>
          {t.dryRunButton}
        </Button>
        {dryStatus ? <p role="status" className="mt-3 text-sm">{dryStatus}</p> : null}
        {dryResult ? (
          <div className="mt-4">
            <p className="text-sm">
              {t.dryResultRule}: <span className="font-medium">{dryResult.ruleName}</span> — {t.dryResultLabel}:{" "}
              <Badge tone={dryResult.matched ? "success" : "neutral"}>{dryResult.matched ? t.matched : t.notMatched}</Badge>
            </p>
            <div className="mt-4">
              <DataTable
                caption={t.traceCaption}
                columns={[
                  { key: "field", header: t.colField },
                  { key: "operator", header: t.colOperator },
                  { key: "expected", header: t.colExpected },
                  { key: "actual", header: t.colActual },
                  { key: "result", header: t.colResult },
                ]}
                rows={dryResult.trace.map((tr) => ({
                  field: FIELD_TEXT[locale][tr.field],
                  operator: OPERATOR_TEXT[locale][tr.operator] ?? tr.operator,
                  expected: tr.expected === undefined ? "—" : valueText(tr.field, tr.expected),
                  actual: tr.actual === undefined ? "—" : valueText(tr.field, tr.actual),
                  result: <Badge tone={tr.matched ? "success" : "danger"}>{tr.matched ? t.traceMatched : t.traceNotMatched}</Badge>,
                }))}
              />
            </div>
            {dryResult.effects.length > 0 ? (
              <ul className="mt-4 list-disc space-y-1 pl-5 text-sm">
                {dryResult.effects.map((e, i) => (
                  <li key={i}>
                    <Badge tone="info">{t.plannedBadge}</Badge> {e.description}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="flex items-center gap-3 font-display text-lg font-semibold text-text-main">
          {t.runsTitle}
          <Button type="button" size="sm" variant="outline" onClick={() => void load()}>{t.refresh}</Button>
        </h2>
        {runs.length === 0 ? (
          <EmptyState title={t.noRunsTitle} description={t.noRunsDesc} />
        ) : (
          <DataTable
            caption={t.runsCaption}
            columns={[
              { key: "rule", header: t.colRule },
              { key: "trigger", header: t.colTrigger },
              { key: "status", header: t.colStatus },
              { key: "order", header: t.colOrder },
              { key: "customer", header: t.colCustomer },
              { key: "effects", header: t.colEffects },
              { key: "at", header: t.colAt },
            ]}
            rows={runRows}
          />
        )}
      </section>
    </main>
  );
}
