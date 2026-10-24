"use client";

// CRM shell — TEMPORARY MOCK data (src/orders/mock.ts).
// Real data: /api/v1/admin/customers (API owner). Full phone needs
// customers.view_full_phone (server-side); this page always masks by default.
import { useState } from "react";
import { MOCK_CUSTOMERS } from "../../../src/orders/mock";
import { customerAovPoisha, customerSuccessRate, displayPhone } from "../../../src/orders/customer";
import { formatBdt } from "../../../src/checkout/pricing";

export default function AdminCustomersPage() {
  const [selectedId, setSelectedId] = useState<string | null>(MOCK_CUSTOMERS[0]?.id ?? null);
  const selected = MOCK_CUSTOMERS.find((c) => c.id === selectedId);

  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>Customers / CRM</h1>
      <p>TEMPORARY MOCK data. Segment, blacklist, export — API wire hole real hobe.</p>
      <table>
        <thead><tr><th>Name</th><th>Phone (masked)</th><th>Orders</th><th>Success rate</th><th>LTV</th><th>AOV</th><th>Tags</th></tr></thead>
        <tbody>
          {MOCK_CUSTOMERS.map((c) => (
            <tr key={c.id} onClick={() => setSelectedId(c.id)} style={{ cursor: "pointer" }}>
              <td>{c.name}{c.blocked ? " (blocked)" : ""}</td>
              <td>{displayPhone(c.phone, false)}</td>
              <td>{c.totalOrders}</td>
              <td>{customerSuccessRate(c)}%</td>
              <td>{formatBdt(c.lifetimeValuePoisha)}</td>
              <td>{formatBdt(customerAovPoisha(c))}</td>
              <td>{c.tags.join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {selected && (
        <section style={{ marginTop: 24, border: "1px solid #E6E8F2", padding: 16 }}>
          <h2>{selected.name} — Profile shell</h2>
          <p>Phone: {displayPhone(selected.phone, false)} (full phone: permission + audit log required)</p>
          <p>Delivered: {selected.deliveredOrders} | Cancelled: {selected.cancelledOrders} | Returned: {selected.returnedOrders}</p>
          <p>Last order: {selected.lastOrderAt ?? "—"}</p>
          <p>Tabs (to be wired): Orders | Addresses | Wallet & Points | Notes | Activity</p>
          <p>Quick actions (to be wired): Call | SMS | WhatsApp | Block/Unblock | Add note | Add tag</p>
        </section>
      )}
    </main>
  );
}
