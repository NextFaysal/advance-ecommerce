import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Money, formatPoisha } from "@/components/ui/money";
import { Phone } from "@/components/ui/phone";
import { Icon } from "@/components/ui/icon";
import { demoVendorFlags } from "@/vendors/flags";
import { vendorStore } from "@/vendors/db-store";
import { summarizePayout } from "@/vendors/service";
import { defaultVendorKyc } from "@/vendors/kyc";
import { listVendorKyc } from "@/vendors/kyc-store";
import KycControl from "./kyc-control";
import VendorDocumentsControl from "./documents-control";
import VendorPayoutActions from "./payout-actions";
import RevokeVendorSessions from "./revoke-sessions";
import type { VendorPayoutSummary } from "@/vendors/types";
import { getRequestLocale } from "@/i18n/server";
import { interpolate, pick } from "@/i18n/locale";
import { VENDORS_STRINGS } from "./strings";

// Multi-vendor admin — Step 48 (A12).
// Locked state: while module.multi_vendor is OFF (seeded default, paid
// add-on), the page renders the lock panel, matching the vendor API's
// 403 FEATURE_LOCKED. When unlocked, EVERYTHING below is real DB data
// read server-side from the Prisma vendor store (src/vendors/db-store):
// vendors (Vendor), listings (VendorProduct), commission lines
// (VendorCommissionLine, written by the delivered-order hook) and
// refund chargebacks (VendorRefund). Payout summaries are computed
// with the real summarizePayout() — commission in basis points,
// floored to whole poisha; refunds reduce the payout and it never
// goes below zero. Phones masked via <Phone>.
// ownerName persists on Vendor.ownerName (reviews_and_small_fixes
// migration, 2026-10-25) and reads back through the store; vendors
// created before that column existed still show "—" (no name was
// ever stored for them — the page never invents one).
export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  ACTIVE: "success",
  PENDING: "warning",
  SUSPENDED: "danger",
  REJECTED: "neutral",
};

const APPROVAL_TONE: Record<string, "success" | "warning" | "info" | "danger"> = {
  APPROVED: "success",
  PENDING_REVIEW: "warning",
  CHANGES_REQUESTED: "info",
  REJECTED: "danger",
};

export default async function AdminVendorsPage() {
  const locale = await getRequestLocale();
  const s = pick(locale, VENDORS_STRINGS);
  const STATUS_LABEL: Record<string, string> = { ACTIVE: s.statusActive, PENDING: s.statusPending, SUSPENDED: s.statusSuspended, REJECTED: s.statusRejected };
  await ensureDbFeatureFlags().catch(() => {});
  if (!demoVendorFlags.isEnabled("module.multi_vendor")) {
    return (
      <main className="space-y-6">
        <PageHeader title={s.title} description={s.lockedDesc} />
        <p role="status" className="rounded-2xl border border-border/60 bg-card px-5 py-4 text-sm text-text-muted shadow-xs">{s.locked}</p>
      </main>
    );
  }

  const vendors = await vendorStore.listVendors();
  const products = await vendorStore.listProducts();
  const kycDoc = await listVendorKyc();
  const payouts: { vendorId: string; summary: VendorPayoutSummary }[] = await Promise.all(
    vendors.map(async (v) => ({
      vendorId: v.id,
      summary: summarizePayout(
        v.id,
        await vendorStore.listCommissionLines(v.id),
        await vendorStore.refundsPoisha(v.id),
      ),
    })),
  );
  const payoutOf = (id: string) => payouts.find((p) => p.vendorId === id)?.summary;
  const shopName = (id: string) => vendors.find((v) => v.id === id)?.shopName ?? id;
  const productCountOf = (id: string) => products.filter((p) => p.vendorId === id).length;

  const pendingProducts = products.filter((p) => p.approval === "PENDING_REVIEW");
  const totalGross = payouts.reduce((s, p) => s + p.summary.grossPoisha, 0);
  const totalNet = payouts.reduce((s, p) => s + p.summary.netPayablePoisha, 0);
  const totalLines = payouts.reduce((s, p) => s + p.summary.orderCount, 0);

  const vendorRows = vendors.map((v) => ({
    shop: <span className="font-medium">{v.shopName}</span>,
    owner: v.ownerName !== "" ? v.ownerName : "—",
    phone: <Phone phone={v.phone} />,
    commission: <span className="tnum">{`${(v.commissionBps / 100).toFixed(1)}%`}</span>,
    products: <span className="tnum font-mono tabular-nums">{productCountOf(v.id)}</span>,
    status: (
      <Badge tone={STATUS_TONE[v.status] ?? "neutral"}>{STATUS_LABEL[v.status] ?? v.status}</Badge>
    ),
  }));

  const productRows = products.map((p) => ({
    product: <span className="font-medium">{p.productName}</span>,
    sku: <span className="font-mono text-xs">{p.sku}</span>,
    shop: shopName(p.vendorId),
    price: <Money poisha={p.pricePoisha} />,
    approval: (
      <Badge tone={APPROVAL_TONE[p.approval] ?? "warning"}>{p.approval}</Badge>
    ),
    note: p.rejectionReason ?? "—",
  }));

  const payoutRows = payouts.map(({ vendorId, summary }) => ({
    shop: <span className="font-medium">{shopName(vendorId)}</span>,
    orders: <span className="tnum font-mono tabular-nums">{summary.orderCount}</span>,
    gross: <Money poisha={summary.grossPoisha} />,
    commission: <Money poisha={summary.commissionPoisha} />,
    refunds: <Money poisha={summary.refundsPoisha} />,
    net: (
      <span className="font-semibold">
        <Money poisha={summary.netPayablePoisha} />
      </span>
    ),
  }));

  return (
    <main className="space-y-6">
      <PageHeader title={s.title} description={s.description} breadcrumb={s.breadcrumb} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label={s.statTotalVendors}
          value={String(vendors.length)}
          delta={interpolate(s.statActive, { count: vendors.filter((v) => v.status === "ACTIVE").length })}
          icon={<Icon name="store" size={22} />}
        />
        <StatCard
          label={s.statPendingProducts}
          value={String(pendingProducts.length)}
          delta={s.statPendingDelta}
          deltaTone="down"
          icon={<Icon name="package" size={22} />}
        />
        <StatCard
          label={s.statTotalSales}
          value={formatPoisha(totalGross)}
          delta={interpolate(s.statLines, { count: totalLines })}
          icon={<Icon name="chart" size={22} />}
        />
        <StatCard
          label={s.statNet}
          value={formatPoisha(totalNet)}
          delta={s.statNetDelta}
          icon={<Icon name="banknote" size={22} />}
        />
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-text-main">{s.vendorListTitle}</h2>
        {vendors.length === 0 ? (
          <EmptyState title={s.noVendorsTitle} description={s.noVendorsText} />
        ) : (
        <DataTable
          caption={s.vendorCaption}
          columns={[
            { key: "shop", header: s.colShop },
            { key: "owner", header: s.colOwner },
            { key: "phone", header: s.colPhone },
            { key: "commission", header: s.colCommission },
            { key: "products", header: s.colProducts },
            { key: "status", header: s.colStatus },
          ]}
          rows={vendorRows}
        />
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-text-main">{s.kycTitle}</h2>
        {vendors.length === 0 ? (
          <p className="rounded-xl border border-border/60 bg-surface-2/60 px-3.5 py-2.5 text-small leading-relaxed text-text-muted">
            {s.noKyc}
          </p>
        ) : (
        <div className="space-y-3">
          {vendors.map((v) => {
            const record = kycDoc[v.id] ?? defaultVendorKyc(v.id);
            return (
              <div key={v.id}>
                <KycControl
                  vendorId={v.id}
                  shopName={v.shopName}
                  initialStatus={record.status}
                  initialNote={record.note}
                />
                <div className="mt-2 rounded-2xl border border-border/60 bg-card px-4 py-3 shadow-xs">
                  <VendorDocumentsControl vendorId={v.id} />
                </div>
              </div>
            );
          })}
          </div>
        )}
        <p className="text-small leading-relaxed text-text-muted">
          {s.kycNote}
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-text-main">{s.productApprovalTitle}</h2>
        {products.length === 0 ? (
          <p className="rounded-xl border border-border/60 bg-surface-2/60 px-3.5 py-2.5 text-small leading-relaxed text-text-muted">
            {s.noProducts}
          </p>
        ) : (
        <DataTable
          caption={s.productCaption}
          columns={[
            { key: "product", header: s.colProduct },
            { key: "sku", header: s.colSku },
            { key: "shop", header: s.colShop },
            { key: "price", header: s.colPrice },
            { key: "approval", header: s.colApproval },
            { key: "note", header: s.colNote },
          ]}
          rows={productRows}
        />
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-text-main">{s.payoutSummaryTitle}</h2>
        {vendors.length === 0 ? (
          <p className="rounded-xl border border-border/60 bg-surface-2/60 px-3.5 py-2.5 text-small leading-relaxed text-text-muted">
            {s.noPayoutSummary}
          </p>
        ) : (
        <DataTable
          caption={s.payoutCaption}
          columns={[
            { key: "shop", header: s.colShop },
            { key: "orders", header: s.colOrders },
            { key: "gross", header: s.colGross },
            { key: "commission", header: s.colCommission },
            { key: "refunds", header: s.colRefunds },
            { key: "net", header: s.colNet },
          ]}
          rows={payoutRows}
        />
        )}
      </section>

      <VendorPayoutActions />

      <RevokeVendorSessions />
    </main>
  );
}
