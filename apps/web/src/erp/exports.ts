/**
 * Accounting exports — ADV-11 remainder (doc 22): Tally import XML
 * and QuickBooks journal CSV, built from POSTED ErpJournalEntry rows
 * over a chosen business-date range (entry.date, Asia/Dhaka).
 *
 * MONEY: entries are integer poisha; both formats want BDT decimals.
 * Conversion happens ONLY here, at the file boundary, with exact
 * integer string math (the poishaToBdtDecimal algorithm from
 * src/payments/live-store.ts) — never float division/rounding.
 *
 * ATTRIBUTION: report exports carry a `#` watermark header (see
 * src/reports/builder.ts). Machine-import files cannot carry that
 * block without breaking their parsers, so:
 *  - Tally XML: attribution is an XML comment in the prolog (valid,
 *    ignored by Tally).
 *  - QuickBooks CSV: attribution is ONE leading `#` comment row.
 *    QuickBooks Online's importer treats the FIRST row as the header,
 *    so that comment row must be deleted before import — the admin
 *    panel says so next to the download button.
 *
 * TALLY FORMAT NOTES: the standard import envelope
 * (ENVELOPE/HEADER/BODY/IMPORTDATA/REQUESTDATA/TALLYMESSAGE/VOUCHER,
 * VCHTYPE "Journal"). Ledger names are the chart's English names —
 * the ledgers must already exist in the Tally company under those
 * names. Amount sign convention per Tally's own exports: a DEBIT
 * line carries a NEGATIVE amount with ISDEEMEDPOSITIVE "Yes"; a
 * CREDIT line carries a positive amount with ISDEEMEDPOSITIVE "No".
 *
 * QUICKBOOKS FORMAT NOTES: one row per journal line, grouped by a
 * shared JournalNo (the ERP entry id, so an export row always traces
 * back to the journal). Columns: Date (MM/DD/YYYY, the QBO import
 * sample's format), JournalNo, Account (chart English name), Debit,
 * Credit — the unused side is left BLANK, never 0.00 (QBO rejects
 * two-sided lines) — Memo carries the entry description on every row.
 */
import type { Account, JournalEntry } from "./types";

/* ------------------------------------------------------------------ */
/* Boundary helpers                                                    */
/* ------------------------------------------------------------------ */

/** 1910 poisha -> "19.10" — exact integer math, always 2dp. */
export function poishaToBdtString(poisha: number): string {
  if (!Number.isSafeInteger(poisha) || poisha < 0) {
    throw new Error(`poishaToBdtString: not a non-negative integer poisha amount: ${poisha}`);
  }
  const taka = Math.floor(poisha / 100);
  const rest = poisha % 100;
  return `${taka}.${rest.toString().padStart(2, "0")}`;
}

/** "2026-10-05 14:03:22 (Asia/Dhaka)" style stamp for attribution. */
export function dhakaTimestampText(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

export function filterPostedInRange(entries: JournalEntry[], from: string, to: string): JournalEntry[] {
  return entries.filter((e) => e.status === "posted" && e.date >= from && e.date <= to);
}

function accountName(accounts: Account[], code: string): string {
  return accounts.find((a) => a.code === code)?.nameEn ?? code;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** A comment-safe single line (no newlines, no "--" for XML). */
function commentSafe(value: string): string {
  return value.replace(/\n/g, " ").replace(/--/g, "-").trim();
}

export interface AccountingExportContext {
  entries: JournalEntry[]; // already range-filtered, POSTED only
  accounts: Account[];
  from: string;
  to: string;
  exportedBy: string;
  exportedAt: Date;
  reason: string;
}

/* ------------------------------------------------------------------ */
/* Tally import XML                                                    */
/* ------------------------------------------------------------------ */

export function buildTallyXml(ctx: AccountingExportContext): string {
  const comment =
    `<!-- Advance Ecommerce — Tally journal export | exported-by: ${commentSafe(ctx.exportedBy)}` +
    ` | exported-at: ${dhakaTimestampText(ctx.exportedAt)} (Asia/Dhaka)` +
    ` | reason: ${commentSafe(ctx.reason)}` +
    ` | range: ${ctx.from}..${ctx.to} | entries: ${ctx.entries.length} | amounts: BDT -->`;
  const messages = ctx.entries
    .map((entry) => {
      const tallyDate = entry.date.replace(/-/g, "");
      const lines = entry.lines
        .map((line) => {
          const isDebit = line.debitPoisha > 0;
          const amount = poishaToBdtString(isDebit ? line.debitPoisha : line.creditPoisha);
          return [
            "          <ALLLEDGERENTRIES.LIST>",
            `            <LEDGERNAME>${xmlEscape(accountName(ctx.accounts, line.accountCode))}</LEDGERNAME>`,
            `            <ISDEEMEDPOSITIVE>${isDebit ? "Yes" : "No"}</ISDEEMEDPOSITIVE>`,
            `            <AMOUNT>${isDebit ? `-${amount}` : amount}</AMOUNT>`,
            "          </ALLLEDGERENTRIES.LIST>",
          ].join("\n");
        })
        .join("\n");
      return [
        '    <TALLYMESSAGE xmlns:UDF="TallyUDF">',
        '      <VOUCHER VCHTYPE="Journal" ACTION="Create" OBJVIEW="Accounting Voucher View">',
        `        <DATE>${tallyDate}</DATE>`,
        `        <EFFECTIVEDATE>${tallyDate}</EFFECTIVEDATE>`,
        "        <VOUCHERTYPENAME>Journal</VOUCHERTYPENAME>",
        `        <VOUCHERNUMBER>${xmlEscape(entry.id)}</VOUCHERNUMBER>`,
        `        <NARRATION>${xmlEscape(entry.description)}</NARRATION>`,
        lines,
        "      </VOUCHER>",
        "    </TALLYMESSAGE>",
      ].join("\n");
    })
    .join("\n");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    comment,
    "<ENVELOPE>",
    "  <HEADER>",
    "    <TALLYREQUEST>Import Data</TALLYREQUEST>",
    "  </HEADER>",
    "  <BODY>",
    "    <IMPORTDATA>",
    "      <REQUESTDESC>",
    "        <REPORTNAME>Vouchers</REPORTNAME>",
    "      </REQUESTDESC>",
    "      <REQUESTDATA>",
    messages,
    "      </REQUESTDATA>",
    "    </IMPORTDATA>",
    "  </BODY>",
    "</ENVELOPE>",
    "",
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/* QuickBooks journal CSV                                              */
/* ------------------------------------------------------------------ */

/** "2026-10-05" -> "10/05/2026" (the QBO journal-import date format). */
function qbDate(ymd: string): string {
  const [year, month, day] = ymd.split("-");
  return `${month}/${day}/${year}`;
}

export function buildQuickBooksCsv(ctx: AccountingExportContext): string {
  const comment =
    `# Advance Ecommerce — QuickBooks journal export | exported-by: ${commentSafe(ctx.exportedBy)}` +
    ` | exported-at: ${dhakaTimestampText(ctx.exportedAt)} (Asia/Dhaka)` +
    ` | reason: ${commentSafe(ctx.reason)}` +
    ` | range: ${ctx.from}..${ctx.to} | entries: ${ctx.entries.length} | amounts: BDT` +
    ` | NOTE: delete this comment row before importing into QuickBooks (row 1 must be the header)`;
  const header = "Date,JournalNo,Account,Debit,Credit,Memo";
  const rows: string[] = [];
  for (const entry of ctx.entries) {
    for (const line of entry.lines) {
      rows.push(
        [
          qbDate(entry.date),
          csvEscape(entry.id),
          csvEscape(accountName(ctx.accounts, line.accountCode)),
          line.debitPoisha > 0 ? poishaToBdtString(line.debitPoisha) : "",
          line.creditPoisha > 0 ? poishaToBdtString(line.creditPoisha) : "",
          csvEscape(entry.description),
        ].join(","),
      );
    }
  }
  return [comment, header, ...rows, ""].join("\n");
}
