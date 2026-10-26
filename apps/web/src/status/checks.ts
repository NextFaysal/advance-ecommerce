/**
 * System status checks — SERVER ONLY (ADV-29 public status page).
 *
 * One small, read-only probe per component, run fresh on every
 * /status request. HONESTY RULES (the page is public, so these are
 * load-bearing):
 *
 *  - A component is "operational" only when a live probe just
 *    succeeded — never because a setting exists or a client object
 *    was constructed.
 *  - "not_configured" is its own state, distinct from "down": the
 *    store runs without shared Redis / Meilisearch / object storage
 *    by design (in-process / Postgres fallbacks), and the page says
 *    so instead of dressing a fallback up as a healthy service.
 *  - The queue check reports BACKLOG COUNTS ONLY (waiting / active
 *    list lengths read from BullMQ's Redis keys). There is no worker
 *    process in this deployment, so nothing is being processed —
 *    the detail copy says exactly that; counts are never presented
 *    as processing state.
 *  - Details are public-safe: component names, states and counts.
 *    No connection strings, hosts, bucket names, keys or stack
 *    traces ever leave this module; a failed probe reports only the
 *    error's class name.
 *  - Every probe is wrapped in its own timeout + try/catch, so one
 *    hanging component can neither hang the page nor mask the
 *    others. A probe that throws or times out reports "down".
 */
import { prisma } from "@advance-ecommerce/db";
import { getRedisClient } from "@/lib/redis";
import { QUEUE_NAMES } from "@/jobs/queues";
import { presignGetObject, resolveStorageConfig } from "@/catalog/media-server";

export type ComponentState = "operational" | "degraded" | "down" | "not_configured";

export interface ComponentCheck {
  key: string;
  labelBn: string;
  labelEn: string;
  state: ComponentState;
  /** Public-safe short note (counts / fallback in use). Never a secret. */
  detail?: string;
  latencyMs: number;
}

export interface SystemStatus {
  /** When this snapshot was taken (the checks ran at this instant). */
  checkedAt: Date;
  overall: "operational" | "degraded" | "down";
  components: ComponentCheck[];
}

/* ------------------------------------------------------------------ */
/* Probe runner: timeout + failure isolation                           */
/* ------------------------------------------------------------------ */

class ProbeTimeoutError extends Error {
  constructor() {
    super("status probe timed out");
    this.name = "ProbeTimeoutError";
  }
}

function withTimeout<T>(probe: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ProbeTimeoutError()), timeoutMs);
    probe.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error("UnknownError"));
      },
    );
  });
}

type ProbeResult = { state: ComponentState; detail?: string };
type Probe = () => Promise<ProbeResult>;

async function runCheck(
  meta: { key: string; labelBn: string; labelEn: string },
  timeoutMs: number,
  probe: Probe,
): Promise<ComponentCheck> {
  const startedAt = Date.now();
  try {
    const result = await withTimeout(probe(), timeoutMs);
    return { ...meta, state: result.state, detail: result.detail, latencyMs: Date.now() - startedAt };
  } catch (err) {
    // Public-safe: the error CLASS only — no message, no stack, no
    // connection details (driver messages can embed hosts/URLs).
    const errorName = err instanceof Error ? err.name : "UnknownError";
    return {
      ...meta,
      state: "down",
      detail: `সাড়া পাওয়া যায়নি (${errorName})`,
      latencyMs: Date.now() - startedAt,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Database — one trivial round-trip                                   */
/* ------------------------------------------------------------------ */

async function probeDatabase(): Promise<ProbeResult> {
  await prisma.$queryRaw`SELECT 1`;
  return { state: "operational" };
}

/* ------------------------------------------------------------------ */
/* Redis — PING on the shared client                                   */
/* ------------------------------------------------------------------ */

/**
 * Shared shape for the two Redis-backed checks. Returns the client,
 * or a finished ProbeResult when Redis is absent / not connected:
 *  - REDIS_URL unset → not_configured (the app deliberately runs on
 *    the in-process memory fallback in src/lib/redis.ts).
 *  - URL set but the client has not established a connection →
 *    degraded (configured, not currently reachable) — never
 *    "operational", because no round-trip has succeeded.
 */
function redisClientOrResult(): { client: NonNullable<ReturnType<typeof getRedisClient>> } | { result: ProbeResult } {
  if (!process.env.REDIS_URL) {
    return {
      result: {
        state: "not_configured",
        detail: "শেয়ার্ড Redis কনফিগার করা হয়নি — অ্যাপ ইন-প্রসেস মেমরি ফলব্যাকে চলছে",
      },
    };
  }
  const client = getRedisClient();
  if (!client) {
    return {
      result: {
        state: "degraded",
        detail: "Redis কনফিগার করা আছে, কিন্তু এই মুহূর্তে সংযোগ সক্রিয় নয়",
      },
    };
  }
  return { client };
}

async function probeRedis(): Promise<ProbeResult> {
  const gate = redisClientOrResult();
  if ("result" in gate) return gate.result;
  const pong = await gate.client.ping();
  if (pong !== "PONG") throw new Error("UnexpectedPingReply");
  return { state: "operational" };
}

/* ------------------------------------------------------------------ */
/* Job queues — BACKLOG counts from BullMQ's Redis keys (read-only)    */
/* ------------------------------------------------------------------ */

/**
 * BullMQ key layout per queue: bull:<queue>:wait / :paused are lists
 * of waiting jobs, :delayed / :prioritized are sorted sets, :active
 * is the list a worker is currently processing. We only READ lengths
 * — and because this deployment has no worker process, the numbers
 * are a backlog readout, never a processing claim.
 */
async function probeQueues(): Promise<ProbeResult> {
  const gate = redisClientOrResult();
  if ("result" in gate) {
    // Queue state is unknowable without Redis; the reason is the
    // missing worker host, stated plainly.
    return {
      state: "not_configured",
      detail: "ওয়ার্কার হোস্ট সংযুক্ত নেই — জমে থাকা কাজের সংখ্যা জানা যাচ্ছে না",
    };
  }
  const queueNames = Object.values(QUEUE_NAMES);
  const pipe = gate.client.pipeline();
  for (const name of queueNames) {
    pipe.llen(`bull:${name}:wait`);
    pipe.llen(`bull:${name}:paused`);
    pipe.zcard(`bull:${name}:delayed`);
    pipe.zcard(`bull:${name}:prioritized`);
    pipe.llen(`bull:${name}:active`);
  }
  const results = await pipe.exec();
  if (!results) throw new Error("QueueReadFailed");

  let waiting = 0;
  let active = 0;
  results.forEach(([err, value], idx) => {
    if (err || typeof value !== "number") return;
    // Every 5th slot (index % 5 === 4) is that queue's :active list.
    if (idx % 5 === 4) active += value;
    else waiting += value;
  });

  return {
    state: "operational",
    detail:
      `জমে থাকা কাজ: ${waiting}টি · সক্রিয় তালিকায়: ${active}টি — ` +
      "এই ডিপ্লয়মেন্টে কোনো ওয়ার্কার চলছে না, তাই জমে থাকা কাজ প্রসেস হচ্ছে না; সংখ্যাগুলো শুধু ব্যাকলগের",
  };
}

/* ------------------------------------------------------------------ */
/* Search — Meilisearch /health (env-configured only)                  */
/* ------------------------------------------------------------------ */

/**
 * Meilisearch configuration is env-only in this codebase
 * (src/catalog/indexer.ts reads MEILISEARCH_HOST / MEILISEARCH_API_KEY
 * from the runtime env; there are no settings keys for it) — the same
 * "configured" rule as the indexer: BOTH must be set. Unconfigured is
 * a normal state: storefront search runs on the Postgres fallback.
 */
async function probeSearch(): Promise<ProbeResult> {
  const host = (process.env.MEILISEARCH_HOST ?? "").replace(/\/+$/, "");
  const apiKey = process.env.MEILISEARCH_API_KEY ?? "";
  if (!host || !apiKey) {
    return {
      state: "not_configured",
      detail: "Meilisearch কনফিগার করা হয়নি — সার্চ Postgres ফলব্যাক দিয়ে চলছে",
    };
  }
  const res = await fetch(`${host}/health`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(1_500),
  });
  if (res.status !== 200) {
    return { state: "degraded", detail: `Meilisearch সাড়া দিয়েছে, কিন্তু সুস্থ নয় (HTTP ${res.status})` };
  }
  const body = (await res.json().catch(() => null)) as { status?: unknown } | null;
  if (body?.status === "available") return { state: "operational" };
  return { state: "degraded", detail: "Meilisearch চালু আছে, কিন্তু এখনো পুরোপুরি প্রস্তুত নয়" };
}

/* ------------------------------------------------------------------ */
/* Storage — config resolution + a local signed-URL mint (no upload)   */
/* ------------------------------------------------------------------ */

/**
 * "Operational" here means exactly: the storage settings resolved
 * AND a signed URL could be generated locally. Signing is pure
 * cryptography on this server — no object is uploaded or fetched,
 * and the detail copy says so; bucket reachability is NOT probed
 * and never claimed.
 */
async function probeStorage(): Promise<ProbeResult> {
  const config = await resolveStorageConfig();
  if (!config) {
    return {
      state: "not_configured",
      detail: "অবজেক্ট স্টোরেজ (R2/S3) কনফিগার করা হয়নি — Admin > Settings থেকে সেট করা যায়",
    };
  }
  try {
    const url = presignGetObject({ config, key: "status/health-probe.txt", expiresInSeconds: 60 });
    if (!url) throw new Error("EmptySignedUrl");
  } catch {
    return {
      state: "degraded",
      detail: "স্টোরেজ কনফিগার করা আছে, কিন্তু স্বাক্ষরিত URL তৈরি করা যায়নি",
    };
  }
  return {
    state: "operational",
    detail: `${config.provider === "r2" ? "Cloudflare R2" : "Amazon S3"} — স্বাক্ষরিত URL তৈরি সফল হয়েছে (কোনো আপলোড যাচাই করা হয়নি)`,
  };
}

/* ------------------------------------------------------------------ */
/* Assembly                                                            */
/* ------------------------------------------------------------------ */

export async function getSystemStatus(): Promise<SystemStatus> {
  const components = await Promise.all([
    runCheck({ key: "database", labelBn: "ডাটাবেস", labelEn: "Database" }, 2_500, probeDatabase),
    runCheck({ key: "redis", labelBn: "ক্যাশ ও শেয়ার্ড মেমরি (Redis)", labelEn: "Cache & shared memory (Redis)" }, 2_000, probeRedis),
    runCheck({ key: "queues", labelBn: "ব্যাকগ্রাউন্ড কাজের কিউ", labelEn: "Background job queues" }, 2_500, probeQueues),
    runCheck({ key: "search", labelBn: "পণ্য সার্চ", labelEn: "Product search" }, 2_000, probeSearch),
    runCheck({ key: "storage", labelBn: "ফাইল স্টোরেজ", labelEn: "File storage" }, 2_500, probeStorage),
  ]);

  const overall: SystemStatus["overall"] = components.some((c) => c.state === "down")
    ? "down"
    : components.some((c) => c.state === "degraded" || c.state === "not_configured")
      ? "degraded"
      : "operational";

  return { checkedAt: new Date(), overall, components };
}
