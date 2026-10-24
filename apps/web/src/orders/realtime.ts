// Realtime new-order feed outline — SSE/WebSocket, target latency < 1s.
// TARGET, not a guarantee: the server endpoint is not wired yet (API owner).
// Event contract the admin UI subscribes to (keep this shape stable):
//   GET /api/v1/admin/orders/feed  (SSE, auth + RBAC required)
//   event: order.created | order.status_changed | payment.succeeded | stock.low
//   data: { type, orderId, orderNo, status?, at }
export type OrderFeedEventType =
  | "order.created"
  | "order.status_changed"
  | "payment.succeeded"
  | "stock.low";

export type OrderFeedEvent = {
  type: OrderFeedEventType;
  orderId: string;
  orderNo: string;
  status?: string;
  at: string;
};

/** Subscribe via EventSource in the browser; no-op on the server. */
export function subscribeOrderFeed(
  onEvent: (event: OrderFeedEvent) => void,
  onError?: (error: Event) => void,
): () => void {
  if (typeof window === "undefined" || typeof EventSource === "undefined") {
    return () => undefined;
  }
  const source = new EventSource("/api/v1/admin/orders/feed");
  source.onmessage = (message) => {
    try {
      onEvent(JSON.parse(message.data) as OrderFeedEvent);
    } catch {
      // Malformed feed line: ignore, keep the stream open.
    }
  };
  source.onerror = (error) => onError?.(error);
  return () => source.close();
}
