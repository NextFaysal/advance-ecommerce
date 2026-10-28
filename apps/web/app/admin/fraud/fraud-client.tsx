"use client";

// Admin > Fraud — wired client (UI wiring pass).
// All data comes from the real, DB-backed fraud-rules APIs:
//   GET    /api/v1/admin/fraud-rules         — blacklist/whitelist + bands
//   POST   /api/v1/admin/fraud-rules         — add a list entry
//   DELETE /api/v1/admin/fraud-rules/[id]    — remove a list entry
//   POST   /api/v1/admin/fraud-rules/score   — score an input against the
//                                              CURRENT DB lists (the route
//                                              fills lists from the store)
// The score tester keeps sample INPUT fixtures (labelled as such); every
// score shown is the API's response computed against the real lists —
// nothing is scored locally anymore. List values come back MASKED for
// phone entries (API contract); the full number is never rendered here.
// The module is a paid add-on: 403 FEATURE_LOCKED renders the lock panel.
import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { DataTable, DataTableSkeleton } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import { Phone } from "@/components/ui/phone";
import { RiskBadge } from "@/components/ui/status-badge";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate } from "@/i18n/locale";
import { ACTION_LABEL, FRAUD_STRINGS, SIGNAL_TEXT, type FraudStrings } from "./strings";
import type { FraudAssessment, FraudListEntry, FraudScoreInput, RiskLevel, SuggestedAction } from "@/fraud/types";

const DHAKA = { division: "Dhaka", district: "Dhaka", upazila: "Mirpur" };

/** Sample INPUTS for the score tester — fixtures only, scored by the API against the real DB lists. Labels live in strings.ts (scenario1…scenario4, same order). */
const SCENARIO_INPUTS: Omit<FraudScoreInput, "lists" | "now">[] = [
  {
    phone: "+8801812345678",
    shippingAddress: DHAKA,
    accountAddress: DHAKA,
    paymentMethod: "bkash",
    totalPoisha: 120000,
    itemKeys: ["SKU-DEMO-010"],
    recentOrders: [],
  },
  {
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
  {
    phone: "+8801911223344",
    shippingAddress: DHAKA,
    paymentMethod: "bkash",
    totalPoisha: 250000,
    itemKeys: ["SKU-DEMO-020"],
    recentOrders: [],
  },
  {
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
];

const ACTION_TONE: Record<SuggestedAction, "success" | "warning" | "danger" | "info"> = {
  auto_confirm: "success",
  manual_review: "warning",
  require_advance: "warning",
  block: "danger",
};

const RISK_BADGE_LEVEL: Record<RiskLevel, "LOW" | "MEDIUM" | "HIGH"> = {
  Low: "LOW",
  Medium: "MEDIUM",
  High: "HIGH",
};

type ApiError = { code?: string; message?: string };

async function apiJson<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data?: T; error?: ApiError }> {
  const res = await fetch(url, init);
  const body = (await res.json().catch(() => null)) as { data?: T; error?: ApiError } | null;
  return { ok: res.ok, status: res.status, data: body?.data, error: body?.error };
}

const SELECT_CLASS = "h-11 w-full rounded-xl border border-border bg-card px-3 text-sm shadow-xs outline-none transition focus:border-brand-500";

interface ListsData {
  bands: { low: string; medium: string; high: string };
  blacklist: FraudListEntry[];
  whitelist: FraudListEntry[];
}

export function FraudClient() {
  const { locale } = useLocale();
  const t: FraudStrings = FRAUD_STRINGS[locale];
  const scenarioLabels = [t.scenario1, t.scenario2, t.scenario3, t.scenario4];
  const [state, setState] = useState<"loading" | "locked" | "unauthenticated" | "error" | "ready">("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [lists, setLists] = useState<ListsData>({ bands: { low: "", medium: "", high: "" }, blacklist: [], whitelist: [] });

  const [results, setResults] = useState<Record<number, FraudAssessment>>({});
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [scoreBusy, setScoreBusy] = useState(false);
  const [scoreStatus, setScoreStatus] = useState<string | null>(null);

  const [entryForm, setEntryForm] = useState({ list: "blacklist", kind: "phone", value: "", district: "", reason: "" });
  const [entryStatus, setEntryStatus] = useState<string | null>(null);
  const [entryBusy, setEntryBusy] = useState(false);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const res = await apiJson<ListsData>("/api/v1/admin/fraud-rules");
      if (!res.ok) {
        if (res.error?.code === "FEATURE_LOCKED") return setState("locked");
        if (res.status === 401) return setState("unauthenticated");
        setErrorMessage(res.error?.message ?? interpolate(t.serverError, { status: res.status }));
        return setState("error");
      }
      if (res.data) setLists(res.data);
      setState("ready");
    } catch {
      setErrorMessage(t.networkError);
      setState("error");
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function scoreAll() {
    setScoreBusy(true);
    setScoreStatus(null);
    const next: Record<number, FraudAssessment> = {};
    let failed = 0;
    for (let i = 0; i < SCENARIO_INPUTS.length; i++) {
      try {
        const res = await apiJson<{ assessment: FraudAssessment }>("/api/v1/admin/fraud-rules/score", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(SCENARIO_INPUTS[i]),
        });
        if (res.ok && res.data?.assessment) next[i] = res.data.assessment;
        else failed += 1;
      } catch {
        failed += 1;
      }
    }
    setResults(next);
    const firstIdx = SCENARIO_INPUTS.findIndex((_, i) => next[i]);
    setSelectedIdx(firstIdx >= 0 ? firstIdx : null);
    setScoreStatus(failed === 0 ? t.scoreAllOk : interpolate(t.scoreSomeFailed, { count: failed }));
    setScoreBusy(false);
  }

  async function addEntry(e: React.FormEvent) {
    e.preventDefault();
    setEntryBusy(true);
    setEntryStatus(null);
    try {
      const body: Record<string, unknown> = {
        list: entryForm.list,
        kind: entryForm.kind,
        value: entryForm.value.trim(),
        reason: entryForm.reason.trim(),
      };
      if (entryForm.kind === "address") body.district = entryForm.district.trim();
      const res = await apiJson<{ entry: FraudListEntry; list: string }>("/api/v1/admin/fraud-rules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok && res.data?.entry) {
        const key = res.data.list === "blacklist" ? "blacklist" : "whitelist";
        setLists((prev) => ({ ...prev, [key]: [...prev[key], res.data!.entry] }));
        setEntryStatus(t.entryAdded);
        setEntryForm({ list: "blacklist", kind: "phone", value: "", district: "", reason: "" });
      } else {
        setEntryStatus(interpolate(t.addFailed, { message: res.error?.message ?? `HTTP ${res.status}` }));
      }
    } catch {
      setEntryStatus(t.addNetwork);
    } finally {
      setEntryBusy(false);
    }
  }

  async function removeEntry(entry: FraudListEntry, listName: "blacklist" | "whitelist") {
    setRowBusyId(entry.id);
    try {
      const res = await apiJson<{ deleted: boolean }>(`/api/v1/admin/fraud-rules/${entry.id}`, { method: "DELETE" });
      if (res.ok) {
        setLists((prev) => ({ ...prev, [listName]: prev[listName].filter((e) => e.id !== entry.id) }));
        setConfirmRemoveId(null);
      } else {
        setEntryStatus(interpolate(t.removeFailed, { message: res.error?.message ?? `HTTP ${res.status}` }));
      }
    } catch {
      setEntryStatus(t.removeNetwork);
    } finally {
      setRowBusyId(null);
    }
  }

  const pageTitle = `${t.title}${t.titleSuffix}`;

  if (state === "locked") {
    return (
      <main>
        <PageHeader title={pageTitle} description={t.descShort} />
        <p role="status">
          {t.lockedA}
          <code>module.fraud_scoring</code>
          {t.lockedB}
        </p>
      </main>
    );
  }

  if (state === "unauthenticated") {
    return (
      <main>
        <PageHeader title={pageTitle} description={t.descShort} />
        <p role="status">{t.loginRequired}</p>
      </main>
    );
  }

  if (state === "loading" || state === "error") {
    return (
      <main>
        <PageHeader title={pageTitle} description={t.descShort} breadcrumb={t.breadcrumb} />
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

  const resultList = Object.values(results);
  const highRisk = resultList.filter((r) => r.score >= 70).length;
  const selected = selectedIdx !== null ? results[selectedIdx] : undefined;
  const selectedLabel = selectedIdx !== null ? scenarioLabels[selectedIdx] : null;

  const scenarioRows = SCENARIO_INPUTS.map((input, i) => {
    const assessment = results[i];
    return {
      scenario: (
        <button type="button" className="font-medium underline-offset-2 hover:underline" onClick={() => setSelectedIdx(i)}>
          {scenarioLabels[i]}
        </button>
      ),
      phone: <Phone phone={input.phone} />,
      total: <Money poisha={input.totalPoisha} />,
      score: assessment ? <span className="tnum font-mono font-bold tabular-nums">{assessment.score}</span> : <span className="text-text-muted">—</span>,
      level: assessment ? <RiskBadge level={RISK_BADGE_LEVEL[assessment.level]} /> : <span className="text-text-muted">—</span>,
      action: assessment ? (
        <Badge tone={ACTION_TONE[assessment.suggestedAction]}>{ACTION_LABEL[locale][assessment.suggestedAction]}</Badge>
      ) : (
        <span className="text-text-muted">{t.notScored}</span>
      ),
      otp: assessment ? (
        assessment.requiresOtp ? <Badge tone="danger">{t.otpRequired}</Badge> : <Badge tone="neutral">{t.otpNotRequired}</Badge>
      ) : (
        <span className="text-text-muted">—</span>
      ),
    };
  });

  const signalRows = selected
    ? selected.signals.map((sig) => ({
        signal: SIGNAL_TEXT[locale][sig.key] ?? sig.key,
        points: (
          <span className="tnum font-mono tabular-nums">
            {sig.points > 0 ? `+${sig.points}` : sig.points}
          </span>
        ),
        triggered: sig.triggered ? <Badge tone="warning">{t.triggered}</Badge> : <Badge tone="neutral">{t.notTriggered}</Badge>,
        detail: sig.detail,
      }))
    : [];

  const listRowData = [
    ...lists.blacklist.map((e) => ({ entry: e, listName: "blacklist" as const, label: t.blacklist, tone: "danger" as const })),
    ...lists.whitelist.map((e) => ({ entry: e, listName: "whitelist" as const, label: t.whitelist, tone: "success" as const })),
  ];
  const listRows = listRowData.map(({ entry, listName, label, tone }) => ({
    list: <Badge tone={tone}>{label}</Badge>,
    kind: entry.kind === "phone" ? t.kindPhone : t.kindAddress,
    value: entry.kind === "phone" ? <Phone phone={entry.value} /> : (entry.district ?? entry.value),
    reason: entry.reason,
    added: <span className="font-mono text-xs">{entry.createdAt.slice(0, 10)}</span>,
    remove:
      confirmRemoveId === entry.id ? (
        <span className="flex gap-1">
          <Button type="button" size="sm" variant="destructive" loading={rowBusyId === entry.id} onClick={() => void removeEntry(entry, listName)}>{t.confirmRemove}</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmRemoveId(null)}>{t.cancel}</Button>
        </span>
      ) : (
        <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmRemoveId(entry.id)}>{t.remove}</Button>
      ),
  }));

  return (
    <main className="space-y-6">
      <PageHeader title={pageTitle} description={t.descLong} breadcrumb={t.breadcrumb} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={t.statBlacklist} value={String(lists.blacklist.length)} delta={t.statFromDb} icon="⛔" />
        <StatCard label={t.statWhitelist} value={String(lists.whitelist.length)} delta={t.statFromDb} icon="✓" />
        <StatCard label={t.statScored} value={String(resultList.length)} delta={t.statScoredDelta} icon="🔎" />
        <StatCard label={t.statHighRisk} value={String(highRisk)} delta={highRisk > 0 ? t.statHighRiskAction : t.statHighRiskNone} deltaTone={highRisk > 0 ? "down" : "up"} icon="⚠" />
      </div>

      <Card>
        <h2 className="mb-1 font-display text-base font-semibold text-text-main">{t.bandsTitle}</h2>
        <p className="text-sm text-text-muted">
          {interpolate(t.bandsLine, { low: lists.bands.low, medium: lists.bands.medium, high: lists.bands.high })}
        </p>
      </Card>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold text-text-main">{t.testerTitle}</h2>
        <p className="text-xs text-text-muted">{t.testerNote}</p>
        <div>
          <Button type="button" loading={scoreBusy} onClick={() => void scoreAll()}>{t.scoreAll}</Button>
          {scoreStatus ? <p role="status" className="mt-2 text-sm">{scoreStatus}</p> : null}
        </div>
        <DataTable
          caption={t.scenarioCaption}
          columns={[
            { key: "scenario", header: t.colScenario },
            { key: "phone", header: t.colPhone },
            { key: "total", header: t.colTotal },
            { key: "score", header: t.colScore },
            { key: "level", header: t.colLevel },
            { key: "action", header: t.colAction },
            { key: "otp", header: t.colOtp },
          ]}
          rows={scenarioRows}
        />
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold text-text-main">{t.signalsTitle}{selectedLabel ? ` — ${selectedLabel}` : ""}</h2>
        {selected ? (
        <DataTable
          caption={interpolate(t.signalsCaption, { score: selected.score })}
          columns={[
            { key: "signal", header: t.colSignal },
            { key: "points", header: t.colPoints },
            { key: "triggered", header: t.colStatus },
            { key: "detail", header: t.colDetail },
          ]}
          rows={signalRows}
        />
      ) : (
          <EmptyState title={t.noResultTitle} description={t.noResultDesc} />
        )}
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold text-text-main">{t.listsTitle}</h2>
        {listRows.length === 0 ? (
        <EmptyState title={t.listsEmptyTitle} description={t.listsEmptyDesc} />
      ) : (
        <DataTable
          caption={t.listsCaption}
          columns={[
            { key: "list", header: t.colList },
            { key: "kind", header: t.colKind },
            { key: "value", header: t.colValue },
            { key: "reason", header: t.colReason },
            { key: "added", header: t.colAdded },
            { key: "remove", header: "" },
          ]}
            rows={listRows}
          />
        )}
      </section>

      <section className="space-y-3">
        <h3 className="font-display text-lg font-semibold text-text-main">{t.addTitle}</h3>
        <Card>
        <form onSubmit={(e) => void addEntry(e)} className="grid gap-3 sm:grid-cols-2">
          <div>
            <span className="mb-1 block text-xs font-medium text-text-muted">{t.fList}</span>
            <select className={SELECT_CLASS} value={entryForm.list} onChange={(e) => setEntryForm({ ...entryForm, list: e.target.value })}>
              <option value="blacklist">{t.blacklist}</option>
              <option value="whitelist">{t.whitelist}</option>
            </select>
          </div>
          <div>
            <span className="mb-1 block text-xs font-medium text-text-muted">{t.fKind}</span>
            <select className={SELECT_CLASS} value={entryForm.kind} onChange={(e) => setEntryForm({ ...entryForm, kind: e.target.value })}>
              <option value="phone">{t.kindPhone}</option>
              <option value="address">{t.kindAddress}</option>
            </select>
          </div>
          <Input
            label={entryForm.kind === "phone" ? t.fPhone : t.fAddressValue}
            name="fraud-entry-value"
            required
            helper={entryForm.kind === "phone" ? t.phoneHelper : undefined}
            value={entryForm.value}
            onChange={(e) => setEntryForm({ ...entryForm, value: e.target.value })}
          />
          {entryForm.kind === "address" ? (
            <Input label={t.fDistrict} name="fraud-entry-district" required value={entryForm.district} onChange={(e) => setEntryForm({ ...entryForm, district: e.target.value })} />
          ) : null}
          <Input label={t.fReason} name="fraud-entry-reason" required minLength={3} maxLength={500} value={entryForm.reason} onChange={(e) => setEntryForm({ ...entryForm, reason: e.target.value })} />
          <div className="flex items-end">
            <Button type="submit" loading={entryBusy}>{t.addButton}</Button>
          </div>
        </form>
        {entryStatus ? <p role="status" className="mt-3 text-sm">{entryStatus}</p> : null}
        </Card>
      </section>
    </main>
  );
}
