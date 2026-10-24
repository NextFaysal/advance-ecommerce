"use client";

// Admin order list + kanban — REAL data from GET /api/v1/admin/orders
// (Prisma-backed; phone masked server-side for viewers without
// customers.view_full_phone). The list loads the first 100 orders and
// filters/searches them on this page; status counts and the kanban are
// computed from those real rows — an empty DB shows an honest empty
// state, never sample rows. Bulk actions go through the BulkActionBar
// (real job pipeline, per-order results from the Jobs API). The manual
// order form below is validation-only: there is NO admin manual-create
// endpoint yet, and the form says so instead of pretending to create.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Order, OrderStatus } from "../../../src/orders/types";
import { MANUAL_ORDER_STEPS, manualOrderSchema } from "../../../src/orders/manual-order";
import { displayPhone, riskLevel } from "../../../src/orders/customer";
import { formatBdt } from "../../../src/checkout/pricing";
import { BulkActionBar } from "../../../src/orders/components/BulkActionBar";

const STATUSES: ("ALL" | OrderStatus)[] = [
  "ALL", "PENDING", "CONFIRMED", "PROCESSING", "PACKED", "SHIPPED",
  "DELIVERED", "FAILED", "RETURN_REQUESTED", "RETURNING", "RETURNED",
  "CANCELLED", "REFUNDED", "EXCHANGED",
];

type LoadState = "loading" | "error" | "ready";

export default function AdminOrdersPage() {
  const [allOrders, setAllOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState("");
  const [filter, setFilter] = useState<"ALL" | OrderStatus>("ALL");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"table" | "kanban">("table");
  const [manualResult, setManualResult] = useState<string>("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoadState("loading");
    try {
      const res = await fetch("/api/v1/admin/orders?pageSize=100");
      const body = (await res.json().catch(() => null)) as
        | { data?: Order[]; meta?: { total?: number }; error?: { code: string; message: string } }
        | null;
      if (res.ok && body && "data" in body && body.data) {
        setAllOrders(body.data);
        setTotal(body.meta?.total ?? body.data.length);
        setLoadState("ready");
      } else {
        setLoadError(
          body && "error" in body && body.error
            ? `${body.error.code}: ${body.error.message}`
            : `HTTP ${res.status}`,
        );
        setLoadState("error");
      }
    } catch {
      setLoadError("Network — API-te pouchhano jay ni.");
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    // Initial filter from the URL (command-palette natural-language links
    // land here with ?status= / ?q= / ?district=; district/date are not
    // API filters, the text search covers the order number case).
    const params = new URLSearchParams(window.location.search);
    const statusParam = params.get("status");
    if (statusParam && (STATUSES as string[]).includes(statusParam)) {
      setFilter(statusParam as OrderStatus);
    }
    const q = params.get("q") ?? params.get("search");
    if (q) setSearch(q);
    void load();
  }, [load]);

  const orders = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return allOrders.filter((o) => {
      if (filter !== "ALL" && o.status !== filter) return false;
      if (!needle) return true;
      return (
        o.orderNo.toLowerCase().includes(needle) ||
        o.customerName.toLowerCase().includes(needle) ||
        o.address.district.toLowerCase().includes(needle) ||
        o.address.division.toLowerCase().includes(needle)
      );
    });
  }, [allOrders, filter, search]);

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
        ? "Manual order form valid. Kintu admin manual-create API ekhono nai — tai kono order toiri hoy ni. (API gap: POST /api/v1/admin/orders sudhu bulk job ney.)"
        : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" | "),
    );
  }

  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>Orders</h1>
      <p>
        Real data — GET /api/v1/admin/orders (database).{" "}
        <button type="button" onClick={() => void load()}>Refresh</button>
      </p>

      {loadState === "loading" && <p role="status">Order load hocche…</p>}
      {loadState === "error" && (
        <p role="alert">
          Order load hoy ni: {loadError}{" "}
          <button type="button" onClick={() => void load()}>Abar cheshta</button>
        </p>
      )}

      {loadState === "ready" && (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <label>Filter
              <select value={filter} onChange={(e) => setFilter(e.target.value as "ALL" | OrderStatus)}>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label>Search
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Order no / naam / jela" />
            </label>
            <button type="button" onClick={() => setView("table")}>Table</button>
            <button type="button" onClick={() => setView("kanban")}>Kanban</button>
            <span>
              {orders.length} ti order dekhano hocche (mot {total} ti; prothom 100 ti load hoy)
            </span>
          </div>

          <div style={{ marginTop: 12 }}>
            <BulkActionBar selectedIds={selectedIds} onClear={() => setSelected(new Set())} onDone={() => void load()} />
          </div>

          {orders.length === 0 ? (
            <p role="status" style={{ marginTop: 16 }}>
              Kono order pai ni — database e ei filter-e kono order nai. Notun order checkout theke ashle ekhane dekhabe.
            </p>
          ) : view === "table" ? (
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
                  <h3>{status} ({allOrders.filter((o) => o.status === status).length})</h3>
                  {allOrders.filter((o) => o.status === status).map((o) => (
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
          <p>Bulk: table view-te order select kore uporer BulkActionBar theke Confirm / Print label / Book courier pathano jay — ashol job toiri hoy, proti-order folafol Jobs API theke dekhano hoy. Kanban view-te bulk selection nai.</p>
        </>
      )}

      <section>
        <h2>Manual Order (target ≤ 30 sec)</h2>
        <p>Steps: {MANUAL_ORDER_STEPS.join(" → ")}</p>
        <p>Note: Form sudhu validation kore — admin manual-create API ekhono nai, tai submit-e kono order toiri hoy na.</p>
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
