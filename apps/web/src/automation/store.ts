/**
 * Automation store — Agent 13. Persistence behind an explicit interface.
 * The default is an in-memory store (non-persistent, always labelled as such
 * by the API routes in meta). A Prisma-backed store must implement the same
 * interface against the AutomationRule / AutomationRunLog tables — that swap
 * is PENDING the DB-owner schema proposal + Prisma generate. Rules and run
 * logs are copied in and out so callers cannot mutate store state directly.
 */
import type { AutomationRule, AutomationRunLog } from "./types";

export interface AutomationStore {
  listRules(): AutomationRule[];
  getRule(id: string): AutomationRule | undefined;
  createRule(rule: AutomationRule): AutomationRule;
  updateRule(id: string, patch: Partial<AutomationRule>): AutomationRule | undefined;
  deleteRule(id: string): boolean;
  appendRun(run: AutomationRunLog): void;
  listRuns(ruleId?: string): AutomationRunLog[];
}

export class InMemoryAutomationStore implements AutomationStore {
  private rules = new Map<string, AutomationRule>();
  private runs: AutomationRunLog[] = [];

  constructor(seedRules: AutomationRule[] = []) {
    for (const rule of seedRules) this.rules.set(rule.id, cloneRule(rule));
  }

  listRules(): AutomationRule[] {
    return [...this.rules.values()].map(cloneRule);
  }

  getRule(id: string): AutomationRule | undefined {
    const rule = this.rules.get(id);
    return rule ? cloneRule(rule) : undefined;
  }

  createRule(rule: AutomationRule): AutomationRule {
    this.rules.set(rule.id, cloneRule(rule));
    return cloneRule(rule);
  }

  updateRule(id: string, patch: Partial<AutomationRule>): AutomationRule | undefined {
    const current = this.rules.get(id);
    if (!current) return undefined;
    const next: AutomationRule = { ...current, ...patch, id: current.id };
    this.rules.set(id, cloneRule(next));
    return cloneRule(next);
  }

  deleteRule(id: string): boolean {
    return this.rules.delete(id);
  }

  appendRun(run: AutomationRunLog): void {
    this.runs.push({ ...run, trace: [...run.trace], effects: [...run.effects] });
  }

  listRuns(ruleId?: string): AutomationRunLog[] {
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

/** Shared demo store used by the automation API routes. Seeded empty: example rules live in examples.ts and are not auto-installed. */
export const demoAutomationStore: AutomationStore = new InMemoryAutomationStore();
