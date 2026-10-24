/**
 * Automation store — Agent 13 interface, DB-backed since 2026-10-24.
 *
 * Persistence lives behind this interface; the runtime store is
 * PrismaAutomationStore over the AutomationRule / AutomationRunLog
 * tables (shared instance: `automationStore`, used by the admin
 * automation API routes). The in-memory implementation stays for tests
 * and fixtures. Rules and run logs are copied in and out so callers
 * cannot mutate store state directly.
 *
 * The interface is async: the previous sync contract was the demo
 * store's shape, and every consumer (API routes) is async already.
 *
 * SCHEMA DRIFT (reported, worked around — schema.prisma NOT changed):
 *  - AutomationRule has NO description / createdBy columns. Both are
 *    accepted on write (the create route builds its response from its
 *    local object, so a POST still echoes them) but are NOT persisted:
 *    a rule read back after any restart has neither field.
 *  - The DB trigger is an enum (ORDER_CREATED, …) while the TS domain
 *    uses dotted event names ("order.created", …) — mapped both ways
 *    below; an unknown DB value reads back as "order.created" rather
 *    than inventing a trigger.
 *  - AutomationRunLog carries only ruleId / eventRef / matched /
 *    status / detailJson / executeAfter. The rest of the TS run log
 *    (ruleName, trigger, dryRun, trace, effects, customerPhoneMasked,
 *    orderId, evaluatedAt) rides inside detailJson verbatim; eventRef
 *    stores the orderId when the event had one, else the trigger name.
 *    Phones inside detailJson are masked by the engine before a run
 *    log ever reaches this store — the store never sees a full phone.
 *  - deleteRule is a SOFT delete (the schema's deletedAt column):
 *    deleted rules vanish from list/get exactly as with the old hard
 *    delete, but the row (and its run logs) remain for audit.
 */
import { prisma } from "@advance-ecommerce/db";
import type {
  AutomationAction,
  AutomationRule,
  AutomationRunLog,
  AutomationTrigger,
  ConditionNode,
} from "./types";

export interface AutomationStore {
  listRules(): Promise<AutomationRule[]>;
  getRule(id: string): Promise<AutomationRule | undefined>;
  createRule(rule: AutomationRule): Promise<AutomationRule>;
  updateRule(id: string, patch: Partial<AutomationRule>): Promise<AutomationRule | undefined>;
  deleteRule(id: string): Promise<boolean>;
  appendRun(run: AutomationRunLog): Promise<void>;
  listRuns(ruleId?: string): Promise<AutomationRunLog[]>;
}

/* ------------------------------------------------------------------ */
/* In-memory implementation (tests / fixtures)                          */
/* ------------------------------------------------------------------ */

export class InMemoryAutomationStore implements AutomationStore {
  private rules = new Map<string, AutomationRule>();
  private runs: AutomationRunLog[] = [];

  constructor(seedRules: AutomationRule[] = []) {
    for (const rule of seedRules) this.rules.set(rule.id, cloneRule(rule));
  }

  async listRules(): Promise<AutomationRule[]> {
    return [...this.rules.values()].map(cloneRule);
  }

  async getRule(id: string): Promise<AutomationRule | undefined> {
    const rule = this.rules.get(id);
    return rule ? cloneRule(rule) : undefined;
  }

  async createRule(rule: AutomationRule): Promise<AutomationRule> {
    this.rules.set(rule.id, cloneRule(rule));
    return cloneRule(rule);
  }

  async updateRule(id: string, patch: Partial<AutomationRule>): Promise<AutomationRule | undefined> {
    const current = this.rules.get(id);
    if (!current) return undefined;
    const next: AutomationRule = { ...current, ...patch, id: current.id };
    this.rules.set(id, cloneRule(next));
    return cloneRule(next);
  }

  async deleteRule(id: string): Promise<boolean> {
    return this.rules.delete(id);
  }

  async appendRun(run: AutomationRunLog): Promise<void> {
    this.runs.push({ ...run, trace: [...run.trace], effects: [...run.effects] });
  }

  async listRuns(ruleId?: string): Promise<AutomationRunLog[]> {
    return this.runs
      .filter((r) => !ruleId || r.ruleId === ruleId)
      .map((r) => ({ ...r, trace: [...r.trace], effects: [...r.effects] }));
  }
}

function cloneRule(rule: AutomationRule): AutomationRule {
  return {
    ...rule,
    conditions: structuredClone(rule.conditions),
    actions: rule.actions.map((a) => ({ ...a })),
  };
}

/* ------------------------------------------------------------------ */
/* Prisma implementation (runtime)                                      */
/* ------------------------------------------------------------------ */

const TRIGGER_TO_DB: Record<AutomationTrigger, string> = {
  "order.created": "ORDER_CREATED",
  "order.status_changed": "ORDER_STATUS_CHANGED",
  "payment.succeeded": "PAYMENT_SUCCEEDED",
  "stock.low": "STOCK_LOW",
  "checkout.abandoned": "CHECKOUT_ABANDONED",
};

const TRIGGER_FROM_DB: Record<string, AutomationTrigger> = {
  ORDER_CREATED: "order.created",
  ORDER_STATUS_CHANGED: "order.status_changed",
  PAYMENT_SUCCEEDED: "payment.succeeded",
  STOCK_LOW: "stock.low",
  CHECKOUT_ABANDONED: "checkout.abandoned",
};

interface AutomationRuleRowShape {
  id: string;
  name: string;
  trigger: string;
  conditionJson: unknown;
  actionJson: unknown;
  delaySeconds: number;
  isEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function ruleRowToRule(row: AutomationRuleRowShape): AutomationRule {
  return {
    id: row.id,
    name: row.name,
    // description / createdBy have no columns — never persisted (header).
    trigger: TRIGGER_FROM_DB[row.trigger] ?? "order.created",
    conditions: row.conditionJson as ConditionNode,
    actions: (row.actionJson as AutomationAction[] | null) ?? [],
    delaySeconds: row.delaySeconds,
    enabled: row.isEnabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

interface AutomationRunDetail {
  ruleName: string;
  trigger: AutomationTrigger;
  dryRun: boolean;
  trace: AutomationRunLog["trace"];
  effects: AutomationRunLog["effects"];
  customerPhoneMasked?: string;
  orderId?: string;
  evaluatedAt: string;
}

interface AutomationRunRowShape {
  id: string;
  ruleId: string;
  matched: boolean;
  status: string;
  detailJson: unknown;
  executeAfter: Date | null;
  createdAt: Date;
}

function runRowToLog(row: AutomationRunRowShape): AutomationRunLog {
  const detail = (row.detailJson ?? null) as AutomationRunDetail | null;
  const log: AutomationRunLog = {
    id: row.id,
    ruleId: row.ruleId,
    ruleName: detail?.ruleName ?? "",
    trigger: detail?.trigger ?? "order.created",
    dryRun: detail?.dryRun ?? false,
    status: row.status as AutomationRunLog["status"],
    matched: row.matched,
    trace: detail?.trace ?? [],
    effects: detail?.effects ?? [],
    evaluatedAt: detail?.evaluatedAt ?? row.createdAt.toISOString(),
  };
  if (detail?.customerPhoneMasked) log.customerPhoneMasked = detail.customerPhoneMasked;
  if (detail?.orderId) log.orderId = detail.orderId;
  if (row.executeAfter) log.executeAfter = row.executeAfter.toISOString();
  return log;
}

export class PrismaAutomationStore implements AutomationStore {
  async listRules(): Promise<AutomationRule[]> {
    const rows = await prisma.automationRule.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(ruleRowToRule);
  }

  async getRule(id: string): Promise<AutomationRule | undefined> {
    const row = await prisma.automationRule.findFirst({ where: { id, deletedAt: null } });
    return row ? ruleRowToRule(row) : undefined;
  }

  async createRule(rule: AutomationRule): Promise<AutomationRule> {
    const row = await prisma.automationRule.create({
      data: {
        id: rule.id,
        name: rule.name,
        trigger: TRIGGER_TO_DB[rule.trigger] as never,
        conditionJson: rule.conditions as never,
        actionJson: rule.actions as never,
        delaySeconds: rule.delaySeconds,
        isEnabled: rule.enabled,
      },
    });
    return ruleRowToRule(row);
  }

  async updateRule(id: string, patch: Partial<AutomationRule>): Promise<AutomationRule | undefined> {
    const current = await prisma.automationRule.findFirst({ where: { id, deletedAt: null } });
    if (!current) return undefined;
    const data: Record<string, unknown> = {};
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.trigger !== undefined) data.trigger = TRIGGER_TO_DB[patch.trigger];
    if (patch.conditions !== undefined) data.conditionJson = patch.conditions;
    if (patch.actions !== undefined) data.actionJson = patch.actions;
    if (patch.delaySeconds !== undefined) data.delaySeconds = patch.delaySeconds;
    if (patch.enabled !== undefined) data.isEnabled = patch.enabled;
    const row = await prisma.automationRule.update({ where: { id }, data: data as never });
    return ruleRowToRule(row);
  }

  async deleteRule(id: string): Promise<boolean> {
    const current = await prisma.automationRule.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!current) return false;
    await prisma.automationRule.update({ where: { id }, data: { deletedAt: new Date() } });
    return true;
  }

  async appendRun(run: AutomationRunLog): Promise<void> {
    const detail: AutomationRunDetail = {
      ruleName: run.ruleName,
      trigger: run.trigger,
      dryRun: run.dryRun,
      trace: run.trace,
      effects: run.effects,
      evaluatedAt: run.evaluatedAt,
      ...(run.customerPhoneMasked ? { customerPhoneMasked: run.customerPhoneMasked } : {}),
      ...(run.orderId ? { orderId: run.orderId } : {}),
    };
    await prisma.automationRunLog.create({
      data: {
        id: run.id,
        ruleId: run.ruleId,
        eventRef: run.orderId ?? run.trigger,
        matched: run.matched,
        status: run.status,
        detailJson: detail as never,
        executeAfter: run.executeAfter ? new Date(run.executeAfter) : null,
      },
    });
  }

  async listRuns(ruleId?: string): Promise<AutomationRunLog[]> {
    const rows = await prisma.automationRunLog.findMany({
      where: ruleId ? { ruleId } : {},
      orderBy: { createdAt: "asc" },
    });
    return rows.map(runRowToLog);
  }
}

/** Shared DB-backed store used by the automation API routes. */
export const automationStore: AutomationStore = new PrismaAutomationStore();
