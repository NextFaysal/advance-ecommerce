import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { PageHeader } from "@/admin-shell/PageHeader";
import { listActiveProducts } from "@/catalog/server-read";
import { demoPosFlags, isPosEnabled } from "@/pos/flags";
import { openShiftForRegister } from "@/pos/register";
import { listRegistersDb, listSalesDb, listShiftsDb } from "@/pos/store";
import { getRequestLocale } from "@/i18n/server";
import { interpolate, pick } from "@/i18n/locale";
import PosRegisterClient, { type PosCatalogEntry } from "./register-client";
import { POS_STRINGS } from "./strings";

// POS register — Agent 38 (module built by Agent 14 in src/pos).
// Locked state: while module.pos is OFF (seeded default, paid add-on),
// the page renders the lock panel, matching the API's 403 FEATURE_LOCKED.
// Unlocked: the register screen below works on the Prisma DB store
// (src/pos/store.ts) for shifts/sales, and the product catalog is the
// REAL catalog DB (ACTIVE products via src/catalog/server-read).
export const dynamic = "force-dynamic";

export default async function AdminPosPage() {
  const locale = await getRequestLocale();
  const s = pick(locale, POS_STRINGS);
  await ensureDbFeatureFlags().catch(() => {});
  if (!isPosEnabled(demoPosFlags)) {
    return (
      <main>
        <PageHeader title={s.pageTitle} subtitle={s.lockedDesc} />
        <p role="status">{interpolate(s.lockedText, { flag: "module.pos" })}</p>
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
  const initialSales = initialShift ? sales.filter((sale) => sale.shiftId === initialShift.id) : [];

  const catalog: PosCatalogEntry[] = [];
  for (const product of await listActiveProducts(100)) {
    for (const variant of product.variants) {
      if (!variant.isActive) continue;
      const attributeText = Object.values(variant.attributes).join(" / ");
      const productName = product.title[locale];
      catalog.push({
        variantId: variant.id,
        sku: variant.sku,
        productName: attributeText ? `${productName} (${attributeText})` : productName,
        pricePoisha: variant.pricePoisha,
        stock: variant.stock,
      });
    }
  }

  return (
    <main>
      <PageHeader title={s.pageTitle} subtitle={s.pageDescription} />
      <PosRegisterClient
        register={{ id: register.id, name: register.name }}
        catalog={catalog}
        initialShift={initialShift}
        initialSales={initialSales}
      />
    </main>
  );
}
