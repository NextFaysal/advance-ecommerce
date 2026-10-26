import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { PageHeader } from "@/components/ui/page-header";
import { listActiveProducts } from "@/catalog/server-read";
import { demoPosFlags, isPosEnabled } from "@/pos/flags";
import { openShiftForRegister } from "@/pos/register";
import { listRegistersDb, listSalesDb, listShiftsDb } from "@/pos/store";
import PosRegisterClient, { type PosCatalogEntry } from "./register-client";

// POS register — Agent 38 (module built by Agent 14 in src/pos).
// Locked state: while module.pos is OFF (seeded default, paid add-on),
// the page renders the lock panel, matching the API's 403 FEATURE_LOCKED.
// Unlocked: the register screen below works on the Prisma DB store
// (src/pos/store.ts) for shifts/sales, and the product catalog is the
// REAL catalog DB (ACTIVE products via src/catalog/server-read).
export const dynamic = "force-dynamic";

export default async function AdminPosPage() {
  await ensureDbFeatureFlags().catch(() => {});
  if (!isPosEnabled(demoPosFlags)) {
    return (
      <main>
        <PageHeader title="পয়েন্ট অব সেল (POS)" description="দোকান / আউটলেট কাউন্টারের অফলাইন-ফার্স্ট রেজিস্টার" />
        <p role="status">
          🔒 এই মডিউলটি এই ইনস্টলে লক করা আছে। POS একটি পেইড অ্যাড-অন — আনলক করতে Admin &gt; Settings &gt; Feature Flags থেকে{" "}
          <code>module.pos</code> চালু করুন।
        </p>
      </main>
    );
  }

  const [registers, shifts, sales] = await Promise.all([
    listRegistersDb(),
    listShiftsDb(),
    listSalesDb(),
  ]);
  const register = registers[0]!;
  const initialShift = openShiftForRegister(shifts, register.id);
  const initialSales = initialShift ? sales.filter((s) => s.shiftId === initialShift.id) : [];

  const catalog: PosCatalogEntry[] = [];
  for (const product of await listActiveProducts(100)) {
    for (const variant of product.variants) {
      if (!variant.isActive) continue;
      const attributeText = Object.values(variant.attributes).join(" / ");
      catalog.push({
        variantId: variant.id,
        sku: variant.sku,
        productName: attributeText ? `${product.title.bn} (${attributeText})` : product.title.bn,
        pricePoisha: variant.pricePoisha,
        stock: variant.stock,
      });
    }
  }

  return (
    <main>
      <PageHeader
        title="পয়েন্ট অব সেল (POS)"
        description="শিফট/বিক্রির ডেটা আসল ডাটাবেসে থাকে (src/pos/store.ts), পণ্যের ক্যাটালগও আসল ডাটাবেস থেকে আসে। POS বিক্রি এখানে ডাটাবেস রেকর্ড — আসল Order তৈরি হয় না।"
        breadcrumb="Admin / Sales"
      />
      <PosRegisterClient
        register={{ id: register.id, name: register.name }}
        catalog={catalog}
        initialShift={initialShift}
        initialSales={initialSales}
      />
    </main>
  );
}
