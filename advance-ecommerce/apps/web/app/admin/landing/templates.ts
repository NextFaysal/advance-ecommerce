// Landing page templates (doc 34 §3.7 page-level presets, built in
// L6) — the standalone-page shapes of the three funnel templates.
// A template is a section SKELETON: real starter copy (bn+en) and the
// standard block order, but every product slot ships EMPTY
// (productId ""). Publish validation refuses unresolved product
// refs (validateLandingPage: PRODUCT_NOT_FOUND for product_offer /
// quick_order / bundle_offer), so a template draft CANNOT go live
// until the owner picks real products — the campaign-templates
// honesty rule (§0.7): presets never smuggle in demo products.
import {
  createEmptySection,
  type CountdownSection,
  type HeroSection,
  type LandingSection,
  type ProductGridSection,
} from "@/landing/types";

export type LandingTemplateId = "single_product_cod" | "flash_sale" | "bundle_push";

export const LANDING_TEMPLATES: { id: LandingTemplateId; labelBn: string; labelEn: string; pageTitleBn: string; pageTitleEn: string }[] = [
  {
    id: "single_product_cod",
    labelBn: "সিঙ্গেল প্রোডাক্ট COD",
    labelEn: "Single-Product COD",
    pageTitleBn: "সিঙ্গেল প্রোডাক্ট COD ক্যাম্পেইন",
    pageTitleEn: "Single-Product COD Campaign",
  },
  {
    id: "flash_sale",
    labelBn: "ফ্ল্যাশ সেল",
    labelEn: "Flash Sale",
    pageTitleBn: "ফ্ল্যাশ সেল ক্যাম্পেইন",
    pageTitleEn: "Flash Sale Campaign",
  },
  {
    id: "bundle_push",
    labelBn: "বান্ডল পুশ",
    labelEn: "Bundle Push",
    pageTitleBn: "বান্ডল অফার ক্যাম্পেইন",
    pageTitleEn: "Bundle Offer Campaign",
  },
];

function hero(titleBn: string, titleEn: string): HeroSection {
  const s = createEmptySection("hero");
  if (s.type !== "hero") throw new Error("createEmptySection(hero) mismatch");
  s.titleBn = titleBn;
  s.titleEn = titleEn;
  return s;
}

function flashCountdown(): CountdownSection {
  const s = createEmptySection("countdown");
  if (s.type !== "countdown") throw new Error("createEmptySection(countdown) mismatch");
  // Binds to the LIVE flash sale's own end — a template stores no
  // date of its own, so it can never show a fake deadline (§0.7).
  s.target = { kind: "flash_sale" };
  return s;
}

function bestSellersGrid(): ProductGridSection {
  const s = createEmptySection("product_grid");
  if (s.type !== "product_grid") throw new Error("createEmptySection(product_grid) mismatch");
  s.source = { kind: "best_sellers" };
  s.headingBn = "সেরা বিক্রিত পণ্য";
  s.headingEn = "Best sellers";
  return s;
}

/** Fresh sections for a template — built from createEmptySection so
 *  ids/defaults always match the block palette, shaped per template. */
export function buildTemplateSections(id: LandingTemplateId): LandingSection[] {
  switch (id) {
    case "single_product_cod":
      return [
        hero("বিশেষ অফার — শুধু আজকের জন্য", "Special offer — today only"),
        createEmptySection("product_offer"),
        createEmptySection("trust_strip"),
        createEmptySection("benefits"),
        createEmptySection("how_to_order"),
        createEmptySection("quick_order"),
        createEmptySection("faq"),
        createEmptySection("order_form_note"),
        createEmptySection("footer_note"),
      ];
    case "flash_sale":
      return [
        hero("ফ্ল্যাশ সেল চলছে!", "Flash sale is live!"),
        flashCountdown(),
        createEmptySection("product_offer"),
        bestSellersGrid(),
        createEmptySection("trust_strip"),
        createEmptySection("quick_order"),
        createEmptySection("order_form_note"),
        createEmptySection("footer_note"),
      ];
    case "bundle_push":
      return [
        hero("বান্ডল কিনলেই বেশি সাশ্রয়", "Buy the bundle, save more"),
        createEmptySection("bundle_offer"),
        createEmptySection("benefits"),
        createEmptySection("how_to_order"),
        createEmptySection("quick_order"),
        createEmptySection("faq"),
        createEmptySection("order_form_note"),
        createEmptySection("footer_note"),
      ];
  }
}
