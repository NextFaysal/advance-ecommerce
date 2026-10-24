"use client";

// Admin order detail — REAL data from GET /api/v1/admin/orders/[id]
// (Prisma-backed; phone masked server-side for viewers without
// customers.view_full_phone). Status changes go through
// PATCH /api/v1/admin/orders/[id], which runs the state machine
// server-side and persists: invalid transitions come back 422 and are
// shown, never applied locally. The allowed-transition buttons are
// computed from the same state-machine table the server enforces.
// Customer profile aggregates are NOT shown: the order payload carries
// no customerId, so the summary card renders its order-only view
// instead of looking a customer up in sample data.
import { useCallback, useEffect, useState } from "react";
import type { Order, OrderStatus } from "../../../../src/orders/types";
import { nextStepLabel, nextStepTarget, ORDER_TRANSITIONS } from "../../../../src/orders/state-machine";
import { displayPhone, riskLevel } from "../../../../src/orders/customer";
import { formatBdt } from "../../../../src/checkout/pricing";
import { CustomerSummaryCard } from "../../../../src/orders/components/CustomerSummaryCard";
import { OneClickPanel } from "../../../../src/orders/components/OneClickPanel";
import { PrintPanel } from "../../../../src/orders/components/PrintPanel";
import { StatusTimeline } from "../../../../src/orders/components/StatusTimeline";

type DetailResponse =
  | { data: Order; meta?: unknown }
  | { error: { code: string; message: string } };

export default function AdminOrderDetailPage({ params }: { params: { id: string } }) {
  const [order, setOrder] = useState<Order | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "error" | "notfound" | "ready">("loading");
  const [loadError, setLoadError] = useState("");
  const [message, setMessage] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoadState("loading");
    try {
      const res = await fetch(`/api/v1/admin/orders/${encodeURIComponent(params.id)}`);
      const body = (await res.json().catch(() => null)) as DetailResponse | null;
      if (res.ok && body && "data" in body) {
        setOrder(body.data);
        setLoadState("ready");
      } else if (res.status === 404) {
        setLoadState("notfound");
      } else {
        setLoadError(body && "error" in body ? `${body.error.code}: ${body.error.message}` : `HTTP ${res.status}`);
        setLoadState("error");
      }
    } catch {
      setLoadError("Network — API-te pouchhano jay ni.");
      setLoadState("error");
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function applyTransition(to: OrderStatus) {
    if (!order || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/v1/admin/orders/${encodeURIComponent(order.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to, reason: reason.trim() === "" ? undefined : reason.trim() }),
      });
      const body = (await res.json().catch(() => null)) as DetailResponse | null;
      if (res.ok && body && "data" in body) {
        setOrder(body.data);
        setMessage(`Status change hoyeche (DB-te save): ${order.status} -> ${to}`);
      } else if (body && "error" in body) {
        setMessage(`Rejected (${res.status}): ${body.error.code}: ${body.error.message} — kichu save hoy ni.`);
      } else {
        setMessage(`Rejected: HTTP ${res.status} — kichu save hoy ni.`);
      }
    } catch {
      setMessage("Network error — status change pathano jay ni, kichu save hoy ni.");
    } finally {
      setBusy(false);
    }
  }

  if (loadState === "loading") {
    return <main style={{ padding: 24 }}>Order load hocche…</main>;
  }
  if (loadState === "notfound") {
    return <main style={{ padding: 24 }}>Order pai ni (id: {params.id}). Database e ei id/order no-r kono order nai.</main>;
  }
  if (loadState === "error" || !order) {
    return (
      <main style={{ padding: 24 }}>
        Order load hoy ni: {loadError}{" "}
        <button type="button" onClick={() => void load()}>Abar cheshta</button>
      </main>
    );
  }

  const nextLabel = nextStepLabel(order.status);
  const nextTarget = nextStepTarget(order.status);

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
        <CustomerSummaryCard order={order} />
        <p style={{ fontSize: 12, color: "#666" }}>
          Note: Customer profile card ekhane sudhu order-vittik tothyo dekhay — order API-te customerId thake na,
          tai customer-er itihas (mot order, success rate) ekhane ana hoy ni.
        </p>
        <StatusTimeline history={order.history} />
      </div>

      <section>
        <h2>Next step / Status change</h2>
        {nextLabel && nextTarget && (
          <button type="button" disabled={busy} onClick={() => void applyTransition(nextTarget)}>{nextLabel}</button>
        )}
        <label style={{ marginLeft: 12 }}>Reason (Cancel/Refund er jonno required)
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" />
        </label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          {ORDER_TRANSITIONS[order.status].map((to) => (
            <button key={to} type="button" disabled={busy} onClick={() => void applyTransition(to)}>Mark {to}</button>
          ))}
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
      <p>Data source: admin orders API (database) — status change PATCH diye DB-te save hoy.</p>
    </main>
  );
}
