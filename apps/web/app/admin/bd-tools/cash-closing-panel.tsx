"use client";

/**
 * BD Tools — দৈনিক ক্যাশ ক্লোজিং panel (real wiring, 2026-10-25;
 * cash channel auto-derived in doc 17 batch O8-2).
 *
 * The cash expectation used to be typed by hand (cash sales, cash
 * refunds, expenses, deposits), so the closing compared a count
 * against the staff's own guess. Now the server derives the drawer
 * expectation from the day's records — POS cash sales + rider COD
 * hand-ins − cash refunds SENT (src/bd/cash-closing-derive) — and
 * this panel only collects PHYSICAL facts: the counted drawer cash,
 * an optional opening-count override, the other channels' expected /
 * actual (bKash / Nagad / courier COD receivable), and a sign-off
 * note, which the API REQUIRES when the counted cash differs from
 * the derived expectation. The derived breakdown renders next to the
 * count input, per source line, with record counts.
 *
 * The breakdown is computed live by the server for the chosen date
 * (GET /api/v1/admin/bd/cash-closing?date=). It is not stored —
 * daily_cash_closings has no column for it; only the derived
 * expected figure itself is persisted (expectedCashPoisha).
 * Courier-collected COD never enters the drawer expectation: that
 * money sits with the courier and belongs to the remittance ledger.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/ui/money";
import { DataTable } from "@/components/ui/table";
import type { DailyCashClosing } from "@/bd/cash-closing";
import type { DerivedDrawerCash } from "@/bd/cash-closing-derive";
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
  /** Recorded payment-attempt totals for today — editable estimates
   *  for the bKash / Nagad channels only. */
  suggested: { bkashExpectedPoisha: number; nagadExpectedPoisha: number };
  /** Server-derived drawer expectation for todayYmd. */
  initialDerived: DerivedDrawerCash;
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

export function CashClosingPanel({ todayYmd, recentClosings, suggested, initialDerived }: CashClosingPanelProps) {
  const router = useRouter();
  const [date, setDate] = useState(todayYmd);
  const [derived, setDerived] = useState<DerivedDrawerCash>(initialDerived);
  const [derivedLoading, setDerivedLoading] = useState(false);
  const [opening, setOpening] = useState(poishaToTaka(initialDerived.openingCashPoisha));
  const [counted, setCounted] = useState("0");
  const [note, setNote] = useState("");
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

  // Refetch the derived breakdown whenever the closing date changes.
  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date === derived.date) return;
    let cancelled = false;
    setDerivedLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/v1/admin/bd/cash-closing?date=${date}`);
        if (!res.ok) return;
        const payload = (await res.json()) as { data?: { derived?: DerivedDrawerCash } };
        if (!cancelled && payload.data?.derived) {
          setDerived(payload.data.derived);
          setOpening(poishaToTaka(payload.data.derived.openingCashPoisha));
        }
      } catch {
        // Keep the last breakdown on screen; the expected figure is
        // recomputed server-side at submit time regardless.
      } finally {
        if (!cancelled) setDerivedLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const openingPoisha = takaToPoisha(opening);
  const countedPoisha = takaToPoisha(counted);
  const tolerancePoisha = takaToPoisha(tolerance) ?? 0;
  // Live preview of the expectation with the (possibly overridden)
  // opening count: derived.expected uses the derived opening, so
  // adjust by the difference.
  const previewExpected =
    openingPoisha === null
      ? null
      : derived.expectedCashPoisha - derived.openingCashPoisha + openingPoisha;
  const previewVariance =
    countedPoisha === null || previewExpected === null ? null : countedPoisha - previewExpected;
  const noteRequired = previewVariance !== null && Math.abs(previewVariance) > tolerancePoisha;

  async function submit() {
    setError(null);
    const fields: Array<[string, string]> = [
      ["openingCashPoisha", opening],
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
    if (noteRequired && !note.trim()) {
      setError("গণনা করা নগদ হিসাবের সঙ্গে মেলেনি — পার্থক্যের কারণ লিখে নোট দিন, তারপর জমা দিন।");
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
          countedCashPoisha: parsed.get("countedCashPoisha"),
          bkash: { expectedPoisha: parsed.get("bkashExpected"), actualPoisha: parsed.get("bkashActual") },
          nagad: { expectedPoisha: parsed.get("nagadExpected"), actualPoisha: parsed.get("nagadActual") },
          courierCodReceivable: { expectedPoisha: parsed.get("courierCodExpected"), actualPoisha: parsed.get("courierCodActual") },
          customerDuePoisha: parsed.get("customerDuePoisha"),
          tolerancePoisha: parsed.get("tolerancePoisha"),
          note: note.trim() ? note.trim() : undefined,
        }),
      });
      const payload = (await res.json().catch(() => null)) as
        | { data?: { closing: DailyCashClosing; derived: DerivedDrawerCash }; error?: { message?: string } }
        | null;
      if (!res.ok || !payload?.data) {
        setError(payload?.error?.message ?? `ক্লোজিং সংরক্ষণ হয়নি (HTTP ${res.status})।`);
        return;
      }
      setClosing(payload.data.closing);
      setDerived(payload.data.derived);
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
        দিনের শেষে ড্রয়ারের আসল গণনা লিখে ক্লোজিং জমা দিন। <strong>নগদের "থাকার কথা" এখন সিস্টেম
        নিজে হিসাব করে</strong> — দিনের রেকর্ড থেকে: POS নগদ বিক্রয় + রাইডারের হস্তান্তর করা COD −
        নগদে পাঠানো ফেরত। আগের মতো হাতে লিখে দেওয়া হয় না, তাই গণনার সঙ্গে মিলিয়ে দেখাটা সত্যিকারের
        যাচাই। হিসাব <span className="font-mono text-xs">buildDailyCashClosing()</span> দিয়ে হয় এবং
        ফলাফল <span className="font-mono text-xs">daily_cash_closings</span> টেবিলে সংরক্ষিত থাকে (এক
        তারিখে একটিই ক্লোজিং — আবার জমা দিলে সেই দিনের রেকর্ড সংশোধিত হয়)। অমিল কখনো নিজে থেকে ঠিক
        করা হয় না; নগদে অমিল থাকলে কারণ লিখে নোট দেওয়া বাধ্যতামূলক। বিকাশ/নগদ "থাকার কথা" ঘরে আজকের
        রেকর্ডকৃত পেমেন্টের হিসাব আগাম বসানো আছে — এটি সিস্টেমের অনুমান, বদলে দেওয়া যায়।
      </p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface-2 p-4">
          <h3 className="text-sm font-semibold">
            সিস্টেমের হিসাব — ড্রয়ারে থাকার কথা ({formatDateBn(derived.date)})
            {derivedLoading ? <span className="ml-2 text-xs font-normal text-text-muted">হিসাব আসছে…</span> : null}
          </h3>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-text-muted">
                শুরুর নগদ{" "}
                <span className="text-xs">
                  ({derived.openingSource === "previous_closing" ? "আগের ক্লোজিংয়ের গণনা থেকে" : "আগের ক্লোজিং নেই — ০ ধরা হয়েছে"})
                </span>
              </dt>
              <dd><Money poisha={derived.openingCashPoisha} /></dd>
            </div>
            {derived.lines.map((line) => (
              <div key={line.key} className="flex items-baseline justify-between gap-3">
                <dt className="text-text-muted">
                  {line.direction === "in" ? "+ " : "− "}
                  {line.labelBn}{" "}
                  <span className="text-xs">({line.recordCount}টি রেকর্ড থেকে)</span>
                </dt>
                <dd><Money poisha={line.amountPoisha} /></dd>
              </div>
            ))}
            <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2 font-medium">
              <dt>মোট থাকার কথা (Expected)</dt>
              <dd><Money poisha={previewExpected ?? derived.expectedCashPoisha} /></dd>
            </div>
            {previewVariance !== null ? (
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-text-muted">গণনার সঙ্গে পার্থক্য</dt>
                <dd>
                  {previewVariance === 0 ? (
                    <Badge tone="success">মিলেছে</Badge>
                  ) : (
                    <Badge tone="danger">
                      পার্থক্য <Money poisha={previewVariance} />
                    </Badge>
                  )}
                </dd>
              </div>
            ) : null}
          </dl>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-text-muted">
            {derived.exclusionsBn.map((line) => (
              <li key={line}>{line}</li>
            ))}
            <li>খরচ বা ব্যাংকে জমার কোনো রেকর্ড সিস্টেমে নেই — এমন কিছু ঘটলে নোটে লিখে রাখুন।</li>
          </ul>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-text-muted">তারিখ (yyyy-mm-dd)</span>
              <input type="text" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
            </label>
            <TakaField label="শুরুর নগদ (টাকা) — গণনা, বদলানো যায়" value={opening} onChange={setOpening} />
            <TakaField label="গণনা করা নগদ (টাকা)" value={counted} onChange={setCounted} />
            <TakaField label="সহনশীলতা / টলারেন্স (টাকা)" value={tolerance} onChange={setTolerance} />
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-text-muted">
              নোট {noteRequired ? <span className="text-rose-600">(অমিল আছে — নোট বাধ্যতামূলক)</span> : "(ঐচ্ছিক)"}
            </span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className={inputClass}
              placeholder="পার্থক্যের কারণ বা দিনের উল্লেখযোগ্য নগদ ঘটনা…"
            />
          </label>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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
