/**
 * Aurora theme strings — unified language system (doc 30), L1 slice.
 *
 * Slice-local dictionary for the Aurora slot components
 * (home-sections, pdp-composition, shop-chrome). Strings that exist in
 * the shared dictionary (src/i18n/dictionaries.ts COMMON_STRINGS) are
 * NOT repeated here — the components use both. Everything else that is
 * user-visible in the Aurora slots lives here, in both locales.
 *
 * Typing follows the doc-30 pattern exactly: the `bn` object is typed
 * once, `en` is typed as the mapped AuroraStrings, so a missing or
 * extra key in either locale fails compilation (parity guarantee).
 *
 * Merchant/content data (product titles, category names, review text,
 * CMS slides) is NOT here — it is data, resolved from its own bn/en
 * fields where the data carries them.
 */
import type { Locale } from "@/i18n/locale";

const bn = {
  /* ---------- shared (home / pdp / shop breadcrumbs) ---------- */
  breadcrumbAria: "ব্রেডক্রাম্ব",
  shopBreadcrumb: "দোকান",

  /* ---------- home-sections: hero ---------- */
  heroHeadline: "সারাদেশে হোম ডেলিভারি, পছন্দের সব পণ্য",
  heroSub:
    "ফ্যাশন, ইলেকট্রনিক্স, ঘরোয়া পণ্য ও আরও অনেক কিছু — যাচাই করা অরিজিনাল পণ্য, সেরা দামে, ঘরে বসে অর্ডার করুন বাংলায়।",
  heroCta: "কেনাকাটা শুরু করুন",
  heroCodText: "পণ্য হাতে পেয়ে টাকা দিন — কোনো অগ্রিম ঝামেলা নেই।",
  heroFastDeliveryTitle: "দ্রুত ডেলিভারি",
  heroDeliveryText: "সারাদেশের সব জেলায় নির্ভরযোগ্য কুরিয়ার পার্টনার।",
  heroQualityTitle: "যাচাইকৃত মান",
  heroQualityText: "প্রতিটি অর্ডার পাঠানোর আগে মান যাচাই করা হয়।",

  /* ---------- home-sections: trust row / why-us ---------- */
  trustCodTitle: "ক্যাশ অন ডেলিভারি",
  trustCodText: "পণ্য হাতে পেয়ে নিশ্চিন্তে মূল্য পরিশোধ করুন।",
  trustDeliveryTitle: "সারাদেশে হোম ডেলিভারি",
  trustDeliveryText: "ঢাকা থেকে জেলা-উপজেলা — ঘরে বসেই পণ্য পৌঁছে যাবে।",
  trustReturnTitle: "সহজ রিটার্ন",
  trustReturnText: "পণ্যে সমস্যা থাকলে সহজ শর্তে রিটার্ন ও রিফান্ড।",
  trustOriginalTitle: "১০০% অরিজিনাল পণ্য",
  trustOriginalText: "প্রতিটি পণ্য যাচাই করে তারপর আপনার কাছে পাঠাই।",
  benefitsAria: "আমাদের সুবিধা",

  /* ---------- home-sections: sections ---------- */
  categoryProductCount: "{count}টি পণ্য",
  shopByPreference: "পছন্দ অনুযায়ী কিনুন",
  viewAllProducts: "সব পণ্য দেখুন",
  limitedTimeOffer: "সীমিত সময়ের অফার",
  flashSale: "ফ্ল্যাশ সেল",
  viewAllOffers: "সব অফার দেখুন",
  featuredEyebrow: "বাছাই করা",
  popularProducts: "জনপ্রিয় পণ্য",
  whyUsEyebrow: "কেন আমরাই",
  shopWithTrust: "আস্থার সাথে কেনাকাটা",
  shopNowCta: "এখনই কেনাকাটা করুন",
  customerWordsEyebrow: "কাস্টমারদের কথা",
  customersSayTitle: "যারা কিনেছেন, তারা বলছেন",
  reviewProductLabel: "পণ্য:",
  newsletterTitle: "অফারের খবর সবার আগে পান",
  newsletterText:
    "নতুন পণ্য, ফ্ল্যাশ সেল আর বিশেষ ছাড়ের খবর সরাসরি আপনার ইমেইলে। স্প্যাম পাঠাই না — শুধু দরকারি অফার।",

  /* ---------- pdp-composition: buy box ---------- */
  preorderBadge: "প্রি-অর্ডার",
  discountOff: "ছাড়",
  ratingAria: "রেটিং {rating} / ৫",
  reviewsCount: "{count}টি রিভিউ",
  brandLabel: "ব্র্যান্ড:",
  contactForPrice: "দামের জন্য যোগাযোগ করুন",
  variantsAndPrice: "ভেরিয়েন্ট ও দাম",
  variantOnly: "ভেরিয়েন্ট",
  standardVariant: "স্ট্যান্ডার্ড",
  variantOutOfStock: " (স্টক শেষ)",

  /* ---------- pdp-composition: product-type notices ---------- */
  digitalTitle: "📥 ডিজিটাল পণ্য — পেমেন্টের পরেই ডাউনলোড লিংক",
  digitalBody:
    "এটি কোনো ফিজিক্যাল পণ্য নয়, কুরিয়ারে কিছু আসবে না — পেমেন্ট সম্পূর্ণ হলেই ডাউনলোড লিংক (আর লাইসেন্স কী থাকলে সেটিও) পৌঁছে যাবে।",
  preorderNoticeTitle: "🗓️ এটি একটি প্রি-অর্ডার পণ্য — এখন বুকিং চলছে",
  expectedDelivery: "সম্ভাব্য ডেলিভারি:",
  preorderDepositPrefix: "বুকিং কনফার্ম করতে অগ্রিম",
  preorderDepositSuffix: "দিতে হবে — বাকি টাকা ডেলিভারির সময়।",
  preorderMaxPrefix: "সীমিত প্রি-অর্ডার: সর্বোচ্চ",
  preorderMaxSuffix: "টি পর্যন্ত বুকিং নেওয়া হবে।",
  bundleUnavailableNotice:
    "এই বান্ডলের অন্তত একটি কম্পোনেন্ট আপাতত স্টকে নেই — তাই বান্ডলটি এখন কেনা যাচ্ছে না।",
  priceOnRequestTitle: "এই পণ্যের দাম অনুরোধে জানানো হয়",
  priceOnRequestBody:
    "দাম জানতে আমাদের বার্তা পাঠান — পণ্যের নামটি উল্লেখ করলেই স্টাফ দাম ও অর্ডারের ব্যবস্থা করে দেবেন।",
  preorderCta: "প্রি-অর্ডার করুন",
  preorderBuyNow: "এখনই প্রি-অর্ডার করুন",
  bundleOutOfStockLabel: "বান্ডল স্টকে নেই",

  /* ---------- pdp-composition: POD + weighted notes ---------- */
  podStrong: "কাস্টম প্রিন্ট:",
  podBodyStart: "এই পণ্যে আপনার নিজের লেখা ছাপানো যাবে (সর্বোচ্চ",
  podCharsUnit: "অক্ষর",
  podColorsPart: ", রঙও বেছে নেওয়া যাবে",
  podBodyEnd: ") — লেখাটি চেকআউটে দিতে হবে।",
  podFee: " প্রিন্ট ফি প্রতি আইটেমে {fee} টাকা, অর্ডারের মোটে যোগ হবে।",
  weightedTitle: "⚖️ ওজন অনুযায়ী দাম — প্যাকের ভগ্নাংশেও কেনা যায় (ওজনের ধাপ অনুযায়ী)",
  packLabel: "প্যাক:",
  gramsUnit: "গ্রাম",
  perKgLabel: "প্রতি কেজি",
  packPriceLabel: "প্যাকের দাম",
  weightedOutOfSync: "(হার অনুযায়ী দাম হালনাগাদ বাকি — উপরে দেখানো দামই প্রযোজ্য)",

  /* ---------- pdp-composition: trust rows + sections ---------- */
  trustPdpCod: "ক্যাশ অন ডেলিভারি — পণ্য হাতে পেয়ে মূল্য পরিশোধ করুন",
  trustPdpDelivery: "সারাদেশে হোম ডেলিভারি — ডেলিভারি চার্জ ও সময় চেকআউটে দেখা যাবে",
  trustPdpReturn: "সহজ রিটার্ন সুবিধা — শর্ত প্রযোজ্য",
  trustPdpOriginal: "যাচাই করা অরিজিনাল পণ্য",
  specifications: "স্পেসিফিকেশন",
  fitNoteLabel: "ফিট নোট:",
  bundleContentsTitle: "এই বান্ডলে যা যা আছে",
  componentProduct: "কম্পোনেন্ট পণ্য",
  bundleSeparateTotal: "আলাদা করে কিনলে মোট:",
  bundlePriceLabel: "বান্ডল দাম:",
  savingsLabel: "সাশ্রয়",
  bundleUnavailableNote:
    "আপাতত বান্ডলটি স্টকে নেই — কম্পোনেন্টগুলো আলাদাভাবে কিনতে উপরের লিংকগুলো দেখুন।",
  relatedProducts: "সম্পর্কিত পণ্য",

  /* ---------- shop-chrome: filter panel ---------- */
  priceFilterTitle: "মূল্য",
  brandFilterTitle: "ব্র্যান্ড",
  ratingFilterTitle: "রেটিং",
  availabilityTitle: "প্রাপ্যতা",
  allCategories: "সব ক্যাটাগরি",
  allPrices: "সব দাম",
  allBrands: "সব ব্র্যান্ড",
  ratingAll: "সব রেটিং",
  rating4Up: "৪★ ও উপরে",
  rating3Up: "৩★ ও উপরে",
  inStockOnlyLabel: "শুধু স্টকে আছে",
  priceUnder500: "৫০০ টাকার কম",
  price500to1000: "৫০০ – ১,০০০ টাকা",
  price1000to3000: "১,০০০ – ৩,০০০ টাকা",
  priceOver3000: "৩,০০০ টাকার বেশি",

  /* ---------- shop-chrome: toolbar ---------- */
  sortRelevance: "জনপ্রিয়তা",
  sortNewest: "নতুন আগে",
  sortPriceAsc: "দাম: কম থেকে বেশি",
  sortPriceDesc: "দাম: বেশি থেকে কম",
  sortRating: "রেটিং",
  sortByLabel: "সাজান:",
  productsCountLine: "মোট {count}টি পণ্য",
  filtersAppliedSuffix: " — ফিল্টার প্রয়োগ করা হয়েছে",
  activeFiltersCount: "{count}টি ফিল্টার সক্রিয়",
  removeFilterAria: "{label} ফিল্টার সরান",
  clearAllFilters: "সব ফিল্টার মুছুন",
};

export type AuroraStrings = { [K in keyof typeof bn]: string };

const en: AuroraStrings = {
  /* ---------- shared ---------- */
  breadcrumbAria: "Breadcrumb",
  shopBreadcrumb: "Shop",

  /* ---------- home-sections: hero ---------- */
  heroHeadline: "Home delivery nationwide, all your favourite products",
  heroSub:
    "Fashion, electronics, home essentials and much more — verified original products at the best prices, ordered from home.",
  heroCta: "Start Shopping",
  heroCodText: "Pay when you receive your product — no advance payment hassle.",
  heroFastDeliveryTitle: "Fast Delivery",
  heroDeliveryText: "Reliable courier partners in every district across the country.",
  heroQualityTitle: "Verified Quality",
  heroQualityText: "Every order is quality-checked before it is dispatched.",

  /* ---------- home-sections: trust row / why-us ---------- */
  trustCodTitle: "Cash on Delivery",
  trustCodText: "Pay with peace of mind after receiving your product.",
  trustDeliveryTitle: "Home Delivery Nationwide",
  trustDeliveryText: "From Dhaka to every district and upazila — delivered to your door.",
  trustReturnTitle: "Easy Returns",
  trustReturnText: "Easy returns and refunds if there is a problem with the product.",
  trustOriginalTitle: "100% Original Products",
  trustOriginalText: "Every product is verified before we send it to you.",
  benefitsAria: "Our benefits",

  /* ---------- home-sections: sections ---------- */
  categoryProductCount: "{count} products",
  shopByPreference: "Shop to your taste",
  viewAllProducts: "View all products",
  limitedTimeOffer: "Limited-time offer",
  flashSale: "Flash Sale",
  viewAllOffers: "View all offers",
  featuredEyebrow: "Handpicked",
  popularProducts: "Popular Products",
  whyUsEyebrow: "Why us",
  shopWithTrust: "Shop with confidence",
  shopNowCta: "Shop now",
  customerWordsEyebrow: "From our customers",
  customersSayTitle: "What buyers are saying",
  reviewProductLabel: "Product:",
  newsletterTitle: "Get offer news first",
  newsletterText:
    "New products, flash sales and special discount news straight to your email. We never spam — only useful offers.",

  /* ---------- pdp-composition: buy box ---------- */
  preorderBadge: "Pre-order",
  discountOff: "off",
  ratingAria: "Rating {rating} / 5",
  reviewsCount: "{count} reviews",
  brandLabel: "Brand:",
  contactForPrice: "Contact for price",
  variantsAndPrice: "Variants & price",
  variantOnly: "Variants",
  standardVariant: "Standard",
  variantOutOfStock: " (Out of stock)",

  /* ---------- pdp-composition: product-type notices ---------- */
  digitalTitle: "📥 Digital product — download link right after payment",
  digitalBody:
    "This is not a physical product; nothing will arrive by courier — as soon as payment completes, the download link (and licence key, if any) will be delivered.",
  preorderNoticeTitle: "🗓️ This is a pre-order product — booking is open now",
  expectedDelivery: "Expected delivery:",
  preorderDepositPrefix: "To confirm your booking, pay",
  preorderDepositSuffix: "in advance — the rest is due at delivery.",
  preorderMaxPrefix: "Limited pre-order: bookings will be taken for up to",
  preorderMaxSuffix: "units only.",
  bundleUnavailableNotice:
    "At least one component of this bundle is currently out of stock — so the bundle cannot be bought right now.",
  priceOnRequestTitle: "The price of this product is given on request",
  priceOnRequestBody:
    "Message us to know the price — just mention the product name and our staff will arrange the price and your order.",
  preorderCta: "Pre-order",
  preorderBuyNow: "Pre-order now",
  bundleOutOfStockLabel: "Bundle out of stock",

  /* ---------- pdp-composition: POD + weighted notes ---------- */
  podStrong: "Custom print:",
  podBodyStart: "Your own text can be printed on this product (up to",
  podCharsUnit: "characters",
  podColorsPart: ", and you can choose a colour too",
  podBodyEnd: ") — you will enter the text at checkout.",
  podFee: " Print fee is {fee} Taka per item, added to the order total.",
  weightedTitle: "⚖️ Priced by weight — buy fractional packs too (by weight steps)",
  packLabel: "Pack:",
  gramsUnit: "grams",
  perKgLabel: "per kg",
  packPriceLabel: "Pack price",
  weightedOutOfSync: "(Price update by rate pending — the price shown above applies)",

  /* ---------- pdp-composition: trust rows + sections ---------- */
  trustPdpCod: "Cash on Delivery — pay after receiving the product",
  trustPdpDelivery: "Home delivery nationwide — delivery charge and time shown at checkout",
  trustPdpReturn: "Easy return facility — terms apply",
  trustPdpOriginal: "Verified original product",
  specifications: "Specifications",
  fitNoteLabel: "Fit note:",
  bundleContentsTitle: "What's in this bundle",
  componentProduct: "Component product",
  bundleSeparateTotal: "Total if bought separately:",
  bundlePriceLabel: "Bundle price:",
  savingsLabel: "Save",
  bundleUnavailableNote:
    "The bundle is currently out of stock — see the links above to buy the components separately.",
  relatedProducts: "Related products",

  /* ---------- shop-chrome: filter panel ---------- */
  priceFilterTitle: "Price",
  brandFilterTitle: "Brand",
  ratingFilterTitle: "Rating",
  availabilityTitle: "Availability",
  allCategories: "All categories",
  allPrices: "All prices",
  allBrands: "All brands",
  ratingAll: "All ratings",
  rating4Up: "4★ & up",
  rating3Up: "3★ & up",
  inStockOnlyLabel: "In stock only",
  priceUnder500: "Under ৳500",
  price500to1000: "৳500 – ৳1,000",
  price1000to3000: "৳1,000 – ৳3,000",
  priceOver3000: "Over ৳3,000",

  /* ---------- shop-chrome: toolbar ---------- */
  sortRelevance: "Popularity",
  sortNewest: "Newest first",
  sortPriceAsc: "Price: low to high",
  sortPriceDesc: "Price: high to low",
  sortRating: "Rating",
  sortByLabel: "Sort:",
  productsCountLine: "Total {count} products",
  filtersAppliedSuffix: " — filters applied",
  activeFiltersCount: "{count} filters active",
  removeFilterAria: "Remove {label} filter",
  clearAllFilters: "Clear all filters",
};

export const AURORA_STRINGS: Record<Locale, AuroraStrings> = { bn, en };
