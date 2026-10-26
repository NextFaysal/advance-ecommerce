/**
 * Payroll-lite — ADV-11 remainder (doc 22). Monthly staff salary runs
 * on top of the ERP-lite ledger, behind the module.erp_lite flag.
 *
 * PERSISTENCE — ONE Setting JSON doc (house pattern: team docs,
 * warehouse pick lists; zod-validated on every read, a corrupt doc
 * reads as empty, never throws):
 *   key "erp.payroll" ->
 *   { version: 1,
 *     salaries: { [userId]: { basicPoisha, houseRentPoisha,
 *                 transportPoisha, otherPoisha, deductionPoisha,
 *                 effectiveFrom ("yyyy-mm") } },
 *     runs: [{ id, month ("yyyy-mm"), lines: [{ userId, name,
 *              grossPoisha, deductionPoisha, netPoisha }],
 *              totalPoisha, status: DRAFT | FINALIZED,
 *              journalEntryId, createdAt, finalizedAt }] }
 * Runs are capped at 60 (PAYROLL_RUNS_CAP): when a new run would
 * exceed the cap the oldest DRAFT run is dropped first, else the
 * oldest run overall. Salary config is edited as a WHOLE map (PUT
 * replaces it) — omitting a staff member removes their config.
 *
 * RUN CREATION snapshots the CURRENT salary config for ACTIVE staff
 * (team directory derivation) whose effectiveFrom <= run month. The
 * snapshot is the record: later config edits never rewrite a run.
 * gross = basic + houseRent + transport + other; net = gross −
 * deduction (a deduction larger than the gross is rejected at config
 * save time, so a run line can never go negative).
 *
 * FINALIZING posts ONE journal entry through the same machinery as
 * the auto-postings (buildJournalEntry + postEntry + erpStore), with
 * sourceKind "payroll_run" / sourceId = run id — the ErpJournalEntry
 * @@unique([sourceKind, sourceId]) pair makes a finalize retry land
 * on the existing entry instead of double-posting:
 *   Dr 5300 Salary expense            = gross total
 *   Cr 1010 Bank account              = net total (amount paid out)
 *   Cr 2000 Accounts payable          = deductions withheld (if > 0)
 * ACCOUNT CHOICES (deliberate, not invented): 5300 "Salary" exists in
 * the default chart (accounts.ts). The chart has NO dedicated salary-
 * payable account, so withheld deductions credit 2000 "Accounts
 * payable" — the closest existing liability — and the entry
 * description says so. Net pay credits 1010 "Bank account" (the lite
 * flow assumes salaries settle from the bank; a merchant paying cash
 * posts a manual 1010->1000 reclass). A zero-total run finalizes
 * without a journal entry (journalEntryId stays null).
 *
 * The journal post and the Setting-doc write are not one transaction:
 * a crash between them leaves the run DRAFT with the entry posted,
 * and the finalize retry finds that entry (already_posted path) and
 * completes — never a second entry.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "@advance-ecommerce/db";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { assertStaffIds, listTeamStaff, type TeamStaffMember } from "@/team/docs";
import { erpStore } from "./db-store";
import { PeriodLockedError, buildJournalEntry, postEntry } from "./ledger";
import type { JournalLine } from "./types";

export const PAYROLL_SETTING_KEY = "erp.payroll";
export const PAYROLL_RUNS_CAP = 60;
export const ERP_LITE_FLAG = "module.erp_lite";

/** Chart codes used by the finalize posting — see the header note. */
export const PAYROLL_SALARY_EXPENSE_ACCOUNT = "5300"; // Salary (expense)
export const PAYROLL_PAID_FROM_ACCOUNT = "1010"; // Bank account (asset)
export const PAYROLL_DEDUCTIONS_PAYABLE_ACCOUNT = "2000"; // Accounts payable (liability)

export class PayrollError extends Error {
  code: string;
  httpStatus: number;
  details?: unknown;
  constructor(code: string, message: string, httpStatus = 400, details?: unknown) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

/* ------------------------------------------------------------------ */
/* Doc shape                                                           */
/* ------------------------------------------------------------------ */

const monthString = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "month must be yyyy-mm");

export const salaryConfigSchema = z.object({
  basicPoisha: z.number().int().min(0),
  houseRentPoisha: z.number().int().min(0),
  transportPoisha: z.number().int().min(0),
  otherPoisha: z.number().int().min(0),
  deductionPoisha: z.number().int().min(0),
  effectiveFrom: monthString,
});
export type SalaryConfig = z.infer<typeof salaryConfigSchema>;

export const payrollLineSchema = z.object({
  userId: z.string().min(1),
  name: z.string(),
  grossPoisha: z.number().int().min(0),
  deductionPoisha: z.number().int().min(0),
  netPoisha: z.number().int().min(0),
});
export type PayrollLine = z.infer<typeof payrollLineSchema>;

export const payrollRunSchema = z.object({
  id: z.string().min(1),
  month: monthString,
  lines: z.array(payrollLineSchema),
  /** Sum of line NET amounts — what the run actually pays out. */
  totalPoisha: z.number().int().min(0),
  status: z.enum(["DRAFT", "FINALIZED"]),
  journalEntryId: z.string().nullable(),
  createdAt: z.string(),
  finalizedAt: z.string().nullable(),
});
export type PayrollRun = z.infer<typeof payrollRunSchema>;

export const payrollDocSchema = z.object({
  version: z.number().default(1),
  salaries: z.record(z.string(), salaryConfigSchema).default({}),
  runs: z.array(payrollRunSchema).default([]),
});
export type PayrollDoc = z.infer<typeof payrollDocSchema>;

const EMPTY_DOC: PayrollDoc = { version: 1, salaries: {}, runs: [] };

export function grossOf(config: SalaryConfig): number {
  return config.basicPoisha + config.houseRentPoisha + config.transportPoisha + config.otherPoisha;
}

/* ------------------------------------------------------------------ */
/* Setting-doc store (team/docs pattern, category "erp")               */
/* ------------------------------------------------------------------ */

export async function getPayrollDoc(): Promise<PayrollDoc> {
  const row = await prisma.setting.findUnique({ where: { key: PAYROLL_SETTING_KEY } });
  if (!row?.value) return { ...EMPTY_DOC };
  try {
    const parsed = payrollDocSchema.safeParse(JSON.parse(row.value));
    return parsed.success ? parsed.data : { ...EMPTY_DOC };
  } catch {
    return { ...EMPTY_DOC };
  }
}

async function writePayrollDoc(doc: PayrollDoc, actorId: string): Promise<void> {
  const value = JSON.stringify(doc);
  await prisma.setting.upsert({
    where: { key: PAYROLL_SETTING_KEY },
    create: {
      key: PAYROLL_SETTING_KEY,
      value,
      valueEncrypted: false,
      isPublic: false,
      category: "erp",
      description: "ERP payroll document (JSON, ADV-11 payroll-lite)",
      updatedById: actorId,
    },
    update: { value, valueEncrypted: false, updatedById: actorId },
  });
}

export function assertErpLiteEnabled(): void {
  if (!isFeatureEnabled(ERP_LITE_FLAG)) {
    throw new PayrollError(
      "FEATURE_LOCKED",
      "ERP-lite module is locked for this install (module.erp_lite is OFF).",
      403,
    );
  }
}

/* ------------------------------------------------------------------ */
/* Salary config                                                       */
/* ------------------------------------------------------------------ */

/** Replace the whole salary-config map (PUT semantics). */
export async function updateSalaries(
  salaries: Record<string, SalaryConfig>,
  actorId: string,
): Promise<PayrollDoc> {
  assertErpLiteEnabled();
  const userIds = Object.keys(salaries);
  try {
    await assertStaffIds(userIds);
  } catch (err) {
    if (err instanceof Error && "code" in err) {
      const e = err as { code: string; message: string; httpStatus?: number; details?: unknown };
      throw new PayrollError(e.code, e.message, e.httpStatus ?? 400, e.details);
    }
    throw err;
  }
  for (const [userId, config] of Object.entries(salaries)) {
    if (config.deductionPoisha > grossOf(config)) {
      throw new PayrollError(
        "DEDUCTION_EXCEEDS_GROSS",
        `Deduction exceeds gross salary for staff ${userId} — net pay can never be negative.`,
        400,
        { userId },
      );
    }
  }
  const doc = await getPayrollDoc();
  const next: PayrollDoc = { ...doc, salaries };
  await writePayrollDoc(next, actorId);
  return next;
}

/* ------------------------------------------------------------------ */
/* Runs                                                                */
/* ------------------------------------------------------------------ */

function capRuns(runs: PayrollRun[]): PayrollRun[] {
  const capped = [...runs]; // newest first
  while (capped.length > PAYROLL_RUNS_CAP) {
    let dropIdx = -1;
    for (let i = capped.length - 1; i >= 0; i -= 1) {
      if (capped[i]?.status === "DRAFT") {
        dropIdx = i;
        break;
      }
    }
    if (dropIdx === -1) dropIdx = capped.length - 1;
    capped.splice(dropIdx, 1);
  }
  return capped;
}

export async function createPayrollRun(month: string, actorId: string): Promise<PayrollRun> {
  assertErpLiteEnabled();
  const doc = await getPayrollDoc();
  if (doc.runs.some((r) => r.month === month)) {
    throw new PayrollError(
      "DUPLICATE_RUN",
      `A payroll run for ${month} already exists — one run per month.`,
      409,
      { month },
    );
  }
  const staff: TeamStaffMember[] = await listTeamStaff();
  const lines: PayrollLine[] = [];
  for (const member of staff) {
    if (member.status !== "ACTIVE") continue;
    const config = doc.salaries[member.id];
    if (!config) continue;
    if (config.effectiveFrom > month) continue;
    const grossPoisha = grossOf(config);
    lines.push({
      userId: member.id,
      name: member.name || member.email || member.id,
      grossPoisha,
      deductionPoisha: config.deductionPoisha,
      netPoisha: grossPoisha - config.deductionPoisha,
    });
  }
  if (lines.length === 0) {
    throw new PayrollError(
      "NO_ELIGIBLE_STAFF",
      `No ACTIVE staff member has a salary config effective on or before ${month}.`,
      400,
      { month },
    );
  }
  const run: PayrollRun = {
    id: randomUUID(),
    month,
    lines,
    totalPoisha: lines.reduce((s, l) => s + l.netPoisha, 0),
    status: "DRAFT",
    journalEntryId: null,
    createdAt: new Date().toISOString(),
    finalizedAt: null,
  };
  await writePayrollDoc({ ...doc, runs: capRuns([run, ...doc.runs]) }, actorId);
  return run;
}

/** "YYYY-MM-DD" on the Asia/Dhaka calendar (auto-posting pattern). */
function dhakaToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export type PayrollPostResult =
  | { status: "posted"; entryId: string }
  | { status: "already_posted"; entryId: string }
  | { status: "not_required"; entryId: null };

/**
 * The finalize posting — same build/post/append machinery and
 * exactly-once discipline as src/erp/auto-posting.ts, but admin-
 * initiated, so failures SURFACE (PeriodLockedError propagates)
 * instead of being swallowed: an admin finalizing payroll must learn
 * the journal did not post.
 */
async function postPayrollRunJournal(run: PayrollRun): Promise<PayrollPostResult> {
  const grossTotal = run.lines.reduce((s, l) => s + l.grossPoisha, 0);
  const deductionTotal = run.lines.reduce((s, l) => s + l.deductionPoisha, 0);
  const netTotal = run.totalPoisha;
  if (grossTotal <= 0) return { status: "not_required", entryId: null };

  const existing = await prisma.erpJournalEntry.findFirst({
    where: { sourceKind: "payroll_run", sourceId: run.id },
    select: { id: true },
  });
  if (existing) return { status: "already_posted", entryId: existing.id };

  const lines: JournalLine[] = [
    { accountCode: PAYROLL_SALARY_EXPENSE_ACCOUNT, debitPoisha: grossTotal, creditPoisha: 0 },
  ];
  if (netTotal > 0) {
    lines.push({ accountCode: PAYROLL_PAID_FROM_ACCOUNT, debitPoisha: 0, creditPoisha: netTotal });
  }
  if (deductionTotal > 0) {
    lines.push({
      accountCode: PAYROLL_DEDUCTIONS_PAYABLE_ACCOUNT,
      debitPoisha: 0,
      creditPoisha: deductionTotal,
    });
  }
  const periods = await erpStore.listPeriods();
  const posted = postEntry(
    buildJournalEntry(
      {
        date: dhakaToday(),
        description:
          `Payroll ${run.month} finalized — Dr ${PAYROLL_SALARY_EXPENSE_ACCOUNT} Salary (gross), ` +
          `Cr ${PAYROLL_PAID_FROM_ACCOUNT} Bank (net paid)` +
          (deductionTotal > 0
            ? `, Cr ${PAYROLL_DEDUCTIONS_PAYABLE_ACCOUNT} Accounts payable (deductions withheld; no dedicated salary-payable account in the chart)`
            : ""),
        lines,
        sourceKind: "payroll_run",
        sourceId: run.id,
      },
      new Date(),
    ),
    periods,
  );
  const stored = await erpStore.appendEntry(posted);
  return { status: "posted", entryId: stored.id };
}

export async function finalizePayrollRun(
  runId: string,
  actorId: string,
): Promise<{ run: PayrollRun; journal: PayrollPostResult }> {
  assertErpLiteEnabled();
  const doc = await getPayrollDoc();
  const run = doc.runs.find((r) => r.id === runId);
  if (!run) throw new PayrollError("RUN_NOT_FOUND", `Payroll run ${runId} not found.`, 404);
  if (run.status === "FINALIZED") {
    throw new PayrollError("ALREADY_FINALIZED", `Payroll run for ${run.month} is already finalized.`, 409);
  }
  let journal: PayrollPostResult;
  try {
    journal = await postPayrollRunJournal(run);
  } catch (err) {
    if (err instanceof PeriodLockedError) {
      throw new PayrollError("PERIOD_LOCKED", err.message, 409);
    }
    throw err;
  }
  const finalized: PayrollRun = {
    ...run,
    status: "FINALIZED",
    journalEntryId: journal.entryId,
    finalizedAt: new Date().toISOString(),
  };
  const runs = doc.runs.map((r) => (r.id === runId ? finalized : r));
  await writePayrollDoc({ ...doc, runs }, actorId);
  return { run: finalized, journal };
}

/** Read model for the admin page / panel: doc + staff directory. */
export async function getPayrollReadModel(): Promise<{
  doc: PayrollDoc;
  staff: TeamStaffMember[];
}> {
  const [doc, staff] = await Promise.all([getPayrollDoc(), listTeamStaff()]);
  return { doc, staff };
}
