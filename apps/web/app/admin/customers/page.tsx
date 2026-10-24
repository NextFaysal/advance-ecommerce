"use client";

// CRM — REAL data from GET /api/v1/admin/customers (Prisma-backed;
// aggregates computed from the Order table server-side). Phone is masked
// by the API for viewers without customers.view_full_phone, and this
// page masks again on display. An empty DB shows an honest empty state.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Customer } from "../../../src/orders/types";
import { customerAovPoisha, customerSuccessRate, displayPhone } from "../../../src/orders/customer";
import { formatBdt } from "../../../src/checkout/pricing";

type LoadState = "loading" | "error" | "ready";

export default function AdminCustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async (initialSearch: string) => {
    setLoadState("loading");
    try {
      const qs = new URLSearchParams({ pageSize: "100" });
      if (initialSearch) qs.set("search", initialSearch);
      const res = await fetch(`/api/v1/admin/customers?${qs.toString()}`);
      const body = (await res.json().catch(() => null)) as
        | { data?: Customer[]; meta?: { total?: number }; error?: { code: string; message: string } }
        | null;
      if (res.ok && body && "data" in body && body.data) {
        setCustomers(body.data);
        setTotal(body.meta?.total ?? body.data.length);
        setSelectedId((prev) => prev ?? body.data![0]?.id ?? null);
        setLoadState("ready");
      } else {
        setLoadError(
          body && "error" in body && body.error ? `${body.error.code}: ${body.error.message}` : `HTTP ${res.status}`,
        );
        setLoadState("error");
      }
    } catch {
      setLoadError("Network — API-te pouchhano jay ni.");
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    // ?search= lands here from the command palette's customer links.
    const initial = new URLSearchParams(window.location.search).get("search") ?? "";
    setSearch(initial);
    void load(initial);
  }, [load]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return customers;
    return customers.filter(
      (c) => c.name.toLowerCase().includes(needle) || c.tags.some((t) => t.toLowerCase().includes(needle)),
    );
  }, [customers, search]);

  const selected = visible.find((c) => c.id === selectedId) ?? visible[0];

  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>Customers / CRM</h1>
      <p>
        Real data — GET /api/v1/admin/customers (database, mot {total} jon).{" "}
        <button type="button" onClick={() => void load(search)}>Refresh</button>
      </p>
      <label>
        Search{" "}
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Naam / tag" />
      </label>

      {loadState === "loading" && <p role="status">Customer load hocche…</p>}
      {loadState === "error" && (
        <p role="alert">
          Customer load hoy ni: {loadError}{" "}
          <button type="button" onClick={() => void load(search)}>Abar cheshta</button>
        </p>
      )}

      {loadState === "ready" && visible.length === 0 && (
        <p role="status" style={{ marginTop: 16 }}>
          Kono customer pai ni — database e ekhono kono customer nai, ba search-e mile ni.
        </p>
      )}

      {loadState === "ready" && visible.length > 0 && (
        <table>
          <thead><tr><th>Name</th><th>Phone (masked)</th><th>Orders</th><th>Success rate</th><th>LTV</th><th>AOV</th><th>Tags</th></tr></thead>
          <tbody>
            {visible.map((c) => (
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
      )}

      {loadState === "ready" && selected && (
        <section style={{ marginTop: 24, border: "1px solid #E6E8F2", padding: 16 }}>
          <h2>{selected.name} — Profile</h2>
          <p>Phone: {displayPhone(selected.phone, false)} (full phone: permission + audit log required — server-side)</p>
          <p>Delivered: {selected.deliveredOrders} | Cancelled: {selected.cancelledOrders} | Returned: {selected.returnedOrders}</p>
          <p>Last order: {selected.lastOrderAt ?? "—"}</p>
          <p>Tabs (to be wired): Orders | Addresses | Wallet & Points | Notes | Activity</p>
          <p>Quick actions (to be wired): Call | SMS | WhatsApp | Block/Unblock | Add note | Add tag</p>
        </section>
      )}
    </main>
  );
}
