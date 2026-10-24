"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * Automation rule list with enable/disable toggles — Agent 20.
 * CLIENT STATE ONLY (demo): toggling updates local React state and is lost
 * on reload. Real wiring: PATCH /api/v1/admin/automation/[id] with
 * { enabled } (route exists, Agent 13), backed by the AutomationRule table.
 */
export interface RuleListItem {
  id: string;
  name: string;
  description: string;
  triggerText: string;
  conditionsText: string;
  actionsText: string;
  delayText: string;
  enabled: boolean;
}

export function RuleToggleList({ initialRules }: { initialRules: RuleListItem[] }) {
  const [rules, setRules] = useState<RuleListItem[]>(initialRules);

  function toggle(id: string) {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)));
  }

  return (
    <div className="space-y-3">
      {rules.map((rule) => (
        <article key={rule.id} className="rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">{rule.name}</h3>
              {rule.description ? <p className="mt-0.5 text-sm text-text-muted">{rule.description}</p> : null}
            </div>
            <div className="flex items-center gap-2">
              <Badge tone={rule.enabled ? "success" : "neutral"}>{rule.enabled ? "✓ সক্রিয়" : "✕ বন্ধ"}</Badge>
              <Button type="button" size="sm" variant={rule.enabled ? "outline" : "secondary"} onClick={() => toggle(rule.id)}>
                {rule.enabled ? "বন্ধ করুন" : "চালু করুন"}
              </Button>
            </div>
          </div>
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium text-text-muted">ট্রিগার</dt>
              <dd>{rule.triggerText}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-text-muted">বিলম্ব</dt>
              <dd>{rule.delayText}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs font-medium text-text-muted">শর্ত</dt>
              <dd>{rule.conditionsText}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs font-medium text-text-muted">কাজ</dt>
              <dd>{rule.actionsText}</dd>
            </div>
          </dl>
        </article>
      ))}
      <p className="text-xs text-text-subtle">
        টগল শুধু এই পেজের ডেমো state বদলায় — পেজ রিলোড করলে আগের অবস্থায় ফিরে যাবে। TEMPORARY DEMO.
      </p>
    </div>
  );
}
