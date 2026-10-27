"use client";

/**
 * Payroll-lite panel (ADV-11 remainder) — a section on the ERP page.
 * Talks to /api/v1/admin/modules/erp-payroll (+ /runs, /runs/finalize).
 *
 * Money inputs are BDT decimal strings (e.g. "45000.50") converted to
 * integer poisha with EXACT string parsing before anything is sent —
 * the API only ever sees poisha. Salary config saves as a whole map:
 * a staff row left completely blank is sent as "no config" (removes
 * any existing config for that person).
 *
 * One shared "reason" field feeds every mutation on this panel —
 * salaries update, run create and run finalize all require one and
 * are audited server-side.
 */
import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { ERP_STRINGS } from "./strings";

interface StaffRow {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
}
interface SalaryConfigDto {
  basicPoisha: number;
  houseRentPoisha: number;
  transportPoisha: number;
  otherPoisha: number;
  deductionPoisha: number;
  effectiveFrom: string;
}
interface PayrollLineDto {
  userId: string;
  name: string;
  grossPoisha: number;
  deductionPoisha: number;
  netPoisha: number;
}
interface PayrollRunDto {
  id: string;
  month: string;
  lines: PayrollLineDto[];
  totalPoisha: number;
  status: "DRAFT" | "FINALIZED";
  journalEntryId: string | null;
  createdAt: string;
  finalizedAt: string | null;
}
interface SalaryDraft {
  basic: string;
  houseRent: string;
  transport: string;
  other: string;
  deduction: string;
  effectiveFrom: string;
}

const EMPTY_DRAFT: SalaryDraft = { basic: "", houseRent: "", transport: "", other: "", deduction: "", effectiveFrom: "" };

function poishaToInput(poisha: number): string {
  const taka = Math.floor(poisha / 100);
  const rest = poisha % 100;
  return `${taka}.${rest.toString().padStart(2, "0")}`;
}

function parseBdtInput(raw: string): number | null {
  const text = raw.trim();
  if (text === "") return 0;
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const taka = Number(match[1]);
  const frac = match[2] === undefined ? 0 : Number(match[2].padEnd(2, "0"));
  const poisha = taka * 100 + frac;
  return Number.isSafeInteger(poisha) ? poisha : null;
}

function formatPoisha(poisha: number): string {
  return `৳${(poisha / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

const inputCls =
  "w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text";
const labelCls = "block text-xs text-text-muted";

export function PayrollPanel() {
  const { locale } = useLocale();
  const s = pick(locale, ERP_STRINGS);
  const [locked, setLocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, SalaryDraft>>({});
  const [runs, setRuns] = useState<PayrollRunDto[]>([]);
  const [reason, setReason] = useState("");
  const [runMonth, setRunMonth] = useState(currentMonth());
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/admin/modules/erp-payroll");
      const json = (await res.json().catch(() => ({}))) as {
        data?: { salaries: Record<string, SalaryConfigDto>; runs: PayrollRunDto[]; staff: StaffRow[] };
        error?: { code: string; message: string };
      };
      if (!res.ok) {
        if (json.error?.code === "FEATURE_LOCKED") {
          setLocked(true);
          return;
        }
        setError(json.error?.message ?? s.prLoadFailed);
        return;
      }
      const data = json.data;
      if (!data) return;
      setStaff(data.staff);
      setRuns(data.runs);
      const nextDrafts: Record<string, SalaryDraft> = {};
      for (const member of data.staff) {
        const config = data.salaries[member.id];
        nextDrafts[member.id] = config
          ? {
              basic: poishaToInput(config.basicPoisha),
              houseRent: poishaToInput(config.houseRentPoisha),
              transport: poishaToInput(config.transportPoisha),
              other: poishaToInput(config.otherPoisha),
              deduction: poishaToInput(config.deductionPoisha),
              effectiveFrom: config.effectiveFrom,
            }
          : { ...EMPTY_DRAFT };
      }
      setDrafts(nextDrafts);
    } finally {
      setLoading(false);
    }
  }, [s]);

  useEffect(() => {
    void load();
  }, [load]);

  function requireReason(): boolean {
    if (reason.trim() === "") {
      setError(s.prReasonRequired);
      return false;
    }
    setError(null);
    return true;
  }

  async function saveSalaries() {
    if (!requireReason()) return;
    const salaries: Record<string, SalaryConfigDto> = {};
    for (const member of staff) {
      const draft = drafts[member.id] ?? EMPTY_DRAFT;
      const allBlank = [draft.basic, draft.houseRent, draft.transport, draft.other, draft.deduction].every(
        (v) => v.trim() === "",
      );
      if (allBlank) continue; // no config for this staff member
      const basic = parseBdtInput(draft.basic);
      const houseRent = parseBdtInput(draft.houseRent);
      const transport = parseBdtInput(draft.transport);
      const other = parseBdtInput(draft.other);
      const deduction = parseBdtInput(draft.deduction);
      if (basic === null || houseRent === null || transport === null || other === null || deduction === null) {
        setError(interpolate(s.prAmountFormat, { name: member.name || member.email }));
        return;
      }
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(draft.effectiveFrom)) {
        setError(interpolate(s.prEffectiveRequired, { name: member.name || member.email }));
        return;
      }
      salaries[member.id] = {
        basicPoisha: basic,
        houseRentPoisha: houseRent,
        transportPoisha: transport,
        otherPoisha: other,
        deductionPoisha: deduction,
        effectiveFrom: draft.effectiveFrom,
      };
    }
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/v1/admin/modules/erp-payroll", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ salaries, reason: reason.trim() }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: { message: string } };
      if (!res.ok) {
        setError(json.error?.message ?? s.prSaveFailed);
        return;
      }
      setNotice(s.prSaved);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function createRun() {
    if (!requireReason()) return;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(runMonth)) {
      setError(s.prRunMonthInvalid);
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/v1/admin/modules/erp-payroll/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: runMonth, reason: reason.trim() }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: { message: string } };
      if (!res.ok) {
        setError(json.error?.message ?? s.prRunCreateFailed);
        return;
      }
      setNotice(interpolate(s.prRunCreated, { month: runMonth }));
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function finalizeRun(run: PayrollRunDto) {
    if (!requireReason()) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/v1/admin/modules/erp-payroll/runs/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: run.id, reason: reason.trim() }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        data?: { journal: { status: string } };
        error?: { message: string };
      };
      if (!res.ok) {
        setError(json.error?.message ?? s.prFinalizeFailed);
        return;
      }
      setNotice(
        json.data?.journal.status === "not_required"
          ? interpolate(s.prFinalizedZero, { month: run.month })
          : interpolate(s.prFinalizedPosted, { month: run.month }),
      );
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (locked) {
    return (
      <section>
        <h2 className="mb-3 mt-8 text-lg font-semibold">{s.prTitle}</h2>
        <p className="rounded-md bg-surface-2 px-3 py-2 text-sm text-text-muted">
          {s.prLockedNote}
        </p>
      </section>
    );
  }

  return (
    <section>
      <h2 className="mb-3 mt-8 text-lg font-semibold">{s.prTitle}</h2>
      <p className="mb-3 max-w-3xl text-sm text-text-muted">
        {s.prIntro}
      </p>

      {error ? (
        <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}
      {notice ? (
        <p className="mb-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</p>
      ) : null}

      <div className="mb-4 max-w-md">
        <label className={labelCls} htmlFor="payroll-reason">{s.prReasonLabel}</label>
        <input
          id="payroll-reason"
          className={inputCls}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={s.prReasonPlaceholder}
        />
      </div>

      <h3 className="mb-2 text-base font-semibold">{s.prConfigTitle}</h3>
      {loading ? (
        <p className="text-sm text-text-muted">{s.prLoading}</p>
      ) : staff.length === 0 ? (
        <p className="text-sm text-text-muted">{s.prNoStaff}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-text-muted">
                <th className="py-2 pr-2">{s.colStaff}</th>
                <th className="py-2 pr-2">{s.colBasic}</th>
                <th className="py-2 pr-2">{s.colHouseRent}</th>
                <th className="py-2 pr-2">{s.colTransport}</th>
                <th className="py-2 pr-2">{s.colOther}</th>
                <th className="py-2 pr-2">{s.colDeduction}</th>
                <th className="py-2">{s.colEffective}</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((member) => {
                const draft = drafts[member.id] ?? EMPTY_DRAFT;
                const set = (patch: Partial<SalaryDraft>) =>
                  setDrafts((prev) => ({ ...prev, [member.id]: { ...(prev[member.id] ?? EMPTY_DRAFT), ...patch } }));
                const moneyInput = (field: keyof SalaryDraft) => (
                  <input
                    className={inputCls}
                    inputMode="decimal"
                    placeholder="0.00"
                    value={draft[field]}
                    onChange={(e) => set({ [field]: e.target.value } as Partial<SalaryDraft>)}
                  />
                );
                return (
                  <tr key={member.id} className="border-b border-border align-top">
                    <td className="py-2 pr-2">
                      <span className="font-medium">{member.name || member.email}</span>
                      <span className="block text-xs text-text-muted">
                        {member.role} · {member.status}
                      </span>
                    </td>
                    <td className="py-2 pr-2">{moneyInput("basic")}</td>
                    <td className="py-2 pr-2">{moneyInput("houseRent")}</td>
                    <td className="py-2 pr-2">{moneyInput("transport")}</td>
                    <td className="py-2 pr-2">{moneyInput("other")}</td>
                    <td className="py-2 pr-2">{moneyInput("deduction")}</td>
                    <td className="py-2">
                      <input
                        type="month"
                        className={inputCls}
                        value={draft.effectiveFrom}
                        onChange={(e) => set({ effectiveFrom: e.target.value })}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <button
        type="button"
        disabled={busy || loading}
        onClick={() => void saveSalaries()}
        className="mt-3 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {s.prSaveConfigBtn}
      </button>
      <p className="mt-1 text-xs text-text-muted">
        {s.prReplaceWarning}
      </p>

      <h3 className="mb-2 mt-8 text-base font-semibold">{s.prRunsTitle}</h3>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div>
          <label className={labelCls} htmlFor="payroll-run-month">{s.prRunMonthLabel}</label>
          <input
            id="payroll-run-month"
            type="month"
            className={inputCls}
            value={runMonth}
            onChange={(e) => setRunMonth(e.target.value)}
          />
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void createRun()}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {s.prCreateRunBtn}
        </button>
        <span className="text-xs text-text-muted">{s.prOneRunNote}</span>
      </div>

      {runs.length === 0 ? (
        <p className="text-sm text-text-muted">{s.prNoRuns}</p>
      ) : (
        <div className="space-y-3">
          {runs.map((run) => (
            <div key={run.id} className="rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm">
                  <span className="font-mono font-semibold">{run.month}</span>{" "}
                  <span
                    className={`rounded px-2 py-0.5 text-xs ${run.status === "FINALIZED" ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}
                  >
                    {run.status === "FINALIZED" ? s.prFinalized : s.prDraft}
                  </span>{" "}
                  <span className="text-text-muted">
                    {interpolate(s.prRunMeta, { count: run.lines.length, total: formatPoisha(run.totalPoisha) })}
                    {run.journalEntryId ? interpolate(s.prJournalSuffix, { id: run.journalEntryId }) : ""}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setExpandedRunId(expandedRunId === run.id ? null : run.id)}
                    className="rounded-md border border-border px-3 py-1.5 text-sm"
                  >
                    {expandedRunId === run.id ? s.prHideDetails : s.prShowDetails}
                  </button>
                  {run.status === "DRAFT" ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void finalizeRun(run)}
                      className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                    >
                      {s.prFinalizeBtn}
                    </button>
                  ) : null}
                </div>
              </div>
              {expandedRunId === run.id ? (
                <table className="mt-3 w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-text-muted">
                      <th className="py-1.5 pr-2">{s.colStaff}</th>
                      <th className="py-1.5 pr-2">{s.colGross}</th>
                      <th className="py-1.5 pr-2">{s.colDeduction}</th>
                      <th className="py-1.5 pr-2">{s.colNet}</th>
                      <th className="py-1.5">{s.colPayslip}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {run.lines.map((line) => (
                      <tr key={line.userId} className="border-b border-border">
                        <td className="py-1.5 pr-2">{line.name}</td>
                        <td className="py-1.5 pr-2">{formatPoisha(line.grossPoisha)}</td>
                        <td className="py-1.5 pr-2">{formatPoisha(line.deductionPoisha)}</td>
                        <td className="py-1.5 pr-2 font-medium">{formatPoisha(line.netPoisha)}</td>
                        <td className="py-1.5">
                          <a
                            className="text-primary underline"
                            href={`/admin/erp/payslip/${run.id}/${line.userId}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {s.prPrint}
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
