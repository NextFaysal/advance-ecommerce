import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Money, formatPoisha } from "@/components/ui/money";
import { Phone } from "@/components/ui/phone";
import { demoVendorFlags } from "@/vendors/flags";
import { demoVendorStore } from "@/vendors/store";
import { computeCommission, summarizePayout } from "@/vendors/service";
import type { Vendor, VendorProduct } from "@/vendors/types";

// Multi-vendor admin — Agent 25, Step 48 (A12).
// Locked state: while module.multi_vendor is OFF (seeded default, paid
// add-on), the page renders the lock panel, matching the vendor API's
// 403 FEATURE_LOCKED. When unlocked: vendors come from the Agent 16 demo
// store plus page-local SAMPLE rows (labelled); the payout summary is
// computed with the real computeCommission()/summarizePayout() — those
// assert the flag, which is why they only run in the unlocked branch.
// Commission is basis points, floored to whole poisha; refunds reduce
// the payout and it never goes below zero. Phones masked via <Phone>.

const SAMPLE_VENDORS: Vendor[] = [
  {
    id: "vendor_sample_active",
    shopName: "SAMPLE Active Gadget Shop",
    ownerName: "Demo Seller",
    phone: "+8801700000021",
    status: "ACTIVE",
    commissionBps: 1200,
    createdAt: "2026-09-05T00:00:00.000Z",
  },
  {
    id: "vendor_sample_suspended",
    shopName: "SAMPLE Suspended Fashion",
    ownerName: "Demo Seller",
    phone: "+8801700000022",
    status: "SUSPENDED",
    commissionBps: 1000,
    createdAt: "2026-08-12T00:00:00.000Z",
  },
];

const SAMPLE_PRODUCTS: VendorProduct[] = [
  {
    id: "vprod_sample_review",
    vendorId: "vendor_sample_active",
    productName: "SAMPLE Wireless Earbuds",
    sku: "SAMPLE-VP-101",
    pricePoisha: 185000,
    approval: "PENDING_REVIEW",
  },
  {
    id: "vprod_sample_approved",
    vendorId: "vendor_sample_active",
    productName: "SAMPLE Phone Case",
    sku: "SAMPLE-VP-102",
    pricePoisha: 45000,
    approval: "APPROVED",
  },
  {
    id: "vprod_sample_changes",
    vendorId: "vendor_demo_1",
    productName: "SAMPLE Vendor Product",
    sku: "SAMPLE-VP-1",
    pricePoisha: 45000,
    approval: "CHANGES_REQUESTED",
    rejectionReason: "SAMPLE: ছবি ও বিবরণ হালনাগাদ প্রয়োজন",
  },
];

/** Demo gross order amounts (poisha) for the payout vendor. */
const SAMPLE_GROSS_POISHA: readonly number[] = [250000, 185000, 99000];
const SAMPLE_REFUNDS_POISHA = 5000;

export default function AdminVendorsPage() {
  if (!demoVendorFlags.isEnabled("module.multi_vendor")) {
    return (
      <main>
        <PageHeader title="ভেন্ডর (মাল্টি-ভেন্ডর)" description="Vendor management, approvals and payouts (A12)" />
        <p role="status">
          🔒 এই মডিউলটি এই ইনস্টলে লক করা আছে। মাল্টি-ভেন্ডর একটি পেইড অ্যাড-অন —
          খুলতে Admin &gt; Settings থেকে <code>module.multi_vendor</code> ফিচার ফ্ল্যাগ চালু করুন।
          (This module is locked — enable the <code>module.multi_vendor</code> feature flag to unlock it.)
        </p>
      </main>
    );
  }

  const vendors: Vendor[] = [...demoVendorStore.listVendors(), ...SAMPLE_VENDORS];
  const products: VendorProduct[] = [...demoVendorStore.listProducts(), ...SAMPLE_PRODUCTS];
  const shopName = (id: string) => vendors.find((v) => v.id === id)?.shopName ?? id;
  const pendingProducts = products.filter((p) => p.approval === "PENDING_REVIEW");

  const payoutVendor = SAMPLE_VENDORS[0] as Vendor;
  const commissionLines = SAMPLE_GROSS_POISHA.map((gross, i) =>
    computeCommission(`order_sample_${i + 1}`, payoutVendor, gross),
  );
  const payout = summarizePayout(payoutVendor.id, commissionLines, SAMPLE_REFUNDS_POISHA);

  const vendorRows = vendors.map((v) => ({
    shop: <span className="font-medium">{v.shopName}</span>,
    owner: v.ownerName,
    phone: <Phone phone={v.phone} />,
    commission: `${(v.commissionBps / 100).toFixed(1)}%`,
    status: (
      <Badge
        tone={
          v.status === "ACTIVE"
            ? "success"
            : v.status === "PENDING"
              ? "warning"
              : v.status === "SUSPENDED"
                ? "danger"
                : "neutral"
        }
      >
        {v.status}
      </Badge>
    ),
  }));

  const productRows = products.map((p) => ({
    product: <span className="font-medium">{p.productName}</span>,
    sku: <span className="font-mono">{p.sku}</span>,
    shop: shopName(p.vendorId),
    price: <Money poisha={p.pricePoisha} />,
    approval: (
      <Badge
        tone={
          p.approval === "APPROVED"
            ? "success"
            : p.approval === "PENDING_REVIEW"
              ? "warning"
              : p.approval === "CHANGES_REQUESTED"
                ? "info"
                : "danger"
        }
      >
        {p.approval}
      </Badge>
    ),
    note: p.rejectionReason ?? "—",
  }));

  return (
    <main>
      <PageHeader
        title="ভেন্ডর (মাল্টি-ভেন্ডর)"
        description="TEMPORARY DEMO — ডেমো স্টোর + নমুনা (SAMPLE) সারি। কমিশন ও পেআউট আসল সার্ভিস ফাংশন দিয়ে হিসাব করা; ফোন মুখোশ করা। (Vendors)"
        breadcrumb="Admin / Add-on Modules"
      />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="ভেন্ডর (ডেমো)" value={String(vendors.length)} delta={`${vendors.filter((v) => v.status === "ACTIVE").length} সক্রিয়`} icon="🏪" />
        <StatCard label="পণ্য রিভিউ বাকি" value={String(pendingProducts.length)} delta="অনুমোদনের সারিতে" deltaTone="down" icon="🔎" />
        <StatCard label="পেআউট — মোট বিক্রি (নমুনা)" value={formatPoisha(payout.grossPoisha)} delta={`${payout.orderCount}টি অর্ডার`} icon="🧾" />
        <StatCard label="পেআউট — নিট পাওনা" value={formatPoisha(payout.netPayablePoisha)} delta="কমিশন ও রিফান্ড বাদে" icon="৳" />
      </div>

      <h2 className="mb-3 text-lg font-semibold">ভেন্ডর তালিকা</h2>
      <DataTable
        caption="ভেন্ডর — শুধু ACTIVE ভেন্ডরের APPROVED পণ্যই স্টোরফ্রন্টে বিক্রি হয় (isSellable নিয়ম)"
        columns={[
          { key: "shop", header: "দোকান" },
          { key: "owner", header: "মালিক" },
          { key: "phone", header: "ফোন" },
          { key: "commission", header: "কমিশন" },
          { key: "status", header: "অবস্থা" },
        ]}
        rows={vendorRows}
      />

      <h2 className="mb-3 mt-8 text-lg font-semibold">পণ্য অনুমোদন</h2>
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

      <h2 className="mb-3 mt-8 text-lg font-semibold">পেআউট সারাংশ — {payoutVendor.shopName} (নমুনা)</h2>
      <DataTable
        caption="পেআউট = মোট বিক্রি − কমিশন − রিফান্ড; কখনো শূন্যের নিচে নয় (summarizePayout)"
        columns={[
          { key: "label", header: "খাত" },
          { key: "amount", header: "পরিমাণ" },
        ]}
        rows={[
          { label: "মোট বিক্রি (gross)", amount: <Money poisha={payout.grossPoisha} /> },
          { label: `কমিশন (${(payoutVendor.commissionBps / 100).toFixed(1)}%)`, amount: <Money poisha={payout.commissionPoisha} /> },
          { label: "রিফান্ড (বাদ)", amount: <Money poisha={payout.refundsPoisha} /> },
          { label: <span className="font-semibold">নিট পাওনা</span>, amount: <Money poisha={payout.netPayablePoisha} /> },
        ]}
      />
    </main>
  );
}
