// Flash sale storefront section — SERVER component wrapper.
// Reads the currently-live sale via getLiveFlashSale() and renders the
// client countdown, or nothing when no sale is live (the common case).
// A failed read also renders nothing: a marketing banner must never
// break the storefront (same convention as src/catalog/server-read).
//
// Mount (e.g. in app/page.tsx, inside the page <main>):
//   import { FlashSaleCountdownSection } from "@/marketing/flash-sale-section";
//   ...
//   <FlashSaleCountdownSection />
// No props. The parent page should be dynamic (the homepage already
// is — it reads the live catalog per request).
import { getLiveFlashSale } from "./repository";
import { FlashSaleCountdown } from "./flash-sale-countdown";

export async function FlashSaleCountdownSection() {
  let sale = null;
  try {
    sale = await getLiveFlashSale();
  } catch {
    return null;
  }
  if (!sale) return null;
  return <FlashSaleCountdown title={sale.name} endsAt={sale.endsAt} items={sale.items} />;
}
