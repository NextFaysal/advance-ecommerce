"use client";

// Admin order detail shell — TEMPORARY MOCK data.
// Transitions go through transitionOrder() in src/orders/state-machine.ts:
// invalid transitions are rejected and shown, never applied.
import { useMemo, useState } from "react";
import { findMockOrder, MOCK_CUSTOMERS } from "../../../../src/orders/mock";
import { nextStepLabel, nextStepTarget, transitionOrder } from "../../../../src/orders/state-machine";
import type { Order, OrderStatus } from "../../../../src/orders/types";
import { ORDER_TRANSITIONS } from "../../../../src/orders/state-machine";
import { displayPhone, riskLevel } from "../../../../src/orders/customer";
import { formatBdt } from "../../../../src/checkout/pricing";
import { CustomerSummaryCard } from "../../../../src/orders/components/CustomerSummaryCard";
import { OneClickPanel } from "../../../../src/orders/components/OneClickPanel";
import { PrintPanel } from "../../../../src/orders/components/PrintPanel";
import { StatusTimeline } from "../../../../src/orders/components/StatusTimeline";

export default function AdminOrderDetailPage({ params }: { params: { id: string } }) {
  const initial = useMemo(() => findMockOrder(params.id), [params.id]);
  const [order, setOrder] = useState<Order | undefined>(initial);
  const [message, setMessage] = useState<string>("");
  const [reason, setReason] = useState<string>("");

  if (!order) {
    return <main style={{ padding: 24 }}>Order pai ni (mock id: {params.id}). TEMPORARY MOCK data te sudhu ord-1 / ord-2 ache.</main>;
  }

  function applyTransition(to: OrderStatus) {
    if (!order) return;
    const result = transitionOrder(order, to, "staff-1", reason || undefined);
    if (!result.ok) {
      setMessage(`Rejected: ${result.error}`);
      return;
    }
    setOrder(result.order);
    setMessage(`Status change hoyeche: ${order.status} -> ${to}`);
  }

  const nextLabel = nextStepLabel(order.status);
  const nextTarget = nextStepTarget(order.status);
  const customer = MOCK_CUSTOMERS.find((c) => c.phone === order.customerPhone);

  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>{order.orderNo} — {order.status}</h1>
      <p>Payment: {order.paymentMethod} / {order.paymentStatus} | Courier: {order.courier ?? "—"} | Tracking: {order.trackingId ?? "—"}</p>
      <p>Customer: {order.customerName} — {displayPhone(order.customerPhone, false)} (masked by default) | Risk: {riskLevel(order.riskScore)} ({order.riskScore})</p>
      <p>Total: {formatBdt(order.totalPoisha)}</p>

      <section>
        <h2>Items</h2>
        <ul>{order.items.map((i) => <li key={i.variantId}>{i.productName} ({i.sku}) x{i.quantity} — {formatBdt(i.unitPricePoisha * i.quantity)}</li>)}</ul>
      </section>

      <div style={{ display: "grid", gap: 16, margin: "16px 0" }}>
        <CustomerSummaryCard order={order} customer={customer} />
        <StatusTimeline history={order.history} />
      </div>

      <section>
        <h2>Next step / Status change</h2>
        {nextLabel && nextTarget && <button type="button" onClick={() => applyTransition(nextTarget)}>{nextLabel}</button>}
        <label style={{ marginLeft: 12 }}>Reason (Cancel/Refund er jonno required)
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" />
        </label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          {ORDER_TRANSITIONS[order.status].map((to) => (
            <button key={to} type="button" onClick={() => applyTransition(to)}>Mark {to}</button>
          ))}
          <button type="button" onClick={() => applyTransition("DELIVERED")}>Try invalid transition (demo: reject hobe jodi allowed na hoy)</button>
        </div>
        {message && <p role="status">{message}</p>}
      </section>

      <div style={{ display: "grid", gap: 16, margin: "16px 0" }}>
        <OneClickPanel order={order} onOrderChange={setOrder} />
        <PrintPanel order={order} />
      </div>

      <section>
        <h2>Notes</h2>
        <ul>{order.notes.map((n) => <li key={n.id}>{n.author}: {n.text} ({n.createdAt})</li>)}</ul>
        {order.notes.length === 0 && <p>Kono note nai.</p>}
      </section>
      <p>TEMPORARY MOCK — state change ekhane sudhu local UI te, DB te save hoy na API wire na howa porjonto.</p>
    </main>
  );
}
