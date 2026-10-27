import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { demoResellerFlags, isResellerEnabled } from "@/reseller/flags";
import { buildDashboardsDb, listPriceEntries, listWithdrawals } from "@/reseller/store";
import { listPayoutRequestsAdmin } from "@/reseller/payout-store";
import { computeMargin } from "@/reseller/pricing";
import { formatBdt } from "@/checkout/pricing";
import { CreateResellerForm } from "./create-reseller-form";
import PayoutActions from "./payout-actions";
import { RevokeResellerSessions } from "./revoke-sessions";
import { getRequestLocale } from "@/i18n/server";
import { interpolate, pick } from "@/i18n/locale";
import { RESELLERS_STRINGS } from "./strings";

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
// Wave 7: the create form below (CreateResellerForm) POSTs to
// /api/v1/admin/resellers — the create endpoint that did not exist
// before; new rows start PENDING_APPROVAL with their code generated.
export default async function AdminResellersPage() {
  const locale = await getRequestLocale();
  const s = pick(locale, RESELLERS_STRINGS);
  await ensureDbFeatureFlags().catch(() => {});
  if (!isResellerEnabled(demoResellerFlags)) {
    return (
      <main style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1>{s.title}</h1>
        <p role="status">{s.locked}</p>
      </main>
    );
  }
  const [dashboards, priceEntries, withdrawals, payoutRequests] = await Promise.all([
    buildDashboardsDb(),
    listPriceEntries(),
    listWithdrawals(),
    listPayoutRequestsAdmin(),
  ]);
  // Share-link base: the public storefront origin (NEXT_PUBLIC_APP_URL,
  // same env the bd-tools payment links use). Unset locally -> the
  // path-only form is shown, which still carries the code truthfully.
  const appBaseUrl = process.env["NEXT_PUBLIC_APP_URL"] ?? "";
  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>{s.title}</h1>
      <p>{s.liveData}</p>
      <CreateResellerForm />
      <table>
        <thead>
          <tr>
            <th>{s.colReseller}</th><th>{s.colPhone}</th><th>{s.colTier}</th><th>{s.colCommission}</th>
            <th>{s.colLifetimeSales}</th><th>{s.colLifetimeCommission}</th><th>{s.colWallet}</th><th>{s.colPendingWithdrawal}</th>
            <th>{s.colReferralCode}</th><th>{s.colShareLink}</th>
          </tr>
        </thead>
        <tbody>
          {dashboards.map((d) => (
            <tr key={d.resellerId}>
              <td>{d.name}</td>
              <td>{d.phoneMasked}</td>
              <td>{d.tier}{d.nextTier ? ` (${interpolate(s.nextTier, { tier: d.nextTier, amount: formatBdt(d.toNextTierPoisha) })})` : ""}</td>
              <td>{(d.commissionBps / 100).toFixed(1)}%</td>
              <td>{formatBdt(d.lifetimeSalesPoisha)}</td>
              <td>{formatBdt(d.lifetimeCommissionPoisha)}</td>
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
      <h2>{s.priceListTitle}</h2>
      <ul>
        {priceEntries.map((e) => {
          const m = computeMargin(e);
          return (
            <li key={e.variantId}>
              {interpolate(s.priceEntry, { name: e.productName, sku: e.sku, base: formatBdt(e.basePricePoisha), price: formatBdt(e.resellerPricePoisha), margin: m.ok ? formatBdt(m.marginPoisha) : (m.error ?? "") })}
            </li>
          );
        })}
      </ul>
      <p>{interpolate(s.pendingWithdrawals, { count: withdrawals.filter((w) => w.status === "PENDING").length })}</p>
      <h2>{s.payoutTitle}</h2>
      <p>{s.payoutDesc}</p>
      {payoutRequests.length === 0 ? (
        <p>{s.noPayouts}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>{s.colRequested}</th><th>{s.colReseller}</th><th>{s.colAmount}</th><th>{s.colMethod}</th>
              <th>{s.colAccountNote}</th><th>{s.colStatus}</th><th>{s.colDecidedBy}</th><th>{s.colActions}</th>
            </tr>
          </thead>
          <tbody>
            {payoutRequests.map((r) => (
              <tr key={r.id}>
                <td>{new Date(r.createdAt).toLocaleDateString(locale === "bn" ? "bn-BD" : "en-GB")}</td>
                <td>{r.resellerName} ({r.resellerPhoneMasked})</td>
                <td>{formatBdt(r.amountPoisha)}</td>
                <td>{r.method}</td>
                <td>{r.accountNote}</td>
                <td>{r.status}</td>
                <td>{r.decidedById ?? "—"}</td>
                <td><PayoutActions payoutId={r.id} status={r.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <RevokeResellerSessions />
    </main>
  );
}
