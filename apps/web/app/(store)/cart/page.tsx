import type { Metadata } from "next";
import { listActivePublicProducts } from "@/catalog/server-read";
import { getAllWeightedVariantInfos } from "@/business-modules/grocery-pricing";
import { getThemeSlots, AURORA_SLOTS } from "@/themes/slot-registry";
import { resolveStorefrontThemeFromStore } from "@/themes/resolution-server";
import { ThemeBoundary } from "@/themes/theme-boundary";
import type { ThemeCartPageProps } from "@/themes/slots";

// /cart — storefront cart page. Agent 33.
// The page itself is a thin server shell for metadata; all cart state is
// browser-side (guest cart in localStorage) so the interactive part lives
// in src/cart/components/CartPageClient.tsx. The shell feeds the client
// the real ACTIVE catalog (Prisma repository via src/catalog/server-read)
// so cart lines resolve against live products/prices — never mock data.
// Wave S3b (doc 25): the client composition is the active package's
// CartPage slot — Aurora's slot IS CartPageClient, registered in place —
// resolved here server-side with Aurora as the ThemeBoundary fallback.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "আপনার কার্ট — Advance Ecommerce",
  description: "আপনার কার্টের পণ্য, কুপন ছাড় ও ডেলিভারি চার্জসহ মোট হিসাব দেখুন।",
};

export default async function CartPage() {
  // PUBLIC shape (cost stripped): the catalog list is serialized into
  // the client component's props, so it must be the cost-free shape.
  const catalogProducts = await listActivePublicProducts(100);
  // ADV-22 (grocery pack): weighted-pack annotations (per-kg rate +
  // pack weight + derived price + sync state) for the cart lines.
  // Empty unless module.grocery is on with configured weighted
  // variants; the client renders the annotation only for its lines.
  const weightedInfos = await getAllWeightedVariantInfos();
  const weightedVariants: Record<
    string,
    {
      packGrams: number;
      pricePerKgPoisha: number;
      derivedPricePoisha: number;
      inSync: boolean;
      /** Wave 59: fractional stepper step in pack units
       *  (weightStepGrams / packGrams, e.g. 250 g of a 1 kg pack =
       *  0.25); the server gate enforces the same step at checkout. */
      stepQuantity: number;
    }
  > = {};
  for (const info of weightedInfos) {
    weightedVariants[info.variantId] = {
      packGrams: info.packGrams,
      pricePerKgPoisha: info.pricePerKgPoisha,
      derivedPricePoisha: info.derivedPricePoisha,
      inSync: info.inSync,
      stepQuantity: Math.max(1, Math.round((info.weightStepGrams * 1000) / info.packGrams)) / 1000,
    };
  }
  // CartPage slot (S3b): same server-side resolution pattern as the
  // home and PDP composition roots — registry fallback per slot,
  // Aurora as the boundary fallback.
  const { themeView } = await resolveStorefrontThemeFromStore();
  const CartPageSlot = getThemeSlots(themeView.packageId).CartPage;
  const AuroraCartPage = AURORA_SLOTS.CartPage;
  const cartProps: ThemeCartPageProps = {
    catalogProducts,
    weightedVariants,
  };
  return (
    <ThemeBoundary
      slotName="CartPage"
      packageId={themeView.packageId}
      fallback={<AuroraCartPage {...cartProps} />}
    >
      <CartPageSlot {...cartProps} />
    </ThemeBoundary>
  );
}
