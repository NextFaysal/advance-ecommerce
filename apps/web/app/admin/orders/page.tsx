"use client";

// Admin order list + kanban shell — TEMPORARY MOCK data (src/orders/mock.ts).
// Real data: /api/v1/admin/orders (API owner). Bulk actions go through the
// BulkActionBar -> POST /api/v1/admin/orders, which is a validated + audited
// STUB (202 QUEUED_FOR_BULK_JOB, changes nothing) until the BullMQ bulk job
// is wired; the bar shows the API response honestly. Manual order form is
// below (validation only, same as before).
import { useMemo, useState } from "react";
import type { OrderStatus } from "../../../src/orders/types";
import { MOCK_ORDERS } from "../../../src/orders/mock";
import { MANUAL_ORDER_STEPS, manualOrderSchema } from "../../../src/orders/manual-order";
import { displayPhone, riskLevel } from "../../../src/orders/customer";
import { formatBdt } from "../../../src/checkout/pricing";
import { BulkActionBar } from "../../../src/orders/components/BulkActionBar";

const STATUSES: ("ALL" | OrderStatus)[] = [
  "ALL", "PENDING", "CONFIRMED", "PROCESSING", "PACKED", "SHIPPED",
  "DELIVERED", "FAILED", "RETURN_REQUESTED", "RETURNING", "RETURNED",
  "CANCELLED", "REFUNDED", "EXCHANGED",
];

export default function AdminOrdersPage() {
  const [filter, setFilter] = useState<"ALL" | OrderStatus>("ALL");
  const [view, setView] = useState<"table" | "kanban">("table");
  const [manualResult, setManualResult] = useState<string>("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const orders = useMemo(
    () => (filter === "ALL" ? MOCK_ORDERS : MOCK_ORDERS.filter((o) => o.status === filter)),
    [filter],
  );

  const selectedIds = useMemo(() => [...selected], [selected]);
  const allVisibleSelected = orders.length > 0 && orders.every((o) => selected.has(o.id));

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) orders.forEach((o) => next.delete(o.id));
      else orders.forEach((o) => next.add(o.id));
      return next;
    });
  }

  function onManualSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const parsed = manualOrderSchema.safeParse({
      phone: data.get("phone"),
      customerName: data.get("customerName"),
      address: {
        division: data.get("division"),
        district: data.get("district"),
        upazila: data.get("upazila"),
        addressLine: data.get("addressLine"),
      },
      items: [{ variantId: data.get("variantId"), quantity: Number(data.get("quantity")), unitPricePoisha: Number(data.get("unitPricePoisha")) }],
      paymentMethod: data.get("paymentMethod"),
      note: data.get("note") || undefined,
    });
    setManualResult(
      parsed.success
        ? "Manual order form valid. TEMPORARY MOCK: ashol order toiri hobe API wire hole. Target: 30 sec er moddhe entry."
        : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" | "),
    );
  }

  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>Orders</h1>
      <p>TEMPORARY MOCK data. Status tab + count, search/filter, saved view — API wire hole real hobe.</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <label>Filter
          <select value={filter} onChange={(e) => setFilter(e.target.value as "ALL" | OrderStatus)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => setView("table")}>Table</button>
        <button type="button" onClick={() => setView("kanban")}>Kanban</button>
      </div>

      <div style={{ marginTop: 12 }}>
        <BulkActionBar selectedIds={selectedIds} onClear={() => setSelected(new Set())} />
      </div>

      {view === "table" ? (
        <table>
          <thead><tr>
            <th>
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleSelectAllVisible}
                aria-label="Select all visible orders"
              />
            </th>
            <th>Order</th><th>Customer</th><th>Total</th><th>Payment</th><th>Status</th><th>Risk</th><th>Courier</th>
          </tr></thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={selected.has(o.id)}
                    onChange={() => toggleSelected(o.id)}
                    aria-label={`Select ${o.orderNo}`}
                  />
                </td>
                <td><a href={`/admin/orders/${o.id}`}>{o.orderNo}</a></td>
                <td>{o.customerName} ({displayPhone(o.customerPhone, false)})</td>
                <td>{formatBdt(o.totalPoisha)}</td>
                <td>{o.paymentMethod} / {o.paymentStatus}</td>
                <td>{o.status}</td>
                <td>{riskLevel(o.riskScore)} ({o.riskScore})</td>
                <td>{o.courier ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div style={{ display: "flex", gap: 16, overflowX: "auto" }}>
          {STATUSES.filter((s) => s !== "ALL").map((status) => (
            <section key={status} style={{ minWidth: 220, border: "1px solid #E6E8F2", padding: 12 }}>
              <h3>{status} ({MOCK_ORDERS.filter((o) => o.status === status).length})</h3>
              {MOCK_ORDERS.filter((o) => o.status === status).map((o) => (
                <article key={o.id} style={{ border: "1px solid #eee", padding: 8, marginBottom: 8 }}>
                  <a href={`/admin/orders/${o.id}`}>{o.orderNo}</a>
                  <p>{o.customerName} — {displayPhone(o.customerPhone, false)}</p>
                  <p>{formatBdt(o.totalPoisha)} — {o.paymentMethod}</p>
                </article>
              ))}
            </section>
          ))}
        </div>
      )}
      <p>Bulk: table view-te order select kore uporer BulkActionBar theke Confirm / Print label / Book courier pathano jay — API ekhon stub (202 QUEUED_FOR_BULK_JOB), bar-e API-r ashol uttor dekhano hoy. Kanban view-te bulk selection nai.</p>

      <section>
        <h2>Manual Order (target ≤ 30 sec)</h2>
        <p>Steps: {MANUAL_ORDER_STEPS.join(" → ")}</p>
        <form onSubmit={onManualSubmit} style={{ display: "grid", gap: 8, maxWidth: 480 }}>
          <input name="phone" placeholder="Phone 01XXXXXXXXX" required />
          <input name="customerName" placeholder="Customer name" required />
          <input name="division" placeholder="Division" required />
          <input name="district" placeholder="District" required />
          <input name="upazila" placeholder="Upazila" required />
          <input name="addressLine" placeholder="Full address" required />
          <input name="variantId" placeholder="Variant ID" required />
          <input name="quantity" type="number" defaultValue={1} min={1} />
          <input name="unitPricePoisha" type="number" placeholder="Unit price (poisha, integer)" required />
          <select name="paymentMethod" defaultValue="cod">
            <option value="cod">COD</option><option value="bkash">bKash</option><option value="nagad">Nagad</option>
          </select>
          <input name="note" placeholder="Note (optional)" />
          <button type="submit">Manual order validate korun</button>
        </form>
        {manualResult && <p role="status">{manualResult}</p>}
      </section>
    </main>
  );
}
