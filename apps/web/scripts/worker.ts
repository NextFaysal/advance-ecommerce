/**
 * Worker daemon entrypoint — Agent 66 (worker deployment).
 *
 * Run (after the one-time unblock below):
 *   pnpm --filter web worker        # script: "worker": "tsx scripts/worker.ts"
 *
 * UNBLOCK (one-time, by hand — this file installs nothing):
 *   cd apps/web && pnpm add bullmq ioredis
 *   # plus REDIS_URL in the server env (.env.local locally; never commit it)
 *
 * What this does, in order:
 *   1. Dynamically loads `bullmq` and `ioredis`. If either package is
 *      missing it prints a short bilingual (Bangla + English) message
 *      naming the package and the install command, and exits 1 —
 *      no stack trace, no crash loop.
 *   2. Checks REDIS_URL (server env only). The VALUE is never logged;
 *      only the target shape protocol//host:port is printed.
 *   3. Loads the wiring (src/jobs/workers.ts) and the production deps
 *      assembly (src/jobs/worker-deps.ts), creates the Redis
 *      connection, and calls createWorkers(deps, { Worker }, connection)
 *      — the BullMqFactory contract in workers.ts takes the Worker
 *      constructor (Queue is not part of that contract; producers
 *      enqueue from the web process, workers only consume).
 *   4. Logs the queue manifest and stays alive. SIGTERM / SIGINT
 *      close all workers gracefully (workers.close()) and quit Redis.
 *
 * Why everything is a dynamic import: several modules reachable from
 * the deps assembly (via src/lib/settings.ts) import the Prisma
 * client at module top level, and that import throws until
 * `prisma generate` has run. Loading the local modules only AFTER
 * the package/env checks guarantees the friendly explanations above
 * are what an operator sees on an unprepared machine — never a
 * Prisma stack trace. The settings service itself is additionally
 * lazy-loaded inside worker-deps, so even a missing DB cannot stop
 * this daemon from starting once BullMQ + Redis exist.
 */
import type {
  BullMqWorkerConstructor,
  CreatedWorkers,
  WorkerRuntimeDeps,
} from "../src/jobs/workers";

/* ------------------------------------------------------------------ */
/* Structural shapes for the dynamically loaded packages.              */
/* bullmq / ioredis are NOT dependencies yet, so their real types are  */
/* unavailable; these minimal interfaces match exactly the surface     */
/* this entrypoint uses. No `any` anywhere.                            */
/* ------------------------------------------------------------------ */

interface BullMqModuleShape {
  Worker: BullMqWorkerConstructor;
}

interface RedisConnectionLike {
  quit(): Promise<unknown>;
}

interface RedisConnectionConstructor {
  new (
    url: string,
    options: { maxRetriesPerRequest: null },
  ): RedisConnectionLike;
}

interface IoRedisModuleShape {
  default?: RedisConnectionConstructor;
  Redis?: RedisConnectionConstructor;
}

type WorkersModule = typeof import("../src/jobs/workers");
type WorkerDepsModule = typeof import("../src/jobs/worker-deps");

/**
 * Dynamic import through a non-literal specifier: TypeScript cannot
 * resolve modules that are not installed yet, so the specifier must
 * not be a string literal at the import() call site. The result is
 * `unknown` and is cast to the structural shape by the caller.
 */
async function loadModule(specifier: string): Promise<unknown> {
  return import(specifier);
}

function failFriendly(lines: readonly string[]): never {
  for (const line of lines) console.error(line);
  process.exit(1);
}

function missingPackageLines(packageName: string): string[] {
  return [
    `[worker] ❌ '${packageName}' package install kora nai — worker daemon shuru holo na.`,
    `[worker] ❌ The '${packageName}' package is not installed — the worker daemon cannot start.`,
    `[worker] Thik korte / To fix:  cd apps/web && pnpm add bullmq ioredis`,
    `[worker] Tarpor REDIS_URL set kore abar chalun / Then set REDIS_URL and run again:  pnpm --filter web worker`,
  ];
}

/** protocol//host:port only — credentials and path are never logged. */
function redisTargetShape(redisUrl: string): string {
  try {
    const parsed = new URL(redisUrl);
    return `${parsed.protocol}//${parsed.hostname}:${parsed.port === "" ? "6379" : parsed.port}`;
  } catch {
    return "(REDIS_URL set — target could not be parsed, value not logged)";
  }
}

async function main(): Promise<void> {
  /* 1 — packages ---------------------------------------------------- */
  let bullmq: BullMqModuleShape;
  try {
    bullmq = (await loadModule("bullmq")) as BullMqModuleShape;
  } catch {
    failFriendly(missingPackageLines("bullmq"));
  }
  let ioredis: IoRedisModuleShape;
  try {
    ioredis = (await loadModule("ioredis")) as IoRedisModuleShape;
  } catch {
    failFriendly(missingPackageLines("ioredis"));
  }
  const RedisConnection = ioredis.default ?? ioredis.Redis;
  if (typeof RedisConnection !== "function") {
    failFriendly([
      `[worker] ❌ 'ioredis' load hoyeche kintu Redis constructor pawa jay nai — worker shuru holo na.`,
      `[worker] ❌ 'ioredis' loaded but no Redis constructor was found — the worker cannot start.`,
      `[worker] ioredis version check kore abar chesta korun / Check the installed ioredis version and retry.`,
    ]);
  }

  /* 2 — env ---------------------------------------------------------- */
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl === undefined || redisUrl === "") {
    failFriendly([
      `[worker] ❌ REDIS_URL set kora nai — worker daemon shuru holo na.`,
      `[worker] ❌ REDIS_URL is not set — the worker daemon cannot start.`,
      `[worker] Server env-e REDIS_URL din (lokal: apps/web/.env.local, kokhono commit korben na).`,
      `[worker] Set REDIS_URL in the server env (locally: apps/web/.env.local — never commit it).`,
      `[worker] Shape: redis://<host>:6379  (lokal docker-compose default port 6379).`,
    ]);
  }

  /* 3 — local wiring + deps (dynamic: see the header landmine note) -- */
  let workersModule: WorkersModule;
  let workerDeps: WorkerRuntimeDeps;
  try {
    workersModule = (await loadModule("../src/jobs/workers")) as WorkersModule;
    const depsModule = (await loadModule("../src/jobs/worker-deps")) as WorkerDepsModule;
    workerDeps = depsModule.workerDeps;
  } catch (error) {
    const name = error instanceof Error ? error.name : "UnknownError";
    failFriendly([
      `[worker] ❌ Lokal wiring load hote pare nai (${name}) — worker shuru holo na.`,
      `[worker] ❌ The local worker wiring failed to load (${name}) — the worker cannot start.`,
      `[worker] Prisma client generate kora ache kina dekho / Check the Prisma step:  pnpm db:generate`,
    ]);
  }

  /* 4 — connect + start ---------------------------------------------- */
  console.log(`[worker] Redis target: ${redisTargetShape(redisUrl)}`);
  const connection = new RedisConnection(redisUrl, { maxRetriesPerRequest: null });
  const created: CreatedWorkers = workersModule.createWorkers(
    workerDeps,
    { Worker: bullmq.Worker },
    connection,
  );

  console.log(`[worker] ✅ Worker chaalu hoyeche — queue shunchhe:`);
  console.log(`[worker] ✅ Worker running — listening on queues:`);
  for (const entry of workersModule.workerManifest()) {
    console.log(
      `[worker]    - ${entry.queue}  (attempts ${entry.attempts}, backoff ${entry.backoffSeconds}s, concurrency ${entry.concurrency})`,
    );
  }

  /* 5 — graceful shutdown --------------------------------------------- */
  let closing = false;
  const shutdown = (signal: string): void => {
    if (closing) return;
    closing = true;
    console.log(`[worker] ${signal} peyeche — worker bondho hochhe… / received ${signal} — shutting down…`);
    void (async () => {
      try {
        await created.close();
        await connection.quit();
        console.log(`[worker] ✅ Worker bondho hoyeche. / Worker closed cleanly.`);
        process.exit(0);
      } catch {
        console.error(`[worker] ❌ Bondho korte somosya hoyeche — jor kore exit. / Shutdown failed — forcing exit.`);
        process.exit(1);
      }
    })();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

void main();
