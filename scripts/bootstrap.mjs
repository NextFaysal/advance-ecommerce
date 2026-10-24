// One-time production bootstrap, chained at the end of the web build.
// Runs ONLY when RUN_BOOTSTRAP=1 is present in the build env: seeds the
// database and creates the first Owner from FIRST_OWNER_* env vars.
// The seed step is allowed to fail the build (a broken seed must be
// visible); the owner step is not (it refuses to run twice, and that
// refusal must never break a build). Turn RUN_BOOTSTRAP off (set to 0)
// in the project env after the bootstrap build succeeds.
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.RUN_BOOTSTRAP !== "1") {
  console.log("[bootstrap] RUN_BOOTSTRAP != 1 — skipped");
  process.exit(0);
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = {
  ...process.env,
  DATABASE_URL: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL,
};
const run = (cmd) => execSync(cmd, { cwd: repoRoot, env, stdio: "inherit" });

console.log("[bootstrap] seeding database");
run("pnpm --filter @advance-ecommerce/db db:seed");
console.log("[bootstrap] creating first owner (no-op if one exists)");
try {
  run("pnpm --filter @advance-ecommerce/db exec tsx scripts/create-first-owner.ts");
} catch {
  console.log("[bootstrap] owner step exited non-zero (already exists?) — continuing");
}
console.log("[bootstrap] done");
