/**
 * Call-center retention — ops script (C7 hardening, plan doc 15 R6.2).
 *
 * Run (from apps/web):
 *   npx tsx scripts/callcenter-retention.ts --dry-run   # report only
 *   npx tsx scripts/callcenter-retention.ts             # real scrub
 *
 * What it does:
 *   Calls anonymizeExpiredCallData() (src/callcenter/retention.ts):
 *   call-log free text (note/qaComment) and terminal-task PII (full
 *   phone, customer name, note) older than the Settings window
 *   `call_center.log_retention_months` (default 12) are nulled.
 *   Outcomes, dispositions, QA scores and timestamps are kept, so
 *   reporting history survives.
 *
 * Scheduling: until the VPS worker host exists this is run by hand;
 * afterwards a cron/worker job calls this same script — the policy
 * lives in retention.ts, not here.
 *
 * Safety rules:
 *   - DATABASE_URL comes from the environment only; it is never
 *     printed and no default address is invented.
 *   - --dry-run writes NOTHING and prints exactly what a real run
 *     would scrub.
 *   - Expected failures print a short bilingual message and exit 1 —
 *     no stack traces.
 */
import { anonymizeExpiredCallData } from "@/callcenter/retention";

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  if (!process.env.DATABASE_URL) {
    console.error(
      "DATABASE_URL সেট করা নেই। .env.local বা সার্ভার env-এ সেট করুন — এই স্ক্রিপ্ট কোনো ডিফল্ট ঠিকানা বানায় না। / DATABASE_URL is not set. Set it in .env.local or the server env — this script never invents a default with credentials.",
    );
    process.exit(1);
  }
  const result = await anonymizeExpiredCallData(new Date(), { dryRun });
  console.log(
    `[callcenter-retention] ${result.dryRun ? "DRY RUN — nothing written" : "scrubbed"}: ` +
      `logs=${result.logsScrubbed} tasks=${result.tasksScrubbed} ` +
      `(window=${result.retentionMonths} months, cutoff=${result.cutoff.toISOString()})`,
  );
}

main().catch((err: unknown) => {
  console.error(
    `[callcenter-retention] ❌ অপ্রত্যাশিত ত্রুটি / Unexpected error: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
});
