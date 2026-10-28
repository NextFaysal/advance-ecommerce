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
import { EmptyState } from "@/components/ui/empty-state";
import type { DailyCashClosing } from "@/bd/cash-closing";
import type { DerivedDrawerCash } from "@/bd/cash-closing-derive";
import { channelLabels, formatDate } from "./labels";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { BD_TOOLS_STRINGS, type BdToolsStrings } from "./strings";

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

/* ------------------------------------------------------------------ */
/* OD4 (doc 19 §3-S4) — visual form of the derived drawer breakdown.  */
/* Widths are display ratios of the SAME figures the list beside     */
/* them prints (derived.openingCashPoisha, derived.lines amounts,    */
/* derived.expectedCashPoisha and the counted input); nothing is     */
/* re-derived or rounded here.                                       */
/* ------------------------------------------------------------------ */

function pctOf(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.min(100, Math.max(0, (part / whole) * 100));
}

const IN_SEGMENT_CLASSES = ["bg-success-solid", "bg-chart-5", "bg-success-solid/45"];

function DrawerBreakdownVisual({
  derived,
  expectedPoisha,
  countedPoisha,
  variancePoisha,
}: {
  derived: DerivedDrawerCash;
  expectedPoisha: number;
  countedPoisha: number | null;
  variancePoisha: number | null;
}) {
  const { locale } = useLocale();
  const s = pick(locale, BD_TOOLS_STRINGS);
  const inLines = derived.lines.filter((l) => l.direction === "in");
  const outLines = derived.lines.filter((l) => l.direction === "out");
  const inTotal = inLines.reduce((s, l) => s + l.amountPoisha, 0);
  const outTotal = outLines.reduce((s, l) => s + l.amountPoisha, 0);
  const grossIn = derived.openingCashPoisha + inTotal;
  const scale = Math.max(expectedPoisha, countedPoisha ?? 0, 1);
  return (
    <div className="mt-4 space-y-3 border-t border-border pt-3">
      {grossIn > 0 ? (
        <div>
          <p className="mb-1.5 text-xs font-medium text-text-muted">{s.cashDrawerInTitle}</p>
          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-card" role="img" aria-label={s.cashDrawerInAria}>
            <span className="bg-text-subtle" style={{ width: `${pctOf(derived.openingCashPoisha, grossIn)}%` }} />
            {inLines.map((line, i) => (
              <span
                key={line.key}
                className={IN_SEGMENT_CLASSES[i % IN_SEGMENT_CLASSES.length]}
                style={{ width: `${pctOf(line.amountPoisha, grossIn)}%` }}
              />
            ))}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-text-muted">
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-text-subtle" /> {s.cashOpeningShort} <Money poisha={derived.openingCashPoisha} />
            </span>
            {inLines.map((line, i) => (
              <span key={line.key} className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className={`h-2 w-2 rounded-full ${IN_SEGMENT_CLASSES[i % IN_SEGMENT_CLASSES.length]}`} />
                {locale === "bn" ? line.labelBn : line.labelEn} <Money poisha={line.amountPoisha} />
              </span>
            ))}
          </div>
          {outTotal > 0 ? (
            <div className="mt-2.5">
              <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-card" role="img" aria-label={s.cashDrawerOutAria}>
                <span className="bg-danger" style={{ width: `${pctOf(outTotal, grossIn)}%` }} />
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-text-muted">
                {outLines.map((line) => (
                  <span key={line.key} className="inline-flex items-center gap-1.5">
                    <span aria-hidden="true" className="h-2 w-2 rounded-full bg-danger" />
                    {locale === "bn" ? line.labelBn : line.labelEn} −<Money poisha={line.amountPoisha} />
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div>
        <p className="mb-1.5 text-xs font-medium text-text-muted">{s.cashVsTitle}</p>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-xs text-text-muted">{s.cashExpectedShort}</span>
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-card">
              <div className="h-full bg-brand-500" style={{ width: `${pctOf(expectedPoisha, scale)}%` }} />
            </div>
            <span className="shrink-0 text-xs font-medium"><Money poisha={expectedPoisha} /></span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-xs text-text-muted">{s.cashCountedShort}</span>
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-card">
              <div
                className={`h-full ${variancePoisha === null || variancePoisha === 0 ? "bg-success-solid" : variancePoisha < 0 ? "bg-danger" : "bg-info-solid"}`}
                style={{ width: `${pctOf(countedPoisha ?? 0, scale)}%` }}
              />
            </div>
            <span className="shrink-0 text-xs font-medium">
              {countedPoisha === null ? "—" : <Money poisha={countedPoisha} />}
            </span>
          </div>
        </div>
        {variancePoisha !== null && variancePoisha !== 0 ? (
          <p className={`mt-1.5 text-xs font-medium ${variancePoisha < 0 ? "text-danger" : "text-info-solid"}`}>
            {variancePoisha < 0 ? s.cashCountedLess : s.cashCountedMore}
            <Money poisha={Math.abs(variancePoisha)} />
          </p>
        ) : null}
      </div>
    </div>
  );
}

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
        className={`${inputClass} tnum`}
      />
    </label>
  );
}

export function CashClosingPanel({ todayYmd, recentClosings, suggested, initialDerived }: CashClosingPanelProps) {
  const { locale } = useLocale();
  const s = pick(locale, BD_TOOLS_STRINGS);
  const CHANNEL_LABELS = channelLabels(locale);
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
        setError(s.cashErrNumbers);
        return;
      }
      parsed.set(key, value);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError(s.cashErrDate);
      return;
    }
    if (noteRequired && !note.trim()) {
      setError(s.cashErrNote);
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
        setError(payload?.error?.message ?? interpolate(s.cashSaveFailedHttp, { status: res.status }));
        return;
      }
      setClosing(payload.data.closing);
      setDerived(payload.data.derived);
      router.refresh();
    } catch {
      setError(s.cashNetwork);
    } finally {
      setSubmitting(false);
    }
  }

  const resultRows = closing
    ? closing.channels.map((c) => ({
        channel: CHANNEL_LABELS[c.channel],
        expected: <Money poisha={c.expectedPoisha} />,
        actual: <Money poisha={c.actualPoisha} />,
        difference: <Money poisha={c.differencePoisha} />,
        status: c.mismatch ? (
          <Badge tone="danger">{s.cashMismatchBadge}</Badge>
        ) : (
          <Badge tone="success">{s.cashMatchedBadge}</Badge>
        ),
      }))
    : [];

  return (
    <div className="space-y-5">
      <p className="text-sm text-text-muted">
        {s.cashIntro1}
        <strong>{s.cashIntroStrong}</strong>
        {s.cashIntro2}
        <span className="font-mono text-xs">buildDailyCashClosing()</span>
        {s.cashIntro3}
        <span className="font-mono text-xs">daily_cash_closings</span>
        {s.cashIntro4}
      </p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-border bg-surface-2 p-4">
          <h3 className="font-display text-sm font-semibold text-text-main">
            {interpolate(s.cashSystemTitle, { date: formatDate(derived.date, locale) })}
            {derivedLoading ? <span className="ml-2 text-xs font-normal text-text-muted">{s.cashDeriving}</span> : null}
          </h3>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-text-muted">
                {s.cashOpening}{" "}
                <span className="text-xs">
                  ({derived.openingSource === "previous_closing" ? s.cashOpeningPrev : s.cashOpeningNone})
                </span>
              </dt>
              <dd><Money poisha={derived.openingCashPoisha} /></dd>
            </div>
            {derived.lines.map((line) => (
              <div key={line.key} className="flex items-baseline justify-between gap-3">
                <dt className="text-text-muted">
                  {line.direction === "in" ? "+ " : "− "}
                  {locale === "bn" ? line.labelBn : line.labelEn}{" "}
                  <span className="text-xs">{interpolate(s.cashRecordSuffix, { count: line.recordCount })}</span>
                </dt>
                <dd><Money poisha={line.amountPoisha} /></dd>
              </div>
            ))}
            <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2 font-medium">
              <dt>{s.cashExpectedTotal}</dt>
              <dd><Money poisha={previewExpected ?? derived.expectedCashPoisha} /></dd>
            </div>
            {previewVariance !== null ? (
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-text-muted">{s.cashVarianceLabel}</dt>
                <dd>
                  {previewVariance === 0 ? (
                    <Badge tone="success">{s.cashMatchedBadge}</Badge>
                  ) : (
                    <Badge tone="danger">
                      {s.cashDifferencePrefix}
                      <Money poisha={previewVariance} />
                    </Badge>
                  )}
                </dd>
              </div>
            ) : null}
          </dl>
          <DrawerBreakdownVisual
            derived={derived}
            expectedPoisha={previewExpected ?? derived.expectedCashPoisha}
            countedPoisha={countedPoisha}
            variancePoisha={previewVariance}
          />
          <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-text-muted">
            {derived.exclusionsBn.map((line) => (
              <li key={line}>{line}</li>
            ))}
            <li>{s.cashExclusionExtra}</li>
          </ul>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-text-muted">{s.cashDateField}</span>
              <input type="text" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
            </label>
            <TakaField label={s.cashOpeningField} value={opening} onChange={setOpening} />
            <TakaField label={s.cashCountedField} value={counted} onChange={setCounted} />
            <TakaField label={s.cashToleranceField} value={tolerance} onChange={setTolerance} />
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-text-muted">
              {s.cashNoteField}
              {noteRequired ? <span className="text-danger">{s.cashNoteRequired}</span> : s.cashNoteOptional}
            </span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className={inputClass}
              placeholder={s.cashNotePlaceholder}
            />
          </label>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <TakaField label={s.cashBkashExpected} value={bkashExpected} onChange={setBkashExpected} />
        <TakaField label={s.cashBkashActual} value={bkashActual} onChange={setBkashActual} />
        <TakaField label={s.cashNagadExpected} value={nagadExpected} onChange={setNagadExpected} />
        <TakaField label={s.cashNagadActual} value={nagadActual} onChange={setNagadActual} />
        <TakaField label={s.cashCodExpected} value={codExpected} onChange={setCodExpected} />
        <TakaField label={s.cashCodActual} value={codActual} onChange={setCodActual} />
        <TakaField label={s.cashDueField} value={customerDue} onChange={setCustomerDue} />
      </div>

      {error ? (
        <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
      ) : null}
      <Button type="button" onClick={() => void submit()} loading={submitting}>
        {s.cashSubmit}
      </Button>

      {closing ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-sm font-semibold text-text-main">{interpolate(s.cashSavedTitle, { date: formatDate(closing.date, locale) })}</h3>
            {closing.hasMismatch ? (
              <Badge tone="danger">
                {interpolate(s.cashMismatchChannels, {
                  channels: closing.mismatchChannels.map((c) => CHANNEL_LABELS[c]).join(", "),
                })}
              </Badge>
            ) : (
              <Badge tone="success">{s.cashAllMatched}</Badge>
            )}
          </div>
          <DataTable
            columns={[
              { key: "channel", header: s.cashColChannel },
              { key: "expected", header: s.cashColExpected },
              { key: "actual", header: s.cashColActual },
              { key: "difference", header: s.cashColDifference },
              { key: "status", header: s.cashColStatus },
            ]}
            rows={resultRows}
          />
          <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
            <div className="rounded-xl border border-border bg-surface-2 p-3">
              <p className="text-xs text-text-muted">{s.cashTotalExpected}</p>
              <p className="mt-1"><Money poisha={closing.totalExpectedPoisha} /></p>
            </div>
            <div className="rounded-xl border border-border bg-surface-2 p-3">
              <p className="text-xs text-text-muted">{s.cashTotalActual}</p>
              <p className="mt-1"><Money poisha={closing.totalActualPoisha} /></p>
            </div>
            <div className="rounded-xl border border-border bg-surface-2 p-3">
              <p className="text-xs text-text-muted">{s.cashTotalDifference}</p>
              <p className="mt-1"><Money poisha={closing.totalDifferencePoisha} /></p>
            </div>
          </div>
          <p className="text-sm text-text-muted">
            {s.cashMemo1}
            <Money poisha={closing.customerDuePoisha} />
            {s.cashMemo2}
          </p>
        </div>
      ) : null}

      <div>
        <h3 className="mb-2 font-display text-sm font-semibold text-text-main">{s.cashPrevTitle}</h3>
        {recentClosings.length > 0 ? (
          <DataTable
            columns={[
              { key: "date", header: s.cashColDate },
              { key: "status", header: s.cashColStatus },
              { key: "difference", header: s.cashColTotalDiff },
              { key: "savedAt", header: s.cashColSavedAt },
            ]}
            rows={recentClosings.map((c) => ({
              date: formatDate(c.date, locale),
              status: c.hasMismatch ? (
                <Badge tone="danger">{s.cashMismatchBadge}</Badge>
              ) : (
                <Badge tone="success">{s.cashMatchedBadge}</Badge>
              ),
              difference: <Money poisha={c.totalDifferencePoisha} />,
              savedAt: <span className="font-mono text-xs">{c.createdAt.slice(0, 16).replace("T", " ")}</span>,
            }))}
          />
        ) : (
          <EmptyState title={s.cashPrevEmptyTitle} description={s.cashPrevEmptyDesc} />
        )}
      </div>
    </div>
  );
}
