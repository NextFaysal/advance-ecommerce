import { PageHeader } from "@/components/ui/page-header";
import { MOCK_PRODUCTS } from "@/catalog/mock";
import { demoPosFlags, isPosEnabled } from "@/pos/flags";
import { openShiftForRegister } from "@/pos/register";
import { DEMO_REGISTERS, demoSales, demoShifts } from "@/pos/service";
import PosRegisterClient, { type PosCatalogEntry } from "./register-client";

// POS register — Agent 38 (module built by Agent 14 in src/pos).
// Locked state: while module.pos is OFF (seeded default, paid add-on),
// the page renders the lock panel, matching the API's 403 FEATURE_LOCKED.
// Unlocked: the register screen below works on the src/pos demo store
// (TEMPORARY, in-memory) and the TEMPORARY MOCK catalog, labelled.
export default function AdminPosPage() {
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

  const register = DEMO_REGISTERS[0]!;
  const initialShift = openShiftForRegister(demoShifts, register.id);
  const initialSales = initialShift ? demoSales.filter((s) => s.shiftId === initialShift.id) : [];

  const catalog: PosCatalogEntry[] = [];
  for (const product of MOCK_PRODUCTS) {
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
        description="TEMPORARY DEMO — ডেটা src/pos ইন-মেমরি ডেমো স্টোরে থাকে (রিস্টার্টে মুছে যায়), পণ্য TEMPORARY MOCK ক্যাটালগ থেকে। POS বিক্রি এখানে ডেমো রেকর্ড — আসল Order তৈরি হয় না।"
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
