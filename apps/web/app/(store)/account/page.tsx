// TEMPORARY MOCK account page — replace with the logged-in customer's real
// orders/addresses/wallet when the API owner wires /api/v1/public/account.
// Phone is masked by default; full phone needs customers.view_full_phone.
import { MOCK_CUSTOMERS, MOCK_ORDERS } from "../../../src/orders/mock";
import { customerAovPoisha, customerSuccessRate, displayPhone } from "../../../src/orders/customer";
import { formatBdt } from "../../../src/checkout/pricing";

export default function AccountPage() {
  const customer = MOCK_CUSTOMERS[0];
  if (!customer) return <main style={{ padding: 24 }}>No customer found (mock).</main>;
  const orders = MOCK_ORDERS.filter((o) => o.customerPhone === customer.phone);
  return (
    <main style={{ padding: 24, maxWidth: 720, fontFamily: "system-ui" }}>
      <h1>Amar Account</h1>
      <section>
        <h2>{customer.name}</h2>
        <p>Phone (masked): {displayPhone(customer.phone, false)}</p>
        <p>Total orders: {customer.totalOrders} | Delivered: {customer.deliveredOrders} | Success rate: {customerSuccessRate(customer)}%</p>
        <p>Lifetime value: {formatBdt(customer.lifetimeValuePoisha)} | AOV: {formatBdt(customerAovPoisha(customer))}</p>
        <p>Tags: {customer.tags.join(", ") || "—"}</p>
      </section>
      <section>
        <h2>Amar Order</h2>
        <ul>
          {orders.map((order) => (
            <li key={order.id}>
              {order.orderNo} — {order.status} — {formatBdt(order.totalPoisha)} — {order.paymentMethod} / {order.paymentStatus}
            </li>
          ))}
        </ul>
        {orders.length === 0 && <p>Kono order pai ni.</p>}
      </section>
      <p>TEMPORARY MOCK data — ashol account API wire hole ei page real data dekhabe.</p>
    </main>
  );
}
