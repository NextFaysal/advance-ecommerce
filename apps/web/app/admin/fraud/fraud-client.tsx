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
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import { Phone } from "@/components/ui/phone";
import { RiskBadge } from "@/components/ui/status-badge";
import type { FraudAssessment, FraudListEntry, FraudScoreInput, RiskLevel, SuggestedAction } from "@/fraud/types";

const DHAKA = { division: "Dhaka", district: "Dhaka", upazila: "Mirpur" };

interface Scenario {
  label: string;
  input: Omit<FraudScoreInput, "lists" | "now">;
}

/** Sample INPUTS for the score tester — fixtures only, scored by the API against the real DB lists. */
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
    label: "নমুনা ফোন (কালো তালিকায় থাকলে হিট হবে)",
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
    label: "নিয়মিত গ্রাহকের নমুনা (একটি ডুপ্লিকেটসহ)",
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

type ApiError = { code?: string; message?: string };

async function apiJson<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data?: T; error?: ApiError }> {
  const res = await fetch(url, init);
  const body = (await res.json().catch(() => null)) as { data?: T; error?: ApiError } | null;
  return { ok: res.ok, status: res.status, data: body?.data, error: body?.error };
}

const SELECT_CLASS = "h-10 w-full rounded-[10px] border border-border bg-card px-3 text-sm outline-none focus:border-brand-500";

interface ListsData {
  bands: { low: string; medium: string; high: string };
  blacklist: FraudListEntry[];
  whitelist: FraudListEntry[];
}

export function FraudClient() {
  const [state, setState] = useState<"loading" | "locked" | "unauthenticated" | "error" | "ready">("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [lists, setLists] = useState<ListsData>({ bands: { low: "", medium: "", high: "" }, blacklist: [], whitelist: [] });

  const [results, setResults] = useState<Record<string, FraudAssessment>>({});
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
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
        setErrorMessage(res.error?.message ?? `সার্ভার ত্রুটি (${res.status})`);
        return setState("error");
      }
      if (res.data) setLists(res.data);
      setState("ready");
    } catch {
      setErrorMessage("নেটওয়ার্ক ত্রুটি — সার্ভারে পৌঁছানো যায়নি।");
      setState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function scoreAll() {
    setScoreBusy(true);
    setScoreStatus(null);
    const next: Record<string, FraudAssessment> = {};
    let failed = 0;
    for (const scenario of SCENARIOS) {
      try {
        const res = await apiJson<{ assessment: FraudAssessment }>("/api/v1/admin/fraud-rules/score", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(scenario.input),
        });
        if (res.ok && res.data?.assessment) next[scenario.label] = res.data.assessment;
        else failed += 1;
      } catch {
        failed += 1;
      }
    }
    setResults(next);
    const first = SCENARIOS.find((s) => next[s.label]);
    setSelectedLabel(first?.label ?? null);
    setScoreStatus(
      failed === 0
        ? "সব নমুনা API দিয়ে যাচাই হয়েছে (বর্তমান ডাটাবেস তালিকা অনুযায়ী)।"
        : `${failed}টি নমুনা যাচাই ব্যর্থ হয়েছে — আবার চেষ্টা করুন।`,
    );
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
        setEntryStatus("এন্ট্রি ডাটাবেসে যোগ হয়েছে।");
        setEntryForm({ list: "blacklist", kind: "phone", value: "", district: "", reason: "" });
      } else {
        setEntryStatus(`যোগ ব্যর্থ: ${res.error?.message ?? `HTTP ${res.status}`} — কিছুই সংরক্ষিত হয়নি।`);
      }
    } catch {
      setEntryStatus("যোগ ব্যর্থ: নেটওয়ার্ক ত্রুটি — কিছুই সংরক্ষিত হয়নি।");
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
        setEntryStatus(`সরানো ব্যর্থ: ${res.error?.message ?? `HTTP ${res.status}`}`);
      }
    } catch {
      setEntryStatus("সরানো ব্যর্থ: নেটওয়ার্ক ত্রুটি।");
    } finally {
      setRowBusyId(null);
    }
  }

  if (state === "locked") {
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

  if (state === "unauthenticated") {
    return (
      <main>
        <PageHeader title="প্রতারণা যাচাই (Fraud Scoring)" description="ঝুঁকি স্কোর ও কালো/সাদা তালিকা (ধাপ ৪৩, A2)" />
        <p role="status">লগইন প্রয়োজন — ডেটা দেখতে আগে অ্যাডমিন হিসেবে লগইন করুন।</p>
      </main>
    );
  }

  if (state === "loading" || state === "error") {
    return (
      <main>
        <PageHeader title="প্রতারণা যাচাই (Fraud Scoring)" description="ঝুঁকি স্কোর ও কালো/সাদা তালিকা (ধাপ ৪৩, A2)" breadcrumb="Admin / Fraud" />
        {state === "loading" ? (
          <p role="status" className="text-sm text-text-muted">তালিকা লোড হচ্ছে…</p>
        ) : (
          <div>
            <p role="alert" className="text-sm text-rose-500">⚠ ডেটা লোড হয়নি: {errorMessage}</p>
            <Button type="button" className="mt-3" onClick={() => void load()}>আবার চেষ্টা করুন</Button>
          </div>
        )}
      </main>
    );
  }

  const resultList = Object.values(results);
  const highRisk = resultList.filter((r) => r.score >= 70).length;
  const selected = selectedLabel ? results[selectedLabel] : undefined;

  const scenarioRows = SCENARIOS.map((scenario) => {
    const assessment = results[scenario.label];
    const action = assessment ? ACTION_TEXT[assessment.suggestedAction] : null;
    return {
      scenario: (
        <button type="button" className="font-medium underline-offset-2 hover:underline" onClick={() => setSelectedLabel(scenario.label)}>
          {scenario.label}
        </button>
      ),
      phone: <Phone phone={scenario.input.phone} />,
      total: <Money poisha={scenario.input.totalPoisha} />,
      score: assessment ? <span className="font-mono font-bold tabular-nums">{assessment.score}</span> : <span className="text-text-muted">—</span>,
      level: assessment ? <RiskBadge level={RISK_BADGE_LEVEL[assessment.level]} /> : <span className="text-text-muted">—</span>,
      action: action ? <Badge tone={action.tone}>{action.label}</Badge> : <span className="text-text-muted">যাচাই হয়নি</span>,
      otp: assessment ? (assessment.requiresOtp ? <Badge tone="danger">⚠ OTP লাগবে</Badge> : <Badge tone="neutral">OTP লাগবে না</Badge>) : <span className="text-text-muted">—</span>,
    };
  });

  const signalRows = selected
    ? selected.signals.map((sig) => ({
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

  const listRowData = [
    ...lists.blacklist.map((e) => ({ entry: e, listName: "blacklist" as const, label: "কালো তালিকা", tone: "danger" as const })),
    ...lists.whitelist.map((e) => ({ entry: e, listName: "whitelist" as const, label: "সাদা তালিকা", tone: "success" as const })),
  ];
  const listRows = listRowData.map(({ entry, listName, label, tone }) => ({
    list: <Badge tone={tone}>{label}</Badge>,
    kind: entry.kind === "phone" ? "ফোন" : "ঠিকানা (জেলা)",
    value: entry.kind === "phone" ? <Phone phone={entry.value} /> : (entry.district ?? entry.value),
    reason: entry.reason,
    added: <span className="font-mono text-xs">{entry.createdAt.slice(0, 10)}</span>,
    remove:
      confirmRemoveId === entry.id ? (
        <span className="flex gap-1">
          <Button type="button" size="sm" variant="destructive" loading={rowBusyId === entry.id} onClick={() => void removeEntry(entry, listName)}>নিশ্চিত সরান</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmRemoveId(null)}>বাতিল</Button>
        </span>
      ) : (
        <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmRemoveId(entry.id)}>সরান</Button>
      ),
  }));

  return (
    <main>
      <PageHeader
        title="প্রতারণা যাচাই (Fraud Scoring)"
        description="তালিকা ও স্কোর — সব আসল API থেকে, বর্তমান ডাটাবেস তালিকা অনুযায়ী। আসল অর্ডারে স্কোর চেকআউটেও গণনা হয়।"
        breadcrumb="Admin / Fraud"
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="কালো তালিকা এন্ট্রি" value={String(lists.blacklist.length)} delta="ডাটাবেস থেকে" icon="⛔" />
        <StatCard label="সাদা তালিকা এন্ট্রি" value={String(lists.whitelist.length)} delta="ডাটাবেস থেকে" icon="✓" />
        <StatCard label="যাচাই করা নমুনা" value={String(resultList.length)} delta="এই সেশনে API দিয়ে" icon="🔎" />
        <StatCard label="উচ্চ ঝুঁকি (৭০+)" value={String(highRisk)} delta={highRisk > 0 ? "ব্যবস্থা লাগবে" : "নেই"} deltaTone={highRisk > 0 ? "down" : "up"} icon="⚠" />
      </div>

      <Card className="mb-8">
        <h2 className="mb-1 text-base font-semibold">স্কোর ব্যান্ড (API থেকে)</h2>
        <p className="text-sm text-text-muted">
          কম: {lists.bands.low} · মাঝারি: {lists.bands.medium} · বেশি: {lists.bands.high}
        </p>
      </Card>

      <h2 className="mb-3 text-lg font-semibold">স্কোর টেস্টার (নমুনা ইনপুট)</h2>
      <p className="mb-3 text-xs text-text-muted">
        নমুনাগুলো শুধু ইনপুট ফিক্সচার — স্কোর আসল API (<code>POST /fraud-rules/score</code>) বর্তমান ডাটাবেস তালিকা দিয়ে গণনা করে।
        সারিতে ক্লিক করলে সেই ফলাফলের সিগন্যাল বিবরণ নিচে দেখা যাবে।
      </p>
      <Button type="button" loading={scoreBusy} onClick={() => void scoreAll()}>সব নমুনা যাচাই করুন</Button>
      {scoreStatus ? <p role="status" className="mt-2 text-sm">{scoreStatus}</p> : null}
      <div className="mt-3">
        <DataTable
          caption="প্রতিটি সারি একটি নমুনা অর্ডারের সারাংশ → API-র স্কোর, স্তর, প্রস্তাবিত পদক্ষেপ ও OTP প্রয়োজনীয়তা। ফোন মাস্ক করা।"
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
      </div>

      <h2 className="mb-3 mt-8 text-lg font-semibold">সিগন্যাল বিবরণ{selectedLabel ? ` — ${selectedLabel}` : ""}</h2>
      {selected ? (
        <DataTable
          caption={`মোট স্কোর ${selected.score} — কোন সিগন্যাল কত পয়েন্ট দিয়েছে, স্টাফ যেন সিদ্ধান্তের কারণ দেখতে পায়`}
          columns={[
            { key: "signal", header: "সিগন্যাল" },
            { key: "points", header: "পয়েন্ট" },
            { key: "triggered", header: "অবস্থা" },
            { key: "detail", header: "বিবরণ" },
          ]}
          rows={signalRows}
        />
      ) : (
        <EmptyState title="এখনো কোনো ফলাফল নেই" description="আগে নমুনা যাচাই চালান — তারপর এখানে API-র সিগন্যাল-ভিত্তিক বিবরণ দেখা যাবে।" />
      )}

      <h2 className="mb-3 mt-8 text-lg font-semibold">কালো / সাদা তালিকা (ডাটাবেস)</h2>
      {listRows.length === 0 ? (
        <EmptyState title="তালিকা খালি" description="ডাটাবেসে এখনো কোনো কালো/সাদা তালিকা এন্ট্রি নেই — নিচের ফর্ম দিয়ে যোগ করুন।" />
      ) : (
        <DataTable
          caption="আসল তালিকা — ফোন সবসময় মাস্ক করা; পূর্ণ নম্বর কখনো এই পেজে দেখানো হয় না"
          columns={[
            { key: "list", header: "তালিকা" },
            { key: "kind", header: "ধরন" },
            { key: "value", header: "মান" },
            { key: "reason", header: "কারণ" },
            { key: "added", header: "যোগ করা" },
            { key: "remove", header: "" },
          ]}
          rows={listRows}
        />
      )}

      <h3 className="mb-3 mt-8 text-base font-semibold">নতুন এন্ট্রি যোগ করুন</h3>
      <Card>
        <form onSubmit={(e) => void addEntry(e)} className="grid gap-3 sm:grid-cols-2">
          <div>
            <span className="mb-1 block text-xs font-medium text-text-muted">তালিকা *</span>
            <select className={SELECT_CLASS} value={entryForm.list} onChange={(e) => setEntryForm({ ...entryForm, list: e.target.value })}>
              <option value="blacklist">কালো তালিকা</option>
              <option value="whitelist">সাদা তালিকা</option>
            </select>
          </div>
          <div>
            <span className="mb-1 block text-xs font-medium text-text-muted">ধরন *</span>
            <select className={SELECT_CLASS} value={entryForm.kind} onChange={(e) => setEntryForm({ ...entryForm, kind: e.target.value })}>
              <option value="phone">ফোন</option>
              <option value="address">ঠিকানা (জেলা)</option>
            </select>
          </div>
          <Input
            label={entryForm.kind === "phone" ? "ফোন নম্বর" : "ঠিকানার মান"}
            name="fraud-entry-value"
            required
            helper={entryForm.kind === "phone" ? "বাংলাদেশি মোবাইল (01XXXXXXXXX) — সংরক্ষণের পর মাস্ক করে দেখানো হবে" : undefined}
            value={entryForm.value}
            onChange={(e) => setEntryForm({ ...entryForm, value: e.target.value })}
          />
          {entryForm.kind === "address" ? (
            <Input label="জেলা" name="fraud-entry-district" required value={entryForm.district} onChange={(e) => setEntryForm({ ...entryForm, district: e.target.value })} />
          ) : null}
          <Input label="কারণ" name="fraud-entry-reason" required minLength={3} maxLength={500} value={entryForm.reason} onChange={(e) => setEntryForm({ ...entryForm, reason: e.target.value })} />
          <div className="flex items-end">
            <Button type="submit" loading={entryBusy}>এন্ট্রি যোগ করুন</Button>
          </div>
        </form>
        {entryStatus ? <p role="status" className="mt-3 text-sm">{entryStatus}</p> : null}
      </Card>
    </main>
  );
}
