/**
 * Admin order feed — GET /api/v1/admin/orders/feed (SSE)
 *
 * Contract (stable, see src/orders/realtime.ts):
 *   event: order.created | order.status_changed | payment.succeeded | stock.low
 *   data:  { type, orderId, orderNo, status?, at, ...event fields }
 * Auth: admin_session cookie + orders.view (same as other admin routes).
 *
 * LIVE — single-process edition (Agent 64), honest scope: this stream
 * subscribes to the in-process domain-event bus (src/orders/event-bus)
 * and forwards every published event as an SSE frame. feed.connected
 * therefore reports live: true with transport "in-process" and scope
 * "single-node": events published by mutations in THIS server process
 * arrive immediately (the <1s target is met within the process), but
 * events do NOT cross processes or survive restarts. The Redis pub/sub
 * swap is documented in the bus module header; only that module and
 * this subscription change when it lands.
 * Emitted today: order.created, order.status_changed,
 * payment.succeeded (published by the markOrderPayment funnel in
 * src/orders/repository.ts, only on the transition into PAID). The
 * contract name stock.low is NOT emitted yet — no server-side
 * mutation writes the stock ledger (see event-bus.ts header) — and
 * nothing here fakes it.
 * The initial event is named feed.connected, NOT one of the contract
 * event names, so a client can never mistake it for a real order event.
 */
import { cookies } from "next/headers";
import { validateSessionToken } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { subscribeOrderEvents } from "@/orders/event-bus";

export async function GET(req: Request) {
  const token = cookies().get("admin_session")?.value;
  if (!token) {
    return new Response(JSON.stringify({ error: { code: "UNAUTHENTICATED", message: "Admin login required." } }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  let session: Awaited<ReturnType<typeof validateSessionToken>> = null;
  try {
    session = await validateSessionToken(token);
  } catch {
    return new Response(
      JSON.stringify({ error: { code: "DB_NOT_READY", message: "Session check needs a working database (Prisma generate + DB connection)." } }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }
  if (!session) {
    return new Response(JSON.stringify({ error: { code: "UNAUTHENTICATED", message: "Session expired or revoked." } }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!hasPermission(session.user.permissions, "orders.view")) {
    return new Response(JSON.stringify({ error: { code: "FORBIDDEN", message: "Missing permission: orders.view" } }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let cleanupStream: (() => void) | undefined;
  const stream = new ReadableStream({
    start(controller) {
      let cleanedUp = false;
      // Single teardown path for client disconnect (abort), stream
      // cancel, and enqueue failure: stop the heartbeat AND unsubscribe
      // from the bus, so a disconnected client never leaks a listener.
      const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      cleanupStream = cleanup;

      // Forward every bus event as an SSE frame. If enqueue throws the
      // stream is already gone: tear down (the bus also drops a
      // throwing listener on its own, so the publisher never blocks).
      const unsubscribe = subscribeOrderEvents((event) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
          );
        } catch {
          cleanup();
        }
      });

      try {
        controller.enqueue(
          encoder.encode(
            `event: feed.connected\ndata: ${JSON.stringify({
              type: "feed.connected",
              live: true,
              transport: "in-process",
              scope: "single-node",
              note: "Live within this server process via the in-process event bus. Events do not cross processes; Redis pub/sub replaces the transport after DB wiring.",
              at: new Date().toISOString(),
            })}\n\n`,
          ),
        );
      } catch {
        cleanup();
        return;
      }
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`));
        } catch {
          cleanup();
        }
      }, 25000);
      req.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      if (cleanupStream) cleanupStream();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
