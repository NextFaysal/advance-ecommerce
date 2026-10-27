/**
 * Boighor theme-local dictionary (doc 30 unified language system).
 *
 * Every hardcoded UI string in this package lives here, in BOTH
 * locales, following the exact pattern of src/i18n/dictionaries.ts:
 * the `bn` object is written once, `en` is typed as the mapped
 * string type over bn's keys, so a missing/extra key in either
 * locale fails compilation (parity). Templates use `{name}`
 * placeholders, filled with interpolate() from "@/i18n/locale".
 *
 * Merchant/DB content (product titles, category names, CMS menu
 * labels, review text…) is NOT translated here — bilingual data
 * fields are selected per-locale at the call site via
 * pickLocalized() below. Only this package's own hardcoded UI
 * copy lives in the dictionary.
 */
import type { Locale } from "@/i18n/locale";
import type { IconName } from "@/components/ui/icon";

/** Bilingual merchant-data field picker: the locale's own field
 *  when present, else the Bangla field (the platform's source). */
export function pickLocalized(locale: Locale, bn: string, en?: string | null): string {
  return locale === "en" && en ? en : bn;
}

const bn = {
  // Header
  deliveryLine: "সারাদেশে হোম ডেলিভারি — পণ্য হাতে পেয়ে মূল্য পরিশোধ করুন",
  quickLinksAria: "দ্রুত লিংক",
  trackOrder: "অর্ডার ট্র্যাক করুন",
  signIn: "সাইন ইন",
  searchPlaceholder: "বই বা পণ্য খুঁজুন… নাম, লেখক বা বিষয় লিখুন",
  searchAria: "পণ্য খুঁজুন",
  searchButtonAria: "খুঁজুন",
  account: "অ্যাকাউন্ট",
  wishlist: "পছন্দের তালিকা",
  cart: "কার্ট",
  cartAria: "কার্ট — ড্রয়ার খুলুন",
  cartAriaCount: "কার্ট, {count}টি পণ্য — ড্রয়ার খুলুন",
  categoriesAria: "ক্যাটাগরি",
  allCategories: "সব ক্যাটাগরি",
  quickFiltersAria: "দ্রুত ফিল্টার",
  quickView: "দ্রুত দেখুন:",
  allProducts: "সব পণ্য",
  newestArrivals: "নতুন এসেছে",
  lowestPriceFirst: "কম দাম আগে",
  highestRated: "বেশি রেটিং",

  // Footer
  footerIntro:
    "পছন্দের বই আর দরকারি পণ্য এখন ঘরে বসেই — যত্নে বাছাই করা সংগ্রহ, সঠিক দাম আর সারাদেশে নির্ভরযোগ্য ডেলিভারি।",
  footerTrackOrder: "অর্ডার ট্র্যাক করুন",
  footerContact: "যোগাযোগ করুন",
  footerColInformation: "তথ্য",
  footerColShopBy: "কেনাকাটা",
  footerColSupport: "সাপোর্ট",
  footerColConsumerPolicy: "ভোক্তা নীতি",
  paymentLabel: "পেমেন্ট:",
  deliveryPartnersLabel: "ডেলিভারি পার্টনার:",
  copyrightLine: "© {year} {brand} — সর্বস্বত্ব সংরক্ষিত।",
  footerContactHint: "যোগাযোগের জন্য এখানে দেখুন",
  poweredBy: "চালনায় Advance Ecommerce",

  // Home sections
  viewAll: "সব দেখুন →",
  shortcutsAria: "শর্টকাট",
  productsCollectionCount: "{count}টি পণ্যের সংগ্রহ",
  justForYouAria: "আপনার জন্য",
  justForYouTitle: "আপনার জন্য বাছাই",
  loadMore: "আরও দেখুন",
  benefitsAria: "আমাদের সুবিধা",

  // Home hero
  heroHighlightAria: "হাইলাইট",
  staticHeadline: "পছন্দের বই, এখন দোরগোড়ায়",
  staticSubtext:
    "গল্প, উপন্যাস, পড়াশোনা আর উপহারের বই — যত্নে বাছাই করা সংগ্রহ ক্যাশ অন ডেলিভারিতে সারাদেশে।",
  staticCta: "সংগ্রহ দেখুন",
  sideAllCategories: "সব ক্যাটাগরি",
  sideAllCategoriesSub: "দোকানের সব পণ্য একসাথে দেখুন →",
  sideCategoryCount: "{count}টি পণ্য — সব দেখুন →",
  bannerPickerAria: "ব্যানার বেছে নিন",
  bannerN: "ব্যানার {n}",

  // Home categories
  categoriesHeading: "বিষয় অনুযায়ী বেছে নিন",
  prevCategories: "আগের ক্যাটাগরি",
  nextCategories: "পরের ক্যাটাগরি",
  productCount: "{count}টি পণ্য",

  // Home testimonials
  testimonialsAria: "পাঠকদের মতামত",
  testimonialsHeading: "পাঠকরা যা বলছেন",
  productLabel: "পণ্য:",

  // Product card
  discountOff: "ছাড়",
  inStock: "স্টকে আছে",
  outOfStock: "স্টক শেষ",
  priceOnRequest: "দামের জন্য যোগাযোগ করুন",
  addedCheck: "যোগ হয়েছে ✓",
  addToCart: "কার্টে যোগ করুন",
  viewDetails: "বিস্তারিত দেখুন",
  typeDigital: "ডিজিটাল",
  typeBundle: "বান্ডল",
  typePreorder: "প্রি-অর্ডার",

  // Shop chrome
  filterCategoryTitle: "বিষয় / ক্যাটাগরি",
  priceRangeTitle: "দামের সীমা",
  allPrices: "সব দাম",
  brandTitle: "প্রকাশক / ব্র্যান্ড",
  allBrands: "সব ব্র্যান্ড",
  ratingAvailabilityTitle: "রেটিং ও প্রাপ্যতা",
  inStockOnly: "শুধু স্টকে আছে",
  breadcrumbAria: "ব্রেডক্রাম্ব",
  home: "হোম",
  collection: "সংগ্রহ",
  loadingProducts: "পণ্য লোড হচ্ছে…",
  showingProducts: "{count}টি পণ্য দেখানো হচ্ছে",
  filtersAppliedSuffix: " — ফিল্টার প্রয়োগ করা হয়েছে",
  activeFiltersCount: "{count}টি ফিল্টার সক্রিয়",
  sortBy: "সাজান:",
  removeFilterAria: "{label} ফিল্টার সরান",
  clearAllFilters: "সব ফিল্টার মুছুন",

  // Cart drawer
  yourCart: "আপনার কার্ট",
  totalWithCount: "মোট ({count}টি পণ্য)",
  deliveryChargeNote: "ডেলিভারি চার্জ চেকআউটে হিসাব হবে।",
  checkout: "চেকআউট",
  goToCartPage: "কার্ট পেজে যান",
  cartEmptyTitle: "আপনার কার্ট খালি",
  cartEmptyText: "এখনো কোনো পণ্য যোগ করা হয়নি — পছন্দের পণ্য যোগ করে কেনাকাটা শুরু করুন।",
  startShopping: "কেনাকাটা শুরু করুন",
  removeItemAria: "{name} সরান",
  decreaseQty: "পরিমাণ কমান",
  increaseQty: "পরিমাণ বাড়ান",
  youMayAlsoLike: "আপনার ভালো লাগতে পারে",
  addShort: "যোগ করুন",

  // PDP composition
  authorPublisher: "লেখক / প্রকাশক:",
  reviewsCount: "{count}টি রিভিউ",
  outOfStockParenthetical: " (স্টক শেষ)",
  priceRangeLabel: "দামের পরিসর:",
  maxDiscount: "সর্বোচ্চ {pct}% ছাড়",
  digitalTitle: "📥 ডিজিটাল পণ্য — ফাইল ডেলিভারি",
  digitalText:
    "পেমেন্ট সম্পন্ন হলে ডাউনলোড লিংক আপনার অ্যাকাউন্টে পৌঁছে যাবে — কোনো শিপিং চার্জ নেই।",
  preorderBadge: "⏳ প্রি-অর্ডার চলছে",
  preorderTermsTitle: "⏳ প্রি-অর্ডারের শর্ত",
  preorderDelivery: "সম্ভাব্য ডেলিভারি: {label}",
  preorderDeposit:
    "বুকিং কনফার্ম করতে অগ্রিম {pct}% দিতে হবে — বাকি টাকা ডেলিভারির সময়।",
  preorderMaxUnits: "সীমিত প্রি-অর্ডার: সর্বোচ্চ {count}টি পর্যন্ত",
  bundleUnavailableAlert:
    "এই বান্ডলের একটি উপাদান স্টকে নেই — বান্ডলটি এখন কেনা যাবে না।",
  priceOnRequestText:
    "এই পণ্যের দাম অর্ডারের সময় নিশ্চিত করা হয়। অর্ডার করতে কল করুন অথবা যোগাযোগ পেজ থেকে বার্তা পাঠান।",
  contactUs: "যোগাযোগ করুন",
  preorderCta: "প্রি-অর্ডার করুন",
  preorderBuyNow: "এখনই প্রি-অর্ডার করুন",
  bundleUnavailableLabel: "বান্ডল স্টকে নেই",
  podTitle: "🎨 কাস্টম প্রিন্ট পণ্য",
  podTextBase:
    "এই পণ্যে আপনার নিজের লেখা ছাপানো যাবে (সর্বোচ্চ {max} অক্ষর{colors}) — লেখাটি চেকআউটে দিতে হবে।",
  podColorsPart: ", রঙও বেছে নেওয়া যাবে",
  podFeePart: " প্রিন্ট ফি প্রতি আইটেমে {fee} টাকা, অর্ডারের মোটে যোগ হবে।",
  weightedTitle: "⚖️ ওজন অনুযায়ী দাম — প্যাকের ভগ্নাংশেও কেনা যায় (ওজনের ধাপ অনুযায়ী)",
  packPrefix: "প্যাক: ",
  gramsSuffix: " গ্রাম",
  perKg: " · প্রতি কেজি ",
  packPricePrefix: " · প্যাকের দাম ",
  pricePendingNote: " · (হার অনুযায়ী দাম হালনাগাদ বাকি — উপরে দেখানো দামই প্রযোজ্য)",
  standardVariant: "স্ট্যান্ডার্ড",
  descriptionEmpty: "এই পণ্যের বিবরণ এখনো যোগ করা হয়নি।",
  specifications: "স্পেসিফিকেশন",
  faqTitle: "সাধারণ জিজ্ঞাসা",
  sizeChartNote:
    "এই ভ্যারিয়েন্টের প্যাক অনুযায়ী মাপের টেবিল থাকতে পারে — ভ্যারিয়েন্ট বেছে সাইজ চার্ট বোতামে দেখুন।",
  bundleContentsTitle: "বান্ডলে যা যা আছে",
  componentProduct: "কম্পোনেন্ট পণ্য",
  bundleComponentsTotalLabel: "উপাদানগুলোর মোট:",
  bundlePriceLabel: "বান্ডল মূল্য:",
  bundleSavings: "সাশ্রয়",
  bundleUnavailableNote:
    "আপাতত বান্ডলটি স্টকে নেই — কম্পোনেন্টগুলো আলাদাভাবে কিনতে উপরের লিংকগুলো দেখুন।",
  relatedProducts: "সম্পর্কিত পণ্য",

  // PDP buy section
  noticeOutOfStock: "স্টকে আর নেই — কার্টে যোগ করা যায়নি।",
  noticeAddedCapped: "কার্টে যোগ হয়েছে — স্টকে যা ছিল সব নেওয়া হয়েছে।",
  noticeAdded: "কার্টে যোগ হয়েছে ✓",
  savePill: "সাশ্রয় {amount} ({pct}%)",
  lowStockWarning: "মাত্র {count}টি বাকি — দ্রুত অর্ডার করুন",
  quantityLabel: "পরিমাণ",
  weightApprox: "≈ {grams} গ্রাম (প্রতি ধাপ {step} গ্রাম)",

  // PDP actions
  buyNow: "এখনই কিনুন",
  orderOnWhatsApp: "WhatsApp-এ অর্ডার করুন",
  callForOrder: "কল করে অর্ডার করুন",
  whatsappPrefill: "আমি এই পণ্যটি অর্ডার করতে চাই: {title}",

  // PDP gallery
  galleryAria: "পণ্যের ছবি বেছে নিন",
  viewImageAria: "ছবি {n} দেখুন",
  prevImage: "আগের ছবি",
  nextImage: "পরের ছবি",

  // PDP tabs
  productInfoAria: "পণ্যের তথ্য",
  tabDescription: "বিবরণ",
  tabReviews: "ক্রেতাদের রিভিউ",
};

export type BoighorStrings = { [K in keyof typeof bn]: string };

const en: BoighorStrings = {
  // Header
  deliveryLine: "Nationwide home delivery — pay when you receive your order",
  quickLinksAria: "Quick links",
  trackOrder: "Track Order",
  signIn: "Sign In",
  searchPlaceholder: "Search books or products… type a name, author or subject",
  searchAria: "Search products",
  searchButtonAria: "Search",
  account: "Account",
  wishlist: "Wishlist",
  cart: "Cart",
  cartAria: "Cart — open drawer",
  cartAriaCount: "Cart, {count} items — open drawer",
  categoriesAria: "Categories",
  allCategories: "All Categories",
  quickFiltersAria: "Quick filters",
  quickView: "Quick view:",
  allProducts: "All Products",
  newestArrivals: "New Arrivals",
  lowestPriceFirst: "Lowest Price First",
  highestRated: "Highest Rated",

  // Footer
  footerIntro:
    "Your favourite books and everyday essentials, now from home — a carefully picked collection, fair prices and reliable delivery nationwide.",
  footerTrackOrder: "Track Order",
  footerContact: "Contact Us",
  footerColInformation: "Information",
  footerColShopBy: "Shop By",
  footerColSupport: "Support",
  footerColConsumerPolicy: "Consumer Policy",
  paymentLabel: "Payment:",
  deliveryPartnersLabel: "Delivery partners:",
  copyrightLine: "© {year} {brand} — All rights reserved.",
  footerContactHint: "See here for contact details",
  poweredBy: "Powered by Advance Ecommerce",

  // Home sections
  viewAll: "View All →",
  shortcutsAria: "Shortcuts",
  productsCollectionCount: "A collection of {count} products",
  justForYouAria: "For You",
  justForYouTitle: "Picked for You",
  loadMore: "Load More",
  benefitsAria: "Our Benefits",

  // Home hero
  heroHighlightAria: "Highlights",
  staticHeadline: "Your favourite books, now at your door",
  staticSubtext:
    "Stories, novels, study books and gift books — a carefully picked collection with cash on delivery, nationwide.",
  staticCta: "Browse the Collection",
  sideAllCategories: "All Categories",
  sideAllCategoriesSub: "See all the shop's products in one place →",
  sideCategoryCount: "{count} products — view all →",
  bannerPickerAria: "Choose a banner",
  bannerN: "Banner {n}",

  // Home categories
  categoriesHeading: "Browse by Subject",
  prevCategories: "Previous categories",
  nextCategories: "Next categories",
  productCount: "{count} products",

  // Home testimonials
  testimonialsAria: "Reader Reviews",
  testimonialsHeading: "What Readers Say",
  productLabel: "Product:",

  // Product card
  discountOff: "OFF",
  inStock: "In Stock",
  outOfStock: "Out of Stock",
  priceOnRequest: "Contact for Price",
  addedCheck: "Added ✓",
  addToCart: "Add to Cart",
  viewDetails: "View Details",
  typeDigital: "Digital",
  typeBundle: "Bundle",
  typePreorder: "Pre-order",

  // Shop chrome
  filterCategoryTitle: "Subject / Category",
  priceRangeTitle: "Price Range",
  allPrices: "All Prices",
  brandTitle: "Publisher / Brand",
  allBrands: "All Brands",
  ratingAvailabilityTitle: "Rating & Availability",
  inStockOnly: "In Stock Only",
  breadcrumbAria: "Breadcrumb",
  home: "Home",
  collection: "Collection",
  loadingProducts: "Loading products…",
  showingProducts: "Showing {count} of {count} products",
  filtersAppliedSuffix: " — filters applied",
  activeFiltersCount: "{count} filters active",
  sortBy: "Sort By:",
  removeFilterAria: "Remove the {label} filter",
  clearAllFilters: "Clear all filters",

  // Cart drawer
  yourCart: "Your Cart",
  totalWithCount: "Total ({count} items)",
  deliveryChargeNote: "Delivery charge will be calculated at checkout.",
  checkout: "Checkout",
  goToCartPage: "Go to Cart Page",
  cartEmptyTitle: "Your Cart is Empty",
  cartEmptyText: "Nothing has been added yet — add something you like to start shopping.",
  startShopping: "Start Shopping",
  removeItemAria: "Remove {name}",
  decreaseQty: "Decrease quantity",
  increaseQty: "Increase quantity",
  youMayAlsoLike: "You May Also Like",
  addShort: "Add",

  // PDP composition
  authorPublisher: "Author / Publisher:",
  reviewsCount: "{count} reviews",
  outOfStockParenthetical: " (Out of stock)",
  priceRangeLabel: "Price range:",
  maxDiscount: "Up to {pct}% off",
  digitalTitle: "📥 Digital product — file delivery",
  digitalText:
    "Once payment is complete, the download link will reach your account — there is no shipping charge.",
  preorderBadge: "⏳ Pre-order is open",
  preorderTermsTitle: "⏳ Pre-order terms",
  preorderDelivery: "Expected delivery: {label}",
  preorderDeposit:
    "You must pay {pct}% in advance to confirm the booking — the rest is due on delivery.",
  preorderMaxUnits: "Limited pre-order: up to {count} units",
  bundleUnavailableAlert:
    "One component of this bundle is out of stock — the bundle cannot be bought right now.",
  priceOnRequestText:
    "This product's price is confirmed at order time. To order, call us or send a message from the contact page.",
  contactUs: "Contact Us",
  preorderCta: "Pre-order Now",
  preorderBuyNow: "Pre-order Now",
  bundleUnavailableLabel: "Bundle Out of Stock",
  podTitle: "🎨 Custom Print Product",
  podTextBase:
    "Your own text can be printed on this product (up to {max} characters{colors}) — you will enter the text at checkout.",
  podColorsPart: ", and you can choose a colour too",
  podFeePart: " The print fee is {fee} per item and will be added to the order total.",
  weightedTitle: "⚖️ Priced by weight — you can also buy a fraction of a pack (in weight steps)",
  packPrefix: "Pack: ",
  gramsSuffix: " g",
  perKg: " · per kg ",
  packPricePrefix: " · pack price ",
  pricePendingNote: " · (rate-based price update pending — the price shown above applies)",
  standardVariant: "Standard",
  descriptionEmpty: "No description has been added for this product yet.",
  specifications: "Specifications",
  faqTitle: "Frequently Asked Questions",
  sizeChartNote:
    "This variant's pack may have its own size table — pick the variant and check the Size Chart button.",
  bundleContentsTitle: "What's in the Bundle",
  componentProduct: "Component Product",
  bundleComponentsTotalLabel: "Total of the components:",
  bundlePriceLabel: "Bundle price:",
  bundleSavings: "You save",
  bundleUnavailableNote:
    "The bundle is out of stock for now — see the links above to buy the components separately.",
  relatedProducts: "Related Products",

  // PDP buy section
  noticeOutOfStock: "No longer in stock — could not add to cart.",
  noticeAddedCapped: "Added to cart — all remaining stock was taken.",
  noticeAdded: "Added to cart ✓",
  savePill: "Save {amount} ({pct}%)",
  lowStockWarning: "Only {count} left — order soon",
  quantityLabel: "Quantity",
  weightApprox: "≈ {grams} g ({step} g per step)",

  // PDP actions
  buyNow: "Buy Now",
  orderOnWhatsApp: "Order On WhatsApp",
  callForOrder: "Call For Order",
  whatsappPrefill: "I would like to order this product: {title}",

  // PDP gallery
  galleryAria: "Choose a product image",
  viewImageAria: "View image {n}",
  prevImage: "Previous image",
  nextImage: "Next image",

  // PDP tabs
  productInfoAria: "Product Information",
  tabDescription: "Description",
  tabReviews: "Customer Reviews",
};

export const BOIGHOR_STRINGS: Record<Locale, BoighorStrings> = { bn, en };

/* ------------------------------------------------------------------ */
/* Structured copy (arrays whose shape differs per entry)              */
/* ------------------------------------------------------------------ */

export interface BoighorIconText {
  icon: IconName;
  title: string;
  text: string;
}

/** Home trust strip — the package's own generic service points. */
export const BOIGHOR_TRUST_ITEMS: Record<Locale, ReadonlyArray<BoighorIconText>> = {
  bn: [
    { icon: "banknote", title: "ক্যাশ অন ডেলিভারি", text: "পণ্য হাতে পেয়ে মূল্য পরিশোধ" },
    { icon: "truck", title: "সারাদেশে ডেলিভারি", text: "জেলা-উপজেলায় হোম ডেলিভারি" },
    { icon: "rotate-ccw", title: "সহজ রিটার্ন", text: "সমস্যা থাকলে সহজ শর্তে রিটার্ন" },
    { icon: "shield", title: "যাচাই করা মান", text: "প্রতিটি পণ্য যাচাই করে পাঠাই" },
  ],
  en: [
    { icon: "banknote", title: "Cash on Delivery", text: "Pay when you receive your order" },
    { icon: "truck", title: "Nationwide Delivery", text: "Home delivery to districts and upazilas" },
    { icon: "rotate-ccw", title: "Easy Returns", text: "Easy returns on fair terms if there's a problem" },
    { icon: "shield", title: "Verified Quality", text: "Every product is checked before dispatch" },
  ],
};

export interface BoighorTile {
  icon: IconName;
  title: string;
  text: string;
  href: string;
}

/** Fallback home shortcut tiles (real shop sorts) while the
 *  catalogue has no categories. */
export const BOIGHOR_FALLBACK_TILES: Record<Locale, ReadonlyArray<BoighorTile>> = {
  bn: [
    { icon: "grid", title: "সব পণ্য", text: "পুরো সংগ্রহ একসাথে দেখুন", href: "/shop" },
    { icon: "star", title: "নতুন এসেছে", text: "সবচেয়ে নতুন সংগ্রহ আগে", href: "/shop?sort=newest" },
    { icon: "tag", title: "কম দামে", text: "কম দামের পণ্য আগে সাজানো", href: "/shop?sort=price-asc" },
  ],
  en: [
    { icon: "grid", title: "All Products", text: "See the whole collection in one place", href: "/shop" },
    { icon: "star", title: "New Arrivals", text: "The newest collection first", href: "/shop?sort=newest" },
    { icon: "tag", title: "Low Prices", text: "Products sorted by lowest price first", href: "/shop?sort=price-asc" },
  ],
};

/** PDP compact trust rows under the buy box. */
export const BOIGHOR_TRUST_ROWS: Record<
  Locale,
  ReadonlyArray<{ icon: string; text: string }>
> = {
  bn: [
    { icon: "🚚", text: "দ্রুত ডেলিভারি — ঢাকার ভেতরে ২৪–৪৮ ঘণ্টা, সারাদেশে ২–৫ দিন" },
    { icon: "💵", text: "ক্যাশ অন ডেলিভারি — পণ্য হাতে পেয়ে টাকা পরিশোধ করুন" },
    { icon: "↩️", text: "সহজ রিটার্ন — পণ্যে সমস্যা থাকলে সহজ শর্তে রিটার্ন" },
    { icon: "🛡️", text: "আসল পণ্য — প্রতিটি পণ্য বিক্রেতা-যাচাইকৃত" },
  ],
  en: [
    { icon: "🚚", text: "Fast delivery — 24–48 hours inside Dhaka, 2–5 days nationwide" },
    { icon: "💵", text: "Cash on delivery — pay when you receive the product" },
    { icon: "↩️", text: "Easy returns — fair-terms returns if the product has a problem" },
    { icon: "🛡️", text: "Genuine products — every product is seller-verified" },
  ],
};

/** Shop preset price ranges (ShopBrowser's URL contract values). */
export const BOIGHOR_PRICE_RANGES: Record<
  Locale,
  ReadonlyArray<{ label: string; min?: number; max?: number }>
> = {
  bn: [
    { label: "৫০০ টাকার কম", max: 50000 },
    { label: "৫০০ – ১,০০০ টাকা", min: 50000, max: 100000 },
    { label: "১,০০০ – ৩,০০০ টাকা", min: 100000, max: 300000 },
    { label: "৩,০০০ টাকার বেশি", min: 300000 },
  ],
  en: [
    { label: "Under ৳500", max: 50000 },
    { label: "৳500 – ৳1,000", min: 50000, max: 100000 },
    { label: "৳1,000 – ৳3,000", min: 100000, max: 300000 },
    { label: "Over ৳3,000", min: 300000 },
  ],
};

/** Shop sort options (ShopBrowser's URL contract values). */
export const BOIGHOR_SORT_OPTIONS: Record<
  Locale,
  ReadonlyArray<{ value: string; label: string }>
> = {
  bn: [
    { value: "relevance", label: "জনপ্রিয়তা" },
    { value: "newest", label: "নতুন আগে" },
    { value: "price-asc", label: "দাম: কম থেকে বেশি" },
    { value: "price-desc", label: "দাম: বেশি থেকে কম" },
    { value: "rating", label: "রেটিং" },
  ],
  en: [
    { value: "relevance", label: "Popularity" },
    { value: "newest", label: "Newest First" },
    { value: "price-asc", label: "Price: Low to High" },
    { value: "price-desc", label: "Price: High to Low" },
    { value: "rating", label: "Rating" },
  ],
};

/** Shop rating-floor options. */
export const BOIGHOR_RATING_OPTIONS: Record<
  Locale,
  ReadonlyArray<{ value?: number; label: string }>
> = {
  bn: [
    { value: undefined, label: "সব রেটিং" },
    { value: 4, label: "৪★ ও উপরে" },
    { value: 3, label: "৩★ ও উপরে" },
  ],
  en: [
    { value: undefined, label: "All Ratings" },
    { value: 4, label: "4★ & above" },
    { value: 3, label: "3★ & above" },
  ],
};
