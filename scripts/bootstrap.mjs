// One-time production bootstrap steps, chained at the end of the web
// build. Two INDEPENDENT gates (project env):
//   RUN_BOOTSTRAP=1 — seed the database + create the first Owner.
//   RESET_OWNER=1   — replace the Owner's email+password from
//                     FIRST_OWNER_* (login recovery), or create the
//                     Owner if none exists.
// The seed step may fail the build (a broken seed must be visible);
// the create-owner step may not (it refuses to run twice); the reset
// step MAY fail the build (a failed reset must not look successful).
// Turn both gates off (set to 0) after use.
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = {
  ...process.env,
  DATABASE_URL: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL,
};
const run = (cmd) => execSync(cmd, { cwd: repoRoot, env, stdio: "inherit" });

if (process.env.RUN_BOOTSTRAP === "1") {
  console.log("[bootstrap] seeding database");
  run("pnpm --filter @advance-ecommerce/db db:seed");
  console.log("[bootstrap] creating first owner (no-op if one exists)");
  try {
    run("pnpm --filter @advance-ecommerce/db exec tsx scripts/create-first-owner.ts");
  } catch {
    console.log("[bootstrap] owner step exited non-zero (already exists?) — continuing");
  }
} else {
  console.log("[bootstrap] RUN_BOOTSTRAP != 1 — seed/owner skipped");
}

if (process.env.RESET_OWNER === "1") {
  console.log("[bootstrap] resetting owner login from FIRST_OWNER_* env");
  run("pnpm --filter @advance-ecommerce/db exec tsx scripts/reset-owner.ts");
} else {
  console.log("[bootstrap] RESET_OWNER != 1 — reset skipped");
}

console.log("[bootstrap] done");
