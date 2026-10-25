/**
 * DEMO call-center seed — idempotent, with a --clean mode.
 *
 * Companion to seed-demo.ts. The demo store seed inserts orders
 * directly into the database, so the call-center's automatic task
 * generation (risk >= 40 on order.created, FAILED/RETURNED on
 * order.status_changed) never fires for them — production ends up
 * with demo customers/orders but ZERO CallTask rows, and the owner
 * who turns module.call_center ON sees an empty module. This seed
 * creates a small, realistic set of demo call tasks on top of the
 * existing demo orders so the workbench, supervisor board, QA and
 * reports screens can be evaluated end to end.
 *
 * Seeded set (8 tasks, all demo):
 *  - 3 QUEUED PENDING_ORDER tasks on PENDING demo orders (one of
 *    them already attempted once — a NO_ANSWER demo call log)
 *  - 1 IN_CALL PENDING_ORDER task assigned to the first resolvable
 *    staff user (falls back to QUEUED/unassigned when none exists)
 *  - 1 QUEUED PENDING_ORDER task with an OVERDUE callback
 *    (callbackAt ~1h in the past, CALLBACK demo log, assigned)
 *  - 2 QUEUED FAILED_DELIVERY rescue tasks on SHIPPED demo orders
 *  - 1 QUEUED MANUAL task with a demo phone/name/note (C1 columns)
 *
 * Every demo row is identifiable and removable:
 *  - order-linked tasks hang off demo orders only (the orders whose
 *    idempotency keys start with "demo-seed-order-"), with kinds
 *    PENDING_ORDER / FAILED_DELIVERY — the same kinds the real
 *    auto-generator creates for those orders
 *  - the manual task uses the reserved demo phone +8801900000099
 *    (same 019000000XX demo range as the demo customers, unused by
 *    them) and a note starting with "DEMO"
 *  - demo call logs carry notes starting with "DEMO"
 *
 * Idempotency: an order-linked slot is skipped when ANY task already
 * exists for the same (orderId, kind) — the same dedupe rule the
 * real auto-generator uses — and the manual slot is skipped when a
 * task with the demo manual phone exists. Call logs are created
 * together with their task, so re-running never duplicates them.
 * --clean deletes the demo tasks' logs first, then the tasks, and
 * never touches tasks on non-demo orders or other manual tasks.
 *
 * Order-linked tasks store ONLY the masked phone, exactly like the
 * real auto-generator: the full number is resolved from the Order at
 * read time and never copied onto the task (C1 privacy design).
 *
 * SAFETY: this script refuses to run against a non-localhost
 * DATABASE_URL unless DEMO_SEED_ALLOW_REMOTE=1 is set explicitly.
 * That flag is set ONLY inside the RUN_DEMO_CALLCENTER_SEED step of
 * scripts/bootstrap.mjs (the gated production deploy path) — never
 * set it by hand against a database you do not intend to demo-seed.
 * Run seed-demo.ts FIRST: without demo orders there is nothing
 * realistic to attach tasks to, and this script refuses to invent
 * orders of its own.
 *
 * Usage (local):
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/advance_ecommerce \
 *   pnpm --filter @advance-ecommerce/db exec tsx scripts/seed-demo-callcenter.ts [--clean]
 */
import { PrismaClient } from "@prisma/client";

/* ------------------------------------------------------------------ */
/* Safety gate (mirrors seed-demo.ts)                                  */
/* ------------------------------------------------------------------ */

const databaseUrl = process.env["DATABASE_URL"] ?? "";
let dbHost = "";
try {
  dbHost = new URL(databaseUrl).hostname;
} catch {
  throw new Error("DATABASE_URL is missing or not a valid URL — refusing to run.");
}
const isLocal = dbHost === "localhost" || dbHost === "127.0.0.1" || dbHost === "::1";
if (!isLocal && process.env["DEMO_SEED_ALLOW_REMOTE"] !== "1") {
  throw new Error(
    `Refusing to demo-seed a non-localhost database (host: ${dbHost}). ` +
      "Set DEMO_SEED_ALLOW_REMOTE=1 only for the gated RUN_DEMO_CALLCENTER_SEED production deploy.",
  );
}

const prisma = new PrismaClient();
const CLEAN = process.argv.includes("--clean");

/* ------------------------------------------------------------------ */
/* Phone helpers (same logic as apps/web/src/checkout/validation.ts)   */
/* ------------------------------------------------------------------ */

const BD_PHONE_REGEX = /^(?:\+?88)?01[3-9]\d{8}$/;

function normalizeBdPhone(input: string): string | null {
  const cleaned = input.replace(/[\s-]/g, "");
  if (!BD_PHONE_REGEX.test(cleaned)) return null;
  const digits = cleaned.replace(/^\+?88/, "");
  return `+880${digits.slice(-10)}`;
}

function maskPhone(normalized: string): string {
  if (normalized.length < 5) return normalized;
  return `${normalized.slice(0, 5)}******${normalized.slice(-2)}`;
}

/* ------------------------------------------------------------------ */
/* Demo task plan                                                      */
/* ------------------------------------------------------------------ */

// Priorities mirror priorityForSource() in src/callcenter/queue.ts:
// FAILED_DELIVERY 40, PENDING_ORDER 30, ABANDONED_CHECKOUT 20, MANUAL 10.
const PRIORITY = { PENDING_ORDER: 30, FAILED_DELIVERY: 40, MANUAL: 10 } as const;

// Reserved demo range (019000000XX) — the demo customers use 01..10.
const DEMO_MANUAL_PHONE = normalizeBdPhone("01900000099") ?? "+8801900000099";
const DEMO_MANUAL_NAME = "Demo Customer (Call Center)";
const DEMO_MANUAL_NOTE =
  "DEMO call-center seed: manual enquiry about delivery charges — not a real customer.";

const NO_ANSWER_LOG_NOTE = "DEMO: rang out, no answer — seeded demo call log.";
const CALLBACK_LOG_NOTE = "DEMO: customer asked to be called back in two hours — seeded demo call log.";

const minutesAgo = (m: number): Date => new Date(Date.now() - m * 60_000);
const hoursAgo = (h: number): Date => minutesAgo(Math.round(h * 60));

/* ------------------------------------------------------------------ */
/* Clean                                                               */
/* ------------------------------------------------------------------ */

async function clean(): Promise<void> {
  console.log(`[demo-callcenter-seed] cleaning demo call-center data (db host: ${dbHost})`);

  const demoOrders = await prisma.order.findMany({
    where: { idempotencyKey: { startsWith: "demo-seed-order-" } },
    select: { id: true },
  });
  const demoOrderIds = demoOrders.map((o) => o.id);

  const orderTasks = demoOrderIds.length
    ? await prisma.callTask.findMany({
        where: { orderId: { in: demoOrderIds }, kind: { in: ["PENDING_ORDER", "FAILED_DELIVERY"] } },
        select: { id: true },
      })
    : [];
  const manualTasks = await prisma.callTask.findMany({
    where: { kind: "MANUAL", customerPhone: DEMO_MANUAL_PHONE, note: { startsWith: "DEMO" } },
    select: { id: true },
  });

  const taskIds = [...orderTasks, ...manualTasks].map((t) => t.id);
  if (taskIds.length > 0) {
    const logs = await prisma.callLogEntry.deleteMany({ where: { taskId: { in: taskIds } } });
    await prisma.callTask.deleteMany({ where: { id: { in: taskIds } } });
    console.log(
      `[demo-callcenter-seed] clean done: removed ${taskIds.length} demo tasks and ${logs.count} demo call logs.`,
    );
  } else {
    console.log("[demo-callcenter-seed] clean done: no demo call tasks found.");
  }
}

/* ------------------------------------------------------------------ */
/* Seed                                                                */
/* ------------------------------------------------------------------ */

interface DemoOrderRef {
  id: string;
  orderNo: string;
  customerPhone: string;
}

async function findDemoOrders(status: string): Promise<DemoOrderRef[]> {
  return prisma.order.findMany({
    where: { idempotencyKey: { startsWith: "demo-seed-order-" }, status },
    orderBy: { createdAt: "desc" },
    select: { id: true, orderNo: true, customerPhone: true },
  });
}

async function resolveAssignee(): Promise<string | null> {
  const owner = await prisma.user.findFirst({
    where: { role: { name: "Owner" }, isActive: true, deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (owner) return owner.id;
  const anyStaff = await prisma.user.findFirst({
    where: { isActive: true, deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return anyStaff?.id ?? null;
}

async function createOrderTaskIfAbsent(input: {
  order: DemoOrderRef;
  kind: "PENDING_ORDER" | "FAILED_DELIVERY";
  status: string;
  assignedToId?: string | null;
  callbackAt?: Date | null;
  attempts?: number;
  createdAt: Date;
}): Promise<{ created: boolean; taskId: string | null }> {
  const existing = await prisma.callTask.findFirst({
    where: { orderId: input.order.id, kind: input.kind },
    select: { id: true },
  });
  if (existing) return { created: false, taskId: existing.id };
  const row = await prisma.callTask.create({
    data: {
      kind: input.kind,
      priority: PRIORITY[input.kind],
      status: input.status,
      // Order-linked tasks store the masked phone ONLY — the full
      // number resolves from the Order at read time, like the real
      // auto-generator's rows.
      customerPhoneMasked: maskPhone(input.order.customerPhone),
      orderId: input.order.id,
      assignedToId: input.assignedToId ?? null,
      callbackAt: input.callbackAt ?? null,
      attempts: input.attempts ?? 0,
      createdAt: input.createdAt,
    },
    select: { id: true },
  });
  return { created: true, taskId: row.id };
}

async function seed(): Promise<void> {
  console.log(`[demo-callcenter-seed] seeding demo call-center data (db host: ${dbHost})`);

  const pendingOrders = await findDemoOrders("PENDING");
  const shippedOrders = await findDemoOrders("SHIPPED");
  if (pendingOrders.length === 0 && shippedOrders.length === 0) {
    throw new Error(
      "No demo orders found (idempotency keys 'demo-seed-order-*'). " +
        "Run packages/db/scripts/seed-demo.ts first — this seed attaches tasks to its orders and invents none of its own.",
    );
  }

  const assigneeId = await resolveAssignee();
  if (!assigneeId) {
    console.warn(
      "[demo-callcenter-seed] no active staff user resolvable — the IN_CALL and callback tasks will be seeded QUEUED/unassigned.",
    );
  }

  let created = 0;
  let skipped = 0;
  const track = (r: { created: boolean }): void => {
    if (r.created) created += 1;
    else skipped += 1;
  };
  const missing = (slot: string): void => {
    skipped += 1;
    console.warn(`[demo-callcenter-seed] slot skipped (not enough demo orders): ${slot}`);
  };

  /* --- PENDING_ORDER slots over the PENDING demo orders ----------- */
  const p = pendingOrders;

  // Slot 1: fresh QUEUED confirmation task.
  if (p[0]) track(await createOrderTaskIfAbsent({ order: p[0], kind: "PENDING_ORDER", status: "QUEUED", createdAt: minutesAgo(50) }));
  else missing("QUEUED PENDING_ORDER #1");

  // Slot 2: QUEUED confirmation task already attempted once (NO_ANSWER).
  if (p[1]) {
    const r = await createOrderTaskIfAbsent({
      order: p[1], kind: "PENDING_ORDER", status: "QUEUED", attempts: 1, createdAt: hoursAgo(3),
    });
    track(r);
    if (r.created && r.taskId) {
      await prisma.callLogEntry.create({
        data: {
          taskId: r.taskId,
          agentId: assigneeId,
          outcome: "NO_ANSWER",
          note: NO_ANSWER_LOG_NOTE,
          scriptVersion: "v1",
          durationSeconds: 32,
          createdAt: hoursAgo(2),
        },
      });
    }
  } else missing("QUEUED PENDING_ORDER #2 (attempted)");

  // Slot 3: another fresh QUEUED confirmation task.
  if (p[2]) track(await createOrderTaskIfAbsent({ order: p[2], kind: "PENDING_ORDER", status: "QUEUED", createdAt: hoursAgo(5) }));
  else missing("QUEUED PENDING_ORDER #3");

  // Slot 4: IN_CALL confirmation task with the resolvable assignee.
  if (p[3]) {
    track(
      await createOrderTaskIfAbsent({
        order: p[3],
        kind: "PENDING_ORDER",
        status: assigneeId ? "IN_CALL" : "QUEUED",
        assignedToId: assigneeId,
        createdAt: minutesAgo(8),
      }),
    );
  } else missing("IN_CALL PENDING_ORDER");

  // Slot 5: QUEUED confirmation task with an OVERDUE callback — the
  // CALLBACK log was written ~3h ago and asked for +2h, so the
  // callback fell due ~1h ago.
  if (p[4]) {
    const r = await createOrderTaskIfAbsent({
      order: p[4],
      kind: "PENDING_ORDER",
      status: "QUEUED",
      assignedToId: assigneeId,
      callbackAt: hoursAgo(1),
      attempts: 1,
      createdAt: minutesAgo(192),
    });
    track(r);
    if (r.created && r.taskId) {
      await prisma.callLogEntry.create({
        data: {
          taskId: r.taskId,
          agentId: assigneeId,
          outcome: "CALLBACK",
          note: CALLBACK_LOG_NOTE,
          scriptVersion: "v1",
          durationSeconds: 85,
          createdAt: hoursAgo(3),
        },
      });
    }
  } else missing("overdue-callback PENDING_ORDER");

  /* --- FAILED_DELIVERY slots over the SHIPPED demo orders --------- */
  const s = shippedOrders;
  if (s[0]) track(await createOrderTaskIfAbsent({ order: s[0], kind: "FAILED_DELIVERY", status: "QUEUED", createdAt: hoursAgo(2) }));
  else missing("QUEUED FAILED_DELIVERY #1");
  if (s[1]) track(await createOrderTaskIfAbsent({ order: s[1], kind: "FAILED_DELIVERY", status: "QUEUED", createdAt: hoursAgo(26) }));
  else missing("QUEUED FAILED_DELIVERY #2");

  /* --- MANUAL slot ------------------------------------------------- */
  const existingManual = await prisma.callTask.findFirst({
    where: { kind: "MANUAL", customerPhone: DEMO_MANUAL_PHONE },
    select: { id: true },
  });
  if (existingManual) {
    skipped += 1;
  } else {
    await prisma.callTask.create({
      data: {
        kind: "MANUAL",
        priority: PRIORITY.MANUAL,
        status: "QUEUED",
        customerPhoneMasked: maskPhone(DEMO_MANUAL_PHONE),
        customerPhone: DEMO_MANUAL_PHONE,
        customerName: DEMO_MANUAL_NAME,
        note: DEMO_MANUAL_NOTE,
        attempts: 0,
        createdAt: hoursAgo(1),
      },
    });
    created += 1;
  }

  console.log(`[demo-callcenter-seed] slots: created=${created} skipped(existing or unavailable)=${skipped}`);
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

async function reportCounts(label: string): Promise<void> {
  const demoOrders = await prisma.order.findMany({
    where: { idempotencyKey: { startsWith: "demo-seed-order-" } },
    select: { id: true },
  });
  const demoOrderIds = demoOrders.map((o) => o.id);
  const [byStatus, manual, logs] = await Promise.all([
    demoOrderIds.length
      ? prisma.callTask.groupBy({
          by: ["status"],
          where: { orderId: { in: demoOrderIds }, kind: { in: ["PENDING_ORDER", "FAILED_DELIVERY"] } },
          _count: true,
        })
      : Promise.resolve([] as Array<{ status: string; _count: number }>),
    prisma.callTask.count({ where: { kind: "MANUAL", customerPhone: DEMO_MANUAL_PHONE } }),
    prisma.callLogEntry.count({ where: { note: { startsWith: "DEMO" } } }),
  ]);
  const orderLinked = byStatus.reduce((sum, r) => sum + r._count, 0);
  const statusText = byStatus.map((r) => `${r.status}=${r._count}`).join(" ");
  console.log(
    `[demo-callcenter-seed] ${label}: orderLinkedTasks=${orderLinked} (${statusText || "none"}) ` +
      `manualTasks=${manual} demoLogs=${logs}`,
  );
}

async function main(): Promise<void> {
  if (CLEAN) {
    await clean();
    await reportCounts("after clean");
    return;
  }
  await seed();
  await reportCounts("after seed");
  console.log("[demo-callcenter-seed] done. Remove everything with: tsx scripts/seed-demo-callcenter.ts --clean");
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
