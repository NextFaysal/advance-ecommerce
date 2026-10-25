"use client";

/**
 * BD Tools — দৈনিক ক্যাশ ক্লোজিং panel (real wiring, 2026-10-25).
 *
 * The old panel rendered buildDailyCashClosing() over a hard-coded
 * DEMO input. This one is the real flow: staff enter the day's physical
 * counts (opening cash, cash sales/refunds, expenses, deposits, counted
 * drawer cash, and per-channel expected/actual for bKash, Nagad and
 * courier COD) and submit to POST /api/v1/admin/bd/cash-closing, which
 * validates with dailyCashClosingInputSchema, computes with the same
 * buildDailyCashClosing() service and UPSERTS the result into the
 * daily_cash_closings table (one closing per date — a re-count corrects
 * the day). The returned closing is rendered below the form; the list
 * of previously saved closings comes from the server page as props.
 *
 * Prefill honesty: the bKash/Nagad "expected" fields start from the
 * day's recorded payment attempts (server-computed suggestion, passed
 * as props) — labelled as a system-record estimate and fully editable;
 * every other field starts empty/zero because drawer counts are
 * physical facts only staff know.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/ui/money";
import { DataTable } from "@/components/ui/table";
import type { DailyCashClosing } from "@/bd/cash-closing";
import { CHANNEL_LABELS_BN, formatDateBn } from "./labels";

export interface StoredClosingView {
  date: string;
  hasMismatch: boolean;
  totalDifferencePoisha: number;
  createdAt: string;
}

export interface CashClosingPanelProps {
  /** Today, yyyy-mm-dd (Asia/Dhaka), from the server page. */
  todayYmd: string;
  recentClosings: StoredClosingView[];
  /** Recorded payment-attempt totals for today — editable estimates. */
  suggested: { bkashExpectedPoisha: number; nagadExpectedPoisha: number };
}

/** Taka string -> integer poisha, zero allowed (closing fields are counts). */
function takaToPoisha(text: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match?.[1]) return null;
  const poisha = Number(match[1]) * 100 + (match[2] ? Number(match[2].padEnd(2, "0")) : 0);
  return Number.isSafeInteger(poisha) ? poisha : null;
}

function poishaToTaka(poisha: number): string {
  return `${Math.floor(poisha / 100)}.${String(poisha % 100).padStart(2, "0")}`;
}

const inputClass =
  "w-full rounded-[10px] border border-border bg-card px-3 py-2 text-sm outline-none focus:border-brand-500";

function TakaField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-text-muted">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      />
    </label>
  );
}

export function CashClosingPanel({ todayYmd, recentClosings, suggested }: CashClosingPanelProps) {
  const router = useRouter();
  const [date, setDate] = useState(todayYmd);
  const [opening, setOpening] = useState("0");
  const [cashSales, setCashSales] = useState("0");
  const [cashRefunds, setCashRefunds] = useState("0");
  const [expenses, setExpenses] = useState("0");
  const [deposited, setDeposited] = useState("0");
  const [counted, setCounted] = useState("0");
  const [bkashExpected, setBkashExpected] = useState(poishaToTaka(suggested.bkashExpectedPoisha));
  const [bkashActual, setBkashActual] = useState("0");
  const [nagadExpected, setNagadExpected] = useState(poishaToTaka(suggested.nagadExpectedPoisha));
  const [nagadActual, setNagadActual] = useState("0");
  const [codExpected, setCodExpected] = useState("0");
  const [codActual, setCodActual] = useState("0");
  const [customerDue, setCustomerDue] = useState("0");
  const [tolerance, setTolerance] = useState("0");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState<DailyCashClosing | null>(null);

  async function submit() {
    setError(null);
    const fields: Array<[string, string]> = [
      ["openingCashPoisha", opening],
      ["cashSalesPoisha", cashSales],
      ["cashRefundsPoisha", cashRefunds],
      ["expensesPoisha", expenses],
      ["cashDepositedPoisha", deposited],
      ["countedCashPoisha", counted],
      ["bkashExpected", bkashExpected],
      ["bkashActual", bkashActual],
      ["nagadExpected", nagadExpected],
      ["nagadActual", nagadActual],
      ["courierCodExpected", codExpected],
      ["courierCodActual", codActual],
      ["customerDuePoisha", customerDue],
      ["tolerancePoisha", tolerance],
    ];
    const parsed = new Map<string, number>();
    for (const [key, raw] of fields) {
      const value = takaToPoisha(raw);
      if (value === null) {
        setError("সব টাকার ঘরে সঠিক সংখ্যা লিখুন (টাকায়, সর্বোচ্চ ২ দশমিক ঘর)।");
        return;
      }
      parsed.set(key, value);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError("তারিখ yyyy-mm-dd আকারে লিখুন।");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/admin/bd/cash-closing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          openingCashPoisha: parsed.get("openingCashPoisha"),
          cashSalesPoisha: parsed.get("cashSalesPoisha"),
          cashRefundsPoisha: parsed.get("cashRefundsPoisha"),
          expensesPoisha: parsed.get("expensesPoisha"),
          cashDepositedPoisha: parsed.get("cashDepositedPoisha"),
          countedCashPoisha: parsed.get("countedCashPoisha"),
          bkash: { expectedPoisha: parsed.get("bkashExpected"), actualPoisha: parsed.get("bkashActual") },
          nagad: { expectedPoisha: parsed.get("nagadExpected"), actualPoisha: parsed.get("nagadActual") },
          courierCodReceivable: { expectedPoisha: parsed.get("courierCodExpected"), actualPoisha: parsed.get("courierCodActual") },
          customerDuePoisha: parsed.get("customerDuePoisha"),
          tolerancePoisha: parsed.get("tolerancePoisha"),
        }),
      });
      const payload = (await res.json().catch(() => null)) as
        | { data?: { closing: DailyCashClosing }; error?: { message?: string } }
        | null;
      if (!res.ok || !payload?.data) {
        setError(payload?.error?.message ?? `ক্লোজিং সংরক্ষণ হয়নি (HTTP ${res.status})।`);
        return;
      }
      setClosing(payload.data.closing);
      router.refresh();
    } catch {
      setError("নেটওয়ার্ক সমস্যা — ক্লোজিং পাঠানো যায়নি, আবার চেষ্টা করুন।");
    } finally {
      setSubmitting(false);
    }
  }

  const resultRows = closing
    ? closing.channels.map((c) => ({
        channel: CHANNEL_LABELS_BN[c.channel],
        expected: <Money poisha={c.expectedPoisha} />,
        actual: <Money poisha={c.actualPoisha} />,
        difference: <Money poisha={c.differencePoisha} />,
        status: c.mismatch ? (
          <Badge tone="danger">অমিল আছে</Badge>
        ) : (
          <Badge tone="success">মিলেছে</Badge>
        ),
      }))
    : [];

  return (
    <div className="space-y-5">
      <p className="text-sm text-text-muted">
        দিনের শেষে ড্রয়ার ও চ্যানেলের আসল গণনা লিখে ক্লোজিং জমা দিন — হিসাব{" "}
        <span className="font-mono text-xs">buildDailyCashClosing()</span> দিয়ে হয় এবং ফলাফল{" "}
        <span className="font-mono text-xs">daily_cash_closings</span> টেবিলে সংরক্ষিত থাকে (এক তারিখে
        একটিই ক্লোজিং — আবার জমা দিলে সেই দিনের রেকর্ড সংশোধিত হয়)। অমিল কখনো নিজে থেকে ঠিক করা হয়
        না। বিকাশ/নগদ "থাকার কথা" ঘরে আজকের রেকর্ডকৃত পেমেন্টের হিসাব আগাম বসানো আছে — এটি সিস্টেমের
        অনুমান, বদলে দেওয়া যায়; বাকি ঘরগুলো শারীরিক গণনা থেকে আসে।
      </p>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-text-muted">তারিখ (yyyy-mm-dd)</span>
          <input type="text" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
        </label>
        <TakaField label="শুরুর নগদ (টাকা)" value={opening} onChange={setOpening} />
        <TakaField label="নগদ বিক্রয় (টাকা)" value={cashSales} onChange={setCashSales} />
        <TakaField label="নগদ ফেরত (টাকা)" value={cashRefunds} onChange={setCashRefunds} />
        <TakaField label="খরচ (টাকা)" value={expenses} onChange={setExpenses} />
        <TakaField label="ব্যাংকে জমা (টাকা)" value={deposited} onChange={setDeposited} />
        <TakaField label="গণনা করা নগদ (টাকা)" value={counted} onChange={setCounted} />
        <TakaField label="সহনশীলতা / টলারেন্স (টাকা)" value={tolerance} onChange={setTolerance} />
        <TakaField label="বিকাশ — থাকার কথা (টাকা)" value={bkashExpected} onChange={setBkashExpected} />
        <TakaField label="বিকাশ — আসলে আছে (টাকা)" value={bkashActual} onChange={setBkashActual} />
        <TakaField label="নগদ — থাকার কথা (টাকা)" value={nagadExpected} onChange={setNagadExpected} />
        <TakaField label="নগদ — আসলে আছে (টাকা)" value={nagadActual} onChange={setNagadActual} />
        <TakaField label="কুরিয়ার COD প্রাপ্য — থাকার কথা (টাকা)" value={codExpected} onChange={setCodExpected} />
        <TakaField label="কুরিয়ার COD প্রাপ্য — আসলে আছে (টাকা)" value={codActual} onChange={setCodActual} />
        <TakaField label="গ্রাহকের বকেয়া, মেমো (টাকা)" value={customerDue} onChange={setCustomerDue} />
      </div>

      {error ? (
        <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      ) : null}
      <Button type="button" onClick={() => void submit()} loading={submitting}>
        ক্লোজিং হিসাব করে সংরক্ষণ করুন
      </Button>

      {closing ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">সংরক্ষিত ক্লোজিং — দিন: {formatDateBn(closing.date)}</h3>
            {closing.hasMismatch ? (
              <Badge tone="danger">
                অমিল আছে — চ্যানেল: {closing.mismatchChannels.map((c) => CHANNEL_LABELS_BN[c]).join(", ")}
              </Badge>
            ) : (
              <Badge tone="success">সব চ্যানেল মিলেছে</Badge>
            )}
          </div>
          <DataTable
            columns={[
              { key: "channel", header: "চ্যানেল" },
              { key: "expected", header: "থাকার কথা (Expected)" },
              { key: "actual", header: "আসলে আছে (Actual)" },
              { key: "difference", header: "পার্থক্য" },
              { key: "status", header: "অবস্থা" },
            ]}
            rows={resultRows}
          />
          <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
            <div className="rounded-lg border border-border bg-surface-2 p-3">
              <p className="text-xs text-text-muted">সর্বমোট থাকার কথা</p>
              <p className="mt-1"><Money poisha={closing.totalExpectedPoisha} /></p>
            </div>
            <div className="rounded-lg border border-border bg-surface-2 p-3">
              <p className="text-xs text-text-muted">সর্বমোট আসলে আছে</p>
              <p className="mt-1"><Money poisha={closing.totalActualPoisha} /></p>
            </div>
            <div className="rounded-lg border border-border bg-surface-2 p-3">
              <p className="text-xs text-text-muted">সর্বমোট পার্থক্য</p>
              <p className="mt-1"><Money poisha={closing.totalDifferencePoisha} /></p>
            </div>
          </div>
          <p className="text-sm text-text-muted">
            মেমো: গ্রাহকের খাতায় বকেয়া <Money poisha={closing.customerDuePoisha} /> — এটি হাতে থাকা টাকা
            নয়, তাই কোনো মোটে যোগ হয়নি।
          </p>
        </div>
      ) : null}

      <div>
        <h3 className="mb-2 text-sm font-semibold">আগের সংরক্ষিত ক্লোজিং</h3>
        {recentClosings.length > 0 ? (
          <DataTable
            columns={[
              { key: "date", header: "তারিখ" },
              { key: "status", header: "অবস্থা" },
              { key: "difference", header: "মোট পার্থক্য" },
              { key: "savedAt", header: "সংরক্ষণের সময়" },
            ]}
            rows={recentClosings.map((c) => ({
              date: formatDateBn(c.date),
              status: c.hasMismatch ? (
                <Badge tone="danger">অমিল আছে</Badge>
              ) : (
                <Badge tone="success">মিলেছে</Badge>
              ),
              difference: <Money poisha={c.totalDifferencePoisha} />,
              savedAt: <span className="font-mono text-xs">{c.createdAt.slice(0, 16).replace("T", " ")}</span>,
            }))}
          />
        ) : (
          <p className="text-sm text-text-muted">
            এখনো কোনো ক্লোজিং সংরক্ষিত হয়নি — ওপরে প্রথম দিনের গণনা জমা দিলেই এখানে তালিকা আসবে।
          </p>
        )}
      </div>
    </div>
  );
}
