// One-time production bootstrap steps, chained at the end of the web
// build. Five gates (project env):
//   RUN_BOOTSTRAP=1 — seed the database + create the first Owner.
//   RESET_OWNER=1   — replace the Owner's email+password from
//                     FIRST_OWNER_* (login recovery), or create the
//                     Owner if none exists.
//   RUN_DEMO_SEED=1 — seed clearly-marked DEMO store data (products,
//                     customers, orders, invited staff, one live
//                     flash sale) via packages/db/scripts/seed-demo.ts.
//                     Removable later with the same script's --clean.
//   RUN_DEMO_CALLCENTER_SEED=1 — seed clearly-marked DEMO call-center
//                     tasks (+ two demo call logs) on the demo orders
//                     via packages/db/scripts/seed-demo-callcenter.ts.
//                     Needs RUN_DEMO_SEED's data; run it in a deploy
//                     AFTER the demo store exists (or the same deploy
//                     with both gates on — this step runs after it).
//                     Removable later with the script's --clean.
//   RUN_DEMO_CLEAN=1 — remove ALL demo data via both demo scripts'
//                     --clean modes: call-center first (its tasks sit
//                     on the demo orders), then the demo store.
//                     PRECEDENCE: this gate REPLACES the two demo-seed
//                     gates — when it is on, the demo seeds are skipped
//                     even if their own gates are also 1 (cleaning
//                     after a fresh seed would erase it, and seeding
//                     before a clean is wasted work). Each seed step
//                     logs the skip loudly. This is the one deliberate
//                     exception to the independence rule below.
// The seed step may fail the build (a broken seed must be visible);
// the create-owner step may not (it refuses to run twice); the reset
// step MAY fail the build (a failed reset must not look successful);
// the demo-seed and demo-clean steps MAY fail the build for the
// same reason.
// Turn all gates off (set to 0) after use. Each gate guards ONLY its
// own step — never let one gate's early-exit skip another step
// (RUN_DEMO_CLEAN's documented precedence over the demo seeds is a
// deliberate replacement, not an early-exit).
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

// RUN_DEMO_CLEAN is resolved once, before the demo-seed steps: when
// it is on, both seed steps are skipped (clean replaces seeding —
// see the header). The cleans run call-center first because the demo
// call tasks reference the demo orders the store clean deletes.
const demoClean = process.env.RUN_DEMO_CLEAN === "1";
if (demoClean) {
  console.log("[bootstrap] RUN_DEMO_CLEAN=1 — removing DEMO data (call-center first, then store)");
  // Same contract as the demo-seed steps below: both scripts refuse
  // non-localhost databases on their own; the allow-remote flag is
  // granted HERE, inside this gated step only, because this deploy
  // is the sanctioned production run. Either clean failing throws
  // and fails the build — a failed cleanup must not look successful.
  execSync("pnpm --filter @advance-ecommerce/db exec tsx scripts/seed-demo-callcenter.ts --clean", {
    cwd: repoRoot,
    env: { ...env, DEMO_SEED_ALLOW_REMOTE: "1" },
    stdio: "inherit",
  });
  execSync("pnpm --filter @advance-ecommerce/db exec tsx scripts/seed-demo.ts --clean", {
    cwd: repoRoot,
    env: { ...env, DEMO_SEED_ALLOW_REMOTE: "1" },
    stdio: "inherit",
  });
} else {
  console.log("[bootstrap] RUN_DEMO_CLEAN != 1 — demo clean skipped");
}

if (process.env.RUN_DEMO_SEED === "1" && !demoClean) {
  console.log("[bootstrap] seeding DEMO store data");
  // The demo seed refuses non-localhost databases on its own; the
  // allow-remote flag is granted HERE, inside this gated step only,
  // because this deploy is the sanctioned production run. A failure
  // throws and fails the build — a half-seeded demo store must not
  // look successful.
  execSync("pnpm --filter @advance-ecommerce/db exec tsx scripts/seed-demo.ts", {
    cwd: repoRoot,
    env: { ...env, DEMO_SEED_ALLOW_REMOTE: "1" },
    stdio: "inherit",
  });
} else {
  console.log(
    demoClean
      ? "[bootstrap] *** demo seed SKIPPED — RUN_DEMO_CLEAN=1 takes precedence (clean replaces seeding) ***"
      : "[bootstrap] RUN_DEMO_SEED != 1 — demo seed skipped",
  );
}

if (process.env.RUN_DEMO_CALLCENTER_SEED === "1" && !demoClean) {
  console.log("[bootstrap] seeding DEMO call-center data");
  // Same contract as the demo-seed step above: the script refuses
  // non-localhost databases on its own; the allow-remote flag is
  // granted HERE, inside this gated step only, because this deploy
  // is the sanctioned production run. A failure throws and fails
  // the build — a half-seeded demo module must not look successful.
  execSync("pnpm --filter @advance-ecommerce/db exec tsx scripts/seed-demo-callcenter.ts", {
    cwd: repoRoot,
    env: { ...env, DEMO_SEED_ALLOW_REMOTE: "1" },
    stdio: "inherit",
  });
} else {
  console.log(
    demoClean
      ? "[bootstrap] *** demo call-center seed SKIPPED — RUN_DEMO_CLEAN=1 takes precedence (clean replaces seeding) ***"
      : "[bootstrap] RUN_DEMO_CALLCENTER_SEED != 1 — demo call-center seed skipped",
  );
}

console.log("[bootstrap] done");
