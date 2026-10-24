import { NextResponse } from "next/server";
import { prisma } from "@advance-ecommerce/db";
import { guardError, requireAdmin } from "@/reports/guard";
import {
  COURIER_PROVIDERS,
  PAYMENT_PROVIDERS,
  STORAGE_PROVIDERS,
  getIntegrationStatus,
  getSetting,
} from "@/lib/settings";

// GET /api/v1/admin/system/health — REAL system health probe.
//
// Auth: a REAL admin session (settings.view), validated against the DB
// via the reports guard — a merely present/garbage admin_session cookie
// does NOT pass (401). Response contains ONLY booleans, the literal
// string "not_configured", and a status word — never a URL, host,
// credential, or downstream error message (those leak infrastructure).
//
// Checks (all live, short timeouts, run in parallel):
// - database: real `SELECT 1` through Prisma.
// - redis: real PING, only when REDIS_URL is set in env; otherwise
//   "not_configured". The web app degrades without Redis (in-memory
//   fallbacks); the BullMQ worker cannot — a down Redis => degraded.
// - queue: the queues are BullMQ-on-Redis, so from the web process the
//   honest signal is the same Redis backing (daemon liveness itself is
//   reported by /api/v1/admin/queues). Mirrors the redis check.
// - paymentProviderConfigured / courierProviderConfigured / storage:
//   configuration state from Admin Settings (enabled + a credential
//   stored; COD needs no credential). "not_configured" when nothing is
//   set up — that is an absent optional integration, not an outage, so
//   it never degrades the overall status. No provider test-connection
//   is made: nothing here spends money or sends a message.
// - search (Meilisearch): env resolution identical to the catalog
//   indexer (MEILISEARCH_HOST + MEILISEARCH_API_KEY); when both are set,
//   a read-only GET /health decides true/false; unset => not_configured.
//
// Overall status: "down" when the database check fails; "degraded"
// when the database is up but any live check reports false; otherwise
// "ok".
//
// Probe mode (DB-down paradox): session validation itself needs the
// database, so when the guard reports its backend as unavailable (503)
// AND this route's own database check independently confirms the DB is
// unreachable, the probe still returns the booleans-only payload with
// status "down" — otherwise an operator could never observe a database
// outage through the probe. Whenever the database IS reachable the
// route is fully session-gated and fails closed (401/403/503 as the
// guard decides).

type CheckValue = boolean | "not_configured";

interface HealthChecks {
  database: boolean;
  redis: CheckValue;
  queue: CheckValue;
  paymentProviderConfigured: CheckValue;
  courierProviderConfigured: CheckValue;
  search: CheckValue;
  storage: CheckValue;
}

const DB_TIMEOUT_MS = 2_000;
const REDIS_TIMEOUT_MS = 2_500;
const SEARCH_TIMEOUT_MS = 1_500;

function withTimeout<T>(run: () => Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("health check timed out")), ms);
    run().then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error("health check failed"));
      },
    );
  });
}

async function checkDatabase(): Promise<boolean> {
  try {
    await withTimeout(() => prisma.$queryRaw`SELECT 1`, DB_TIMEOUT_MS);
    return true;
  } catch {
    return false;
  }
}

async function checkRedis(): Promise<CheckValue> {
  const url = process.env.REDIS_URL;
  if (url === undefined || url === "") return "not_configured";
  let client: { disconnect: () => void } | null = null;
  try {
    const { default: Redis } = await import("ioredis");
    const redis = new Redis(url, {
      lazyConnect: true,
      connectTimeout: 1_500,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });
    client = redis;
    redis.on("error", () => {
      // Connection errors are the check result (false), never a crash.
    });
    const pong = await withTimeout(async () => {
      await redis.connect();
      return redis.ping();
    }, REDIS_TIMEOUT_MS);
    return pong === "PONG";
  } catch {
    return false;
  } finally {
    client?.disconnect();
  }
}

async function checkSearch(): Promise<CheckValue> {
  // Same env resolution as src/catalog/indexer.ts.
  const host = (process.env.MEILISEARCH_HOST ?? "").replace(/\/+$/, "");
  const apiKey = process.env.MEILISEARCH_API_KEY ?? "";
  if (host === "" || apiKey === "") return "not_configured";
  try {
    const res = await fetch(`${host}/health`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Configured = enabled in Settings AND a credential stored (a non-empty
 *  credential_ref counts: that is the reference the settings UI saves).
 *  COD is the one payment provider that needs no credential. */
async function providerConfigured(
  category: "payment" | "courier",
  providers: readonly string[],
): Promise<CheckValue> {
  try {
    const statuses = await getIntegrationStatus(category, providers);
    for (const status of statuses) {
      if (!status.enabled) continue;
      if (status.provider === "cod") return true;
      if (status.configured) return true;
      const credentialRef = await getSetting(`${category}.${status.provider}.credential_ref`);
      if (credentialRef !== null && credentialRef !== "") return true;
    }
    return "not_configured";
  } catch {
    return false;
  }
}

async function checkStorage(): Promise<CheckValue> {
  try {
    const statuses = await getIntegrationStatus("storage", STORAGE_PROVIDERS);
    if (statuses.some((s) => s.configured)) return true;
    // The integrations UI records the bucket for the selected provider;
    // a bucket set means the operator configured storage.
    const bucket = await getSetting("storage.bucket");
    return bucket !== null && bucket !== "" ? true : "not_configured";
  } catch {
    return false;
  }
}

async function runChecks(): Promise<HealthChecks> {
  const [database, redis, search, payment, courier, storage] = await Promise.all([
    checkDatabase(),
    checkRedis(),
    checkSearch(),
    providerConfigured("payment", PAYMENT_PROVIDERS),
    providerConfigured("courier", COURIER_PROVIDERS),
    checkStorage(),
  ]);
  return {
    database,
    redis,
    queue: redis,
    paymentProviderConfigured: payment,
    courierProviderConfigured: courier,
    search,
    storage,
  };
}

function overallStatus(checks: HealthChecks): "ok" | "degraded" | "down" {
  if (!checks.database) return "down";
  const anyDown = Object.values(checks).some((value) => value === false);
  return anyDown ? "degraded" : "ok";
}

function healthResponse(checks: HealthChecks) {
  return NextResponse.json({
    data: { status: overallStatus(checks), checks, checkedAt: new Date().toISOString() },
    meta: { source: "live-checks" },
  });
}

export async function GET() {
  const guard = await requireAdmin("settings.view");
  if (!guard.ok) {
    if (guard.status === 503) {
      // Auth backend unreachable — confirm independently that the
      // database really is down before serving the probe payload.
      const databaseUp = await checkDatabase();
      if (!databaseUp) return healthResponse(await runChecks());
    }
    return NextResponse.json(guardError(guard), { status: guard.status });
  }
  return healthResponse(await runChecks());
}
