/**
 * Database backup — ops script (execution plan Step 35).
 *
 * Run:
 *   pnpm --filter web db:backup              # real backup
 *   pnpm --filter web exec tsx scripts/backup-db.ts --dry-run
 *
 * What it does:
 *   Runs pg_dump (custom format, --no-owner) against DATABASE_URL and
 *   writes backups/db/backup-<YYYYMMDD-HHmmss>.dump (Asia/Dhaka time)
 *   plus a `.sha256` sidecar, then prunes old backups down to
 *   BACKUP_RETENTION files (default 7). Only files matching this
 *   script's own naming pattern inside its own directory are pruned.
 *
 * Safety rules:
 *   - DATABASE_URL comes from the environment only. It is NEVER
 *     printed: output shows only postgresql://***@host:port/dbname.
 *     The password is passed to pg_dump via the PGPASSWORD env var,
 *     not on the command line, so it does not appear in `ps` either.
 *   - --dry-run prints exactly what would run (redacted), checks that
 *     pg_dump exists and reports its version, and creates NOTHING —
 *     not even the backup directory.
 *   - Expected failures (missing env, missing pg_dump, pg_dump error)
 *     print a short bilingual (Bangla + English) message and exit 1 —
 *     no stack traces.
 *
 * Honest status: a real backup needs a reachable database and the
 * postgresql-client tools (pg_dump). See docs/RUNBOOK-LOCAL.md §11.
 */

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** An expected, user-facing failure: message is bilingual, no stack. */
class Fail extends Error {}

const DRY_RUN = process.argv.slice(2).includes("--dry-run");

/* ------------------------------------------------------------------ */
/* Connection handling — the password never reaches stdout           */
/* ------------------------------------------------------------------ */

interface DbTarget {
  /** Display-only shape: postgresql://***@host:port/dbname */
  display: string;
  /** Database name (for messages). */
  dbName: string;
  /**
   * How to hand the connection to the pg tools:
   * - "flags": -h/-p/-U/-d arguments + PGPASSWORD in the child env.
   * - "uri": the raw URL as a single dbname argument. Used only when
   *   the URL carries query parameters the flag form cannot express
   *   (anything other than Prisma's `schema` or `sslmode`, which are
   *   mapped to PGSSLMODE). The raw URL is used for the child process
   *   only — it is still never printed.
   */
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

function requireDatabaseUrl(): { raw: string; target: DbTarget } {
  const raw = process.env.DATABASE_URL;
  if (!raw || raw.trim() === "") {
    throw new Fail(
      "DATABASE_URL সেট করা নেই। .env.local বা সার্ভার env-এ সেট করুন — এই স্ক্রিপ্ট কোনো ডিফল্ট ঠিকানা বানায় না। / DATABASE_URL is not set. Set it in .env.local or the server env — this script never invents a default with credentials.",
    );
  }
  return { raw, target: parseDatabaseUrl(raw) };
}

/* ------------------------------------------------------------------ */
/* pg_dump presence check (shared shape with restore-db.ts)          */
/* ------------------------------------------------------------------ */

function pgToolVersion(tool: "pg_dump" | "pg_restore"): string {
  const res = spawnSync(tool, ["--version"], { encoding: "utf8" });
  if (res.error || res.status !== 0) {
    throw new Fail(
      `${tool} পাওয়া যাচ্ছে না (PATH-এ নেই)। postgresql-client ইনস্টল করুন (যেমন: apt install postgresql-client), অথবা Docker-এর postgres ইমেজের ভেতরে চালান। / ${tool} was not found on PATH. Install postgresql-client (e.g. apt install postgresql-client) or run inside the Docker postgres image.`,
    );
  }
  return (res.stdout || "").trim();
}

/* ------------------------------------------------------------------ */
/* Paths, timestamps, checksums                                      */
/* ------------------------------------------------------------------ */

function backupDir(): string {
  const override = process.env.BACKUP_DIR;
  if (override && override.trim() !== "") return path.resolve(override);
  // scripts/ -> apps/web -> apps -> repo root
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(scriptDir, "..", "..", "..", "backups", "db");
}

/** backup-YYYYMMDD-HHmmss in Asia/Dhaka (the project's timezone). */
function timestampName(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "00";
  return `backup-${get("year")}${get("month")}${get("day")}-${get("hour")}${get("minute")}${get("second")}.dump`;
}

const OWN_FILE_PATTERN = /^backup-\d{8}-\d{6}\.dump$/;

function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function retentionCount(): number {
  const raw = process.env.BACKUP_RETENTION;
  if (!raw) return 7;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) {
    console.log(
      `[backup] ⚠️ BACKUP_RETENTION="${raw}" ঠিক নয় — ডিফল্ট 7 ব্যবহার হচ্ছে। / BACKUP_RETENTION is invalid — using the default of 7.`,
    );
    return 7;
  }
  return n;
}

/* ------------------------------------------------------------------ */
/* pg_dump run                                                         */
/* ------------------------------------------------------------------ */

function runPgDump(args: string[], env: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn("pg_dump", args, {
      env: { ...process.env, ...env },
      stdio: ["ignore", "inherit", "inherit"],
    });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

/** The command as it may be shown to a human — password never in it. */
function printableCommand(target: DbTarget, outFile: string): string {
  const conn =
    target.mode === "uri" ? target.display : target.args.join(" ");
  return `PGPASSWORD=*** pg_dump --format=custom --no-owner --file=${outFile} ${conn}`;
}

async function prune(dir: string, keep: number): Promise<void> {
  const entries = await readdir(dir);
  const own = entries
    .filter((name) => OWN_FILE_PATTERN.test(name))
    .sort()
    .reverse(); // newest first — the timestamp sorts lexicographically
  const stale = own.slice(keep);
  for (const name of stale) {
    await rm(path.join(dir, name), { force: true });
    await rm(path.join(dir, `${name}.sha256`), { force: true });
    console.log(`[backup] পুরনো ব্যাকআপ মুছে ফেলা হলো / Pruned old backup: ${name}`);
  }
  if (stale.length === 0) {
    console.log(
      `[backup] প্রুন করার মতো পুরনো ব্যাকআপ নেই (সর্বশেষ ${keep}টি রাখা হয়)। / Nothing to prune (keeping the newest ${keep}).`,
    );
  }
}

/* ------------------------------------------------------------------ */
/* Main                                                              */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  const { target } = requireDatabaseUrl();
  const dir = backupDir();
  const outFile = path.join(dir, timestampName());
  const keep = retentionCount();
  const dumpArgs = [
    "--format=custom",
    "--no-owner",
    `--file=${outFile}`,
    ...target.args,
  ];

  console.log(`[backup] টার্গেট / Target: ${target.display}`);
  console.log(`[backup] আউটপুট / Output: ${outFile}`);

  const version = pgToolVersion("pg_dump");
  console.log(`[backup] ${version}`);

  if (DRY_RUN) {
    console.log("[backup] DRY RUN — কিছুই চালানো বা তৈরি করা হবে না। / DRY RUN — nothing will be executed or created.");
    console.log(`[backup] চলতো / Would run: ${printableCommand(target, outFile)}`);
    console.log(
      `[backup] সফল হলে: SHA-256 চেকসাম লেখা হতো (${outFile}.sha256) এবং ${dir}-এ সর্বশেষ ${keep}টি ব্যাকআপ রেখে বাকি পুরনোগুলো মোছা হতো। / On success it would write a SHA-256 sidecar and prune ${dir} to the newest ${keep} backups.`,
    );
    return;
  }

  await mkdir(dir, { recursive: true });
  console.log(`[backup] pg_dump চলছে… / Running pg_dump…`);
  const code = await runPgDump(dumpArgs, target.env);
  if (code !== 0) {
    // Never leave a partial dump behind to be mistaken for a backup.
    await rm(outFile, { force: true });
    throw new Fail(
      `pg_dump ব্যর্থ হয়েছে (exit ${code}) — আংশিক ফাইল মুছে ফেলা হয়েছে, কোনো ব্যাকআপ তৈরি হয়নি। / pg_dump failed (exit ${code}) — the partial file was removed; no backup was created.`,
    );
  }

  const info = await stat(outFile);
  const checksum = await sha256File(outFile);
  await writeFile(
    `${outFile}.sha256`,
    `${checksum}  ${path.basename(outFile)}\n`,
    "utf8",
  );
  console.log(
    `[backup] ✅ ব্যাকআপ সম্পন্ন / Backup complete: ${path.basename(outFile)} (${humanSize(info.size)})`,
  );
  console.log(`[backup] SHA-256: ${checksum}`);

  await prune(dir, keep);
}

main().catch((err: unknown) => {
  if (err instanceof Fail) {
    console.error(`[backup] ❌ ${err.message}`);
  } else {
    console.error(
      `[backup] ❌ অপ্রত্যাশিত ত্রুটি / Unexpected error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  process.exit(1);
});
