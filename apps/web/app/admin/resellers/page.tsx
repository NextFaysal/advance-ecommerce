import { demoResellerFlags, isResellerEnabled } from "@/reseller/flags";
import { buildDashboardsDb, listPriceEntries, listWithdrawals } from "@/reseller/store";
import { computeMargin } from "@/reseller/pricing";
import { formatBdt } from "@/checkout/pricing";

// Resellers admin — Agent 14, Step 46 (A5).
// Locked state: while module.reseller is OFF (the seeded default — this is a
// paid add-on), the page renders the lock panel instead of data, matching the
// API's 403 FEATURE_LOCKED. Unlocking is a feature-flag change by the Owner
// (Admin > Settings), never a code change.
// Data: Prisma DB via src/reseller/store.ts (dashboards are built by the
// same pure builder as before; wallet balances are ledger sums).
// Wave 6: each row also shows the reseller's attribution code and its
// ?ref= share link — orders placed through that link inside 30 days
// persist Order.resellerId and credit this reseller on DELIVERED.
export default async function AdminResellersPage() {
  if (!isResellerEnabled(demoResellerFlags)) {
    return (
      <main style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1>Resellers</h1>
        <p role="status">
          🔒 This module is locked for this install. Reseller panel is a paid add-on —
          enable <code>module.reseller</code> in Admin &gt; Settings &gt; Feature Flags to unlock it.
        </p>
      </main>
    );
  }
  const [dashboards, priceEntries, withdrawals] = await Promise.all([
    buildDashboardsDb(),
    listPriceEntries(),
    listWithdrawals(),
  ]);
  // Share-link base: the public storefront origin (NEXT_PUBLIC_APP_URL,
  // same env the bd-tools payment links use). Unset locally -> the
  // path-only form is shown, which still carries the code truthfully.
  const appBaseUrl = process.env["NEXT_PUBLIC_APP_URL"] ?? "";
  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>Resellers</h1>
      <p>Live data from the database (src/reseller/store.ts).</p>
      <table>
        <thead>
          <tr>
            <th>Reseller</th><th>Phone</th><th>Tier</th><th>Commission</th>
            <th>Lifetime Sales</th><th>Wallet Balance</th><th>Pending Withdrawal</th>
            <th>Referral Code</th><th>Share Link</th>
          </tr>
        </thead>
        <tbody>
          {dashboards.map((d) => (
            <tr key={d.resellerId}>
              <td>{d.name}</td>
              <td>{d.phoneMasked}</td>
              <td>{d.tier}{d.nextTier ? ` (next: ${d.nextTier} in ${formatBdt(d.toNextTierPoisha)})` : ""}</td>
              <td>{(d.commissionBps / 100).toFixed(1)}%</td>
              <td>{formatBdt(d.lifetimeSalesPoisha)}</td>
              <td>{formatBdt(d.walletBalancePoisha)}</td>
              <td>{formatBdt(d.pendingWithdrawalPoisha)}</td>
              <td>{d.code ? <code>{d.code}</code> : "—"}</td>
              <td>
                {d.code ? (
                  <code>{`${appBaseUrl}/?ref=${d.code}`}</code>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Price List (margin never negative)</h2>
      <ul>
        {priceEntries.map((e) => {
          const m = computeMargin(e);
          return (
            <li key={e.variantId}>
              {e.productName} ({e.sku}) — base {formatBdt(e.basePricePoisha)}, sells at{" "}
              {formatBdt(e.resellerPricePoisha)}, margin {m.ok ? formatBdt(m.marginPoisha) : m.error}
            </li>
          );
        })}
      </ul>
      <p>Pending withdrawals: {withdrawals.filter((w) => w.status === "PENDING").length}</p>
    </main>
  );
}
