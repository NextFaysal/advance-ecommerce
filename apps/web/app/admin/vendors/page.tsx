import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
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
import type { VendorPayoutSummary } from "@/vendors/types";

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
const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "সক্রিয় (ACTIVE)",
  PENDING: "অপেক্ষমাণ (PENDING)",
  SUSPENDED: "স্থগিত (SUSPENDED)",
  REJECTED: "প্রত্যাখ্যাত (REJECTED)",
};
const APPROVAL_TONE: Record<string, "success" | "warning" | "info" | "danger"> = {
  APPROVED: "success",
  PENDING_REVIEW: "warning",
  CHANGES_REQUESTED: "info",
  REJECTED: "danger",
};

export default async function AdminVendorsPage() {
  if (!demoVendorFlags.isEnabled("module.multi_vendor")) {
    return (
      <main>
        <PageHeader title="ভেন্ডর (মাল্টি-ভেন্ডর)" description="Vendor management, approvals and payouts (A12)" />
        <p role="status">
          এই মডিউলটি এই ইনস্টলে লক করা আছে। মাল্টি-ভেন্ডর একটি পেইড অ্যাড-অন —
          খুলতে Admin &gt; Settings থেকে <code>module.multi_vendor</code> ফিচার ফ্ল্যাগ চালু করুন।
          (This module is locked — enable the <code>module.multi_vendor</code> feature flag to unlock it.)
        </p>
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
    commission: `${(v.commissionBps / 100).toFixed(1)}%`,
    products: <span className="font-mono tabular-nums">{productCountOf(v.id)}</span>,
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
    orders: <span className="font-mono tabular-nums">{summary.orderCount}</span>,
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
    <main>
      <PageHeader
        title="ভেন্ডর (মাল্টি-ভেন্ডর)"
        description="আসল ডেটা — Vendor, VendorProduct, VendorCommissionLine ও VendorRefund টেবিল থেকে। কমিশন ও পেআউট আসল সার্ভিস ফাংশন দিয়ে হিসাব করা; ফোন মাস্ক করা। (Vendors)"
        breadcrumb="Admin / Add-on Modules"
      />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="মোট ভেন্ডর"
          value={String(vendors.length)}
          delta={`${vendors.filter((v) => v.status === "ACTIVE").length} সক্রিয়`}
          icon={<Icon name="store" size={22} />}
        />
        <StatCard
          label="পণ্য রিভিউ বাকি"
          value={String(pendingProducts.length)}
          delta="অনুমোদনের সারিতে"
          deltaTone="down"
          icon={<Icon name="package" size={22} />}
        />
        <StatCard
          label="মোট বিক্রি (সব ভেন্ডর)"
          value={formatPoisha(totalGross)}
          delta={`${totalLines}টি কমিশন লাইন`}
          icon={<Icon name="chart" size={22} />}
        />
        <StatCard
          label="নিট পাওনা (সব ভেন্ডর)"
          value={formatPoisha(totalNet)}
          delta="কমিশন ও রিফান্ড বাদে"
          icon={<Icon name="banknote" size={22} />}
        />
      </div>

      <h2 className="mb-3 text-lg font-semibold">ভেন্ডর তালিকা</h2>
      {vendors.length === 0 ? (
        <div className="rounded-lg border border-border bg-card px-6 py-12 text-center shadow-card">
          <h3 className="text-h3">কোনো ভেন্ডর নেই</h3>
          <p className="mx-auto mt-1 max-w-md text-small leading-relaxed text-text-muted">
            ডাটাবেসে এখনো কোনো ভেন্ডর যোগ হয়নি। Vendor API (POST /api/v1/admin/vendors) দিয়ে
            প্রথম ভেন্ডর তৈরি করলেই এখানে দেখা যাবে।
          </p>
        </div>
      ) : (
        <DataTable
          caption="ভেন্ডর — শুধু ACTIVE ভেন্ডরের APPROVED পণ্যই স্টোরফ্রন্টে বিক্রি হয় (isSellable নিয়ম)। মালিকের নাম এখন DB-তে সংরক্ষিত হয়; পুরনো ভেন্ডরদের ক্ষেত্রে নাম কখনো সংরক্ষিত হয়নি, তাই '—' দেখানো হয়।"
          columns={[
            { key: "shop", header: "দোকান" },
            { key: "owner", header: "মালিক" },
            { key: "phone", header: "ফোন" },
            { key: "commission", header: "কমিশন" },
            { key: "products", header: "পণ্য" },
            { key: "status", header: "অবস্থা" },
          ]}
          rows={vendorRows}
        />
      )}

      <h2 className="mb-3 mt-8 text-lg font-semibold">KYC যাচাই (ADV-13)</h2>
      {vendors.length === 0 ? (
        <p className="rounded-md bg-surface-2 px-3.5 py-2.5 text-small leading-relaxed text-text-muted">
          ভেন্ডর না থাকায় KYC তালিকা নেই।
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
                <div className="mt-2 rounded-lg border border-border bg-card px-4 py-3 shadow-card">
                  <VendorDocumentsControl vendorId={v.id} />
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-2 text-small leading-relaxed text-text-muted">
        KYC অবস্থা Setting ডকুমেন্টে সংরক্ষিত (Vendor টেবিলে KYC কলাম নেই) — সিদ্ধান্ত অডিট লগে
        থাকে (vendors.kyc.update) এবং নোটটি ভেন্ডর পোর্টালে দেখা যায়। কাগজপত্র এখন
        VendorDocument টেবিলে মেটাডেটা হিসেবে রেকর্ড হয় (স্কিমা ওয়েভ ২) এবং ভেন্ডর পোর্টালে
        তালিকাভুক্ত থাকে; ফাইল আপলোড নিজে এখনো নেই — স্টোরেজ কনফিগার হয়নি, আপলোডের পথও
        তৈরি হয়নি।
      </p>

      <h2 className="mb-3 mt-8 text-lg font-semibold">পণ্য অনুমোদন</h2>
      {products.length === 0 ? (
        <p className="rounded-md bg-surface-2 px-3.5 py-2.5 text-small leading-relaxed text-text-muted">
          কোনো ভেন্ডর পণ্য এখনো জমা পড়েনি — ভেন্ডর পণ্য যোগ করলে অনুমোদনের সারিতে এখানে দেখা যাবে।
        </p>
      ) : (
        <DataTable
          caption="পণ্য অনুমোদনের সারি — অনুমোদিত পণ্যে সম্পাদনা হলেই আবার PENDING_REVIEW-তে ফেরে; সিদ্ধান্ত Vendor API দিয়ে"
          columns={[
            { key: "product", header: "পণ্য" },
            { key: "sku", header: "SKU" },
            { key: "shop", header: "দোকান" },
            { key: "price", header: "দাম" },
            { key: "approval", header: "অনুমোদন" },
            { key: "note", header: "নোট / কারণ" },
          ]}
          rows={productRows}
        />
      )}

      <h2 className="mb-3 mt-8 text-lg font-semibold">পেআউট সারাংশ — ভেন্ডর অনুযায়ী</h2>
      {vendors.length === 0 ? (
        <p className="rounded-md bg-surface-2 px-3.5 py-2.5 text-small leading-relaxed text-text-muted">
          ভেন্ডর না থাকায় পেআউট সারাংশ নেই। ডেলিভার্ড অর্ডার থেকে কমিশন লাইন তৈরি হলেই এখানে হিসাব দেখা যাবে।
        </p>
      ) : (
        <DataTable
          caption="পেআউট = মোট বিক্রি − কমিশন − রিফান্ড; কখনো শূন্যের নিচে নয় (summarizePayout)। কমিশন লাইন আসল ডেলিভার্ড অর্ডার থেকে, রিফান্ড VendorRefund টেবিল থেকে।"
          columns={[
            { key: "shop", header: "দোকান" },
            { key: "orders", header: "অর্ডার (লাইন)" },
            { key: "gross", header: "মোট বিক্রি" },
            { key: "commission", header: "কমিশন" },
            { key: "refunds", header: "রিফান্ড (বাদ)" },
            { key: "net", header: "নিট পাওনা" },
          ]}
          rows={payoutRows}
        />
      )}

      <VendorPayoutActions />
    </main>
  );
}
