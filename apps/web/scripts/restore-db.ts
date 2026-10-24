/**
 * Database restore — ops script (execution plan Step 35).
 *
 * ⚠️ DESTRUCTIVE. Restoring runs pg_restore --clean --if-exists: it
 * DROPS existing objects in the target database before recreating
 * them from the dump. That is why this script refuses to do anything
 * without BOTH an explicit dump file AND an explicit --confirm flag.
 *
 * Run:
 *   # Preview only — validates everything, changes nothing:
 *   pnpm --filter web exec tsx scripts/restore-db.ts <dump-file> --dry-run
 *
 *   # Real restore (after the preview, on purpose):
 *   pnpm --filter web exec tsx scripts/restore-db.ts <dump-file> --confirm
 *
 * Safety rules:
 *   - No --confirm → prints exactly what WOULD run (redacted) and
 *     exits 1. There is no default dump file and no way to restore
 *     "the latest" implicitly — the file is always named explicitly.
 *   - PRODUCTION GUARD: if the target database name contains "prod"
 *     (case-insensitive), the script refuses in every mode unless
 *     --allow-production is ALSO passed. Restoring over production
 *     must be a deliberate, typed-out decision — see the runbook
 *     (docs/RUNBOOK-LOCAL.md §11) before ever using that flag.
 *   - If a `<dump>.sha256` sidecar sits next to the dump (backup-db.ts
 *     writes one), the checksum is verified first; a mismatch refuses.
 *     A missing sidecar only warns — it never silently passes.
 *   - DATABASE_URL is never printed (display shape only:
 *     postgresql://***@host:port/dbname) and the password reaches
 *     pg_restore via the PGPASSWORD env var, not the command line.
 *   - Expected failures print a short bilingual (Bangla + English)
 *     message and exit 1 — no stack traces.
 */

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";

/** An expected, user-facing failure: message is bilingual, no stack. */
class Fail extends Error {}

const argv = process.argv.slice(2);
const CONFIRM = argv.includes("--confirm");
const DRY_RUN = argv.includes("--dry-run");
const ALLOW_PRODUCTION = argv.includes("--allow-production");
const dumpArg = argv.find((a) => !a.startsWith("--"));

/* ------------------------------------------------------------------ */
/* Connection handling — the password never reaches stdout           */
/* (same approach as scripts/backup-db.ts)                           */
/* ------------------------------------------------------------------ */

interface DbTarget {
  display: string;
  dbName: string;
  mode: "flags" | "uri";
  args: string[];
  env: Record<string, string>;
}

function parseDatabaseUrl(raw: string): DbTarget {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Fail(
      "DATABASE_URL ঠিকমতো পড়া যাচ্ছে না (ভুল ফরম্যাট)। / DATABASE_URL could not be parsed — check its format in your env file.",
    );
  }
  const host = url.hostname || "localhost";
  const port = url.port || "5432";
  const dbName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!dbName) {
    throw new Fail(
      "DATABASE_URL-এ ডাটাবেসের নাম নেই। / DATABASE_URL has no database name in its path.",
    );
  }
  const display = `${url.protocol}//***@${host}:${port}/${dbName}`;
  const password = decodeURIComponent(url.password);
  const username = decodeURIComponent(url.username);

  const params = new Set(url.searchParams.keys());
  const expressible = new Set(["schema", "sslmode"]);
  const hasForeignParams = [...params].some((p) => !expressible.has(p));

  if (hasForeignParams) {
    return { display, dbName, mode: "uri", args: [raw], env: {} };
  }
  const env: Record<string, string> = {};
  if (password) env.PGPASSWORD = password;
  const sslmode = url.searchParams.get("sslmode");
  if (sslmode) env.PGSSLMODE = sslmode;
  return {
    display,
    dbName,
    mode: "flags",
    args: ["-h", host, "-p", port, "-U", username, "-d", dbName],
    env,
  };
}

function requireDatabaseUrl(): DbTarget {
  const raw = process.env.DATABASE_URL;
  if (!raw || raw.trim() === "") {
    throw new Fail(
      "DATABASE_URL সেট করা নেই। .env.local বা সার্ভার env-এ সেট করুন — এই স্ক্রিপ্ট কোনো ডিফল্ট ঠিকানা বানায় না। / DATABASE_URL is not set. Set it in .env.local or the server env — this script never invents a default with credentials.",
    );
  }
  return parseDatabaseUrl(raw);
}

/* ------------------------------------------------------------------ */
/* Helpers                                                           */
/* ------------------------------------------------------------------ */

function pgToolVersion(tool: "pg_restore"): string {
  const res = spawnSync(tool, ["--version"], { encoding: "utf8" });
  if (res.error || res.status !== 0) {
    throw new Fail(
      `${tool} পাওয়া যাচ্ছে না (PATH-এ নেই)। postgresql-client ইনস্টল করুন (যেমন: apt install postgresql-client), অথবা Docker-এর postgres ইমেজের ভেতরে চালান। / ${tool} was not found on PATH. Install postgresql-client (e.g. apt install postgresql-client) or run inside the Docker postgres image.`,
    );
  }
  return (res.stdout || "").trim();
}

function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function runPgRestore(args: string[], env: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn("pg_restore", args, {
      env: { ...process.env, ...env },
      stdio: ["ignore", "inherit", "inherit"],
    });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

/** The command as it may be shown to a human — password never in it. */
function printableCommand(target: DbTarget, dumpFile: string): string {
  const conn =
    target.mode === "uri" ? target.display : target.args.join(" ");
  return `PGPASSWORD=*** pg_restore --clean --if-exists ${conn} ${dumpFile}`;
}

/* ------------------------------------------------------------------ */
/* Validation steps                                                  */
/* ------------------------------------------------------------------ */

async function validateDumpFile(dumpFile: string): Promise<void> {
  let info;
  try {
    info = await stat(dumpFile);
  } catch {
    throw new Fail(
      `ডাম্প ফাইল পাওয়া যায়নি: ${dumpFile} / Dump file not found: ${dumpFile}`,
    );
  }
  if (!info.isFile()) {
    throw new Fail(
      `ডাম্প পাথটি কোনো ফাইল নয়: ${dumpFile} / The dump path is not a file: ${dumpFile}`,
    );
  }
  try {
    await access(dumpFile, fsConstants.R_OK);
  } catch {
    throw new Fail(
      `ডাম্প ফাইল পড়া যাচ্ছে না (permission): ${dumpFile} / Dump file is not readable: ${dumpFile}`,
    );
  }
  console.log(
    `[restore] ডাম্প ফাইল / Dump file: ${dumpFile} (${info.size} bytes)`,
  );

  const sidecar = `${dumpFile}.sha256`;
  let expected: string | null = null;
  try {
    const text = await readFile(sidecar, "utf8");
    expected = (text.trim().split(/\s+/)[0] ?? "").toLowerCase() || null;
  } catch {
    expected = null;
  }
  if (expected) {
    const actual = await sha256File(dumpFile);
    if (actual.toLowerCase() !== expected) {
      throw new Fail(
        `চেকসাম মিলছে না — ডাম্প ফাইলটি বদলে গেছে বা নষ্ট হয়েছে, রিস্টোর বাতিল। প্রত্যাশিত / Checksum mismatch — the dump has changed or is corrupted; restore refused. Expected ${expected}, got ${actual}.`,
      );
    }
    console.log("[restore] চেকসাম যাচাই হয়েছে ✓ / Checksum verified ✓");
  } else {
    console.log(
      "[restore] ⚠️ পাশে .sha256 চেকসাম ফাইল নেই — অখণ্ডতা যাচাই করা গেল না। / No .sha256 sidecar next to the dump — integrity could not be verified.",
    );
  }
}

/* ------------------------------------------------------------------ */
/* Main                                                              */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  if (!dumpArg) {
    console.error(
      "[restore] ব্যবহার / Usage: tsx scripts/restore-db.ts <dump-file> [--dry-run | --confirm] [--allow-production]",
    );
    throw new Fail(
      "কোন ডাম্প ফাইল রিস্টোর হবে তা স্পষ্টভাবে বলতে হবে। / You must name the dump file to restore — there is no default.",
    );
  }
  const dumpFile = path.resolve(dumpArg);
  const target = requireDatabaseUrl();

  console.log(`[restore] টার্গেট / Target: ${target.display}`);

  // Production guard — applies in EVERY mode, including --dry-run, so
  // a preview can never look safer than the real run would be.
  if (target.dbName.toLowerCase().includes("prod") && !ALLOW_PRODUCTION) {
    throw new Fail(
      `থামুন — টার্গেট ডাটাবেসের নামে "prod" আছে (${target.dbName})। প্রোডাকশনে রিস্টোর মানে বর্তমান ডেটা মুছে ফেলা। সত্যিই করতে চাইলে --allow-production যোগ করুন এবং আগে docs/RUNBOOK-LOCAL.md §11 পড়ুন। / STOP — the target database name contains "prod" (${target.dbName}). Restoring over production erases current data. If that is truly intended, add --allow-production and read docs/RUNBOOK-LOCAL.md §11 first.`,
    );
  }

  await validateDumpFile(dumpFile);

  const restoreArgs = ["--clean", "--if-exists", ...target.args, dumpFile];
  const printable = printableCommand(target, dumpFile);

  if (DRY_RUN) {
    const version = pgToolVersion("pg_restore");
    console.log(`[restore] ${version}`);
    console.log("[restore] DRY RUN — কিছুই বদলানো হবে না। / DRY RUN — nothing will be changed.");
    console.log(`[restore] চলতো / Would run: ${printable}`);
    console.log(
      "[restore] সত্যিকারের রিস্টোর করতে --confirm দিয়ে আবার চালান। / To actually restore, re-run with --confirm.",
    );
    return;
  }

  if (!CONFIRM) {
    console.log(`[restore] চলতো / Would run: ${printable}`);
    throw new Fail(
      "রিস্টোর একটি ধ্বংসাত্মক কাজ (বর্তমান অবজেক্ট মুছে ফেলে) — --confirm ছাড়া চালানো হবে না। আগে --dry-run দিয়ে যাচাই করুন, তারপর --confirm দিন। / Restore is destructive (it drops existing objects) and will not run without --confirm. Preview with --dry-run first, then pass --confirm.",
    );
  }

  const version = pgToolVersion("pg_restore");
  console.log(`[restore] ${version}`);
  console.log(`[restore] pg_restore চলছে… / Running pg_restore…`);
  const code = await runPgRestore(restoreArgs, target.env);
  if (code !== 0) {
    throw new Fail(
      `pg_restore ত্রুটি নিয়ে শেষ হয়েছে (exit ${code}) — উপরের pg_restore বার্তাগুলো দেখুন; ডাটাবেস আংশিকভাবে রিস্টোর হয়ে থাকতে পারে। / pg_restore finished with errors (exit ${code}) — see its messages above; the database may be partially restored.`,
    );
  }
  console.log(
    `[restore] ✅ রিস্টোর সম্পন্ন / Restore complete: ${path.basename(dumpFile)} → ${target.display}`,
  );
}

main().catch((err: unknown) => {
  if (err instanceof Fail) {
    console.error(`[restore] ❌ ${err.message}`);
  } else {
    console.error(
      `[restore] ❌ অপ্রত্যাশিত ত্রুটি / Unexpected error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  process.exit(1);
});
