/**
 * Unified language system (doc 30) — HAAT theme dictionary.
 *
 * Every hardcoded UI string in src/themes/haat/** lives here, in
 * Haat's own marketplace voice, in BOTH languages. The rule
 * (Nazmul, 2026-10-27): English selected → EVERY string English;
 * Bangla selected → EVERYTHING Bangla. No mixed UI.
 *
 * Pattern (same as src/i18n/dictionaries.ts): the `bn` object is
 * written first, `en` is typed as the mapped HaatStrings type —
 * a missing or extra key in either locale fails compilation,
 * which is the parity guarantee. NEVER `as const` the bn object.
 *
 * Usage: client components `pick(locale, HAAT_STRINGS)` via
 * useLocale() from "@/i18n/LocaleProvider"; server components
 * `pick(await getRequestLocale(), HAAT_STRINGS)` via
 * "@/i18n/server". Templates use `interpolate()` from
 * "@/i18n/locale" with `{name}` placeholders.
 *
 * Merchant/DB content (product & category names, CMS menu labels,
 * hero-slide copy) is NOT in this dictionary — it comes from props
 * and is never translated here.
 */
import type { Locale } from "@/i18n/locale";

const bn = {
  // Header
  utilityTagline: "ঘরে বসে অর্ডার করুন — সারাদেশে হোম ডেলিভারি",
  quickLinksAria: "দ্রুত লিংক",
  trackOrderLink: "অর্ডার ট্র্যাক করুন",
  signInLink: "সাইন ইন",
  registerLink: "রেজিস্টার",
  cartLink: "কার্ট",
  searchPlaceholder: "হাটে খুঁজুন… পণ্যের নাম লিখুন",
  searchProductAria: "পণ্য খুঁজুন",
  searchSubmitAria: "খুঁজুন",
  cartAriaEmpty: "কার্ট — ড্রয়ার খুলুন",
  cartAriaWithCount: "কার্ট, {count}টি পণ্য — ড্রয়ার খুলুন",
  cartLabel: "কার্ট",

  // Footer
  serviceCodTitle: "ক্যাশ অন ডেলিভারি",
  serviceCodText: "পণ্য হাতে পেয়ে দাম পরিশোধ",
  serviceDeliveryTitle: "সারাদেশে পৌঁছে দিই",
  serviceDeliveryText: "শহর থেকে উপজেলা — হোম ডেলিভারি",
  serviceReturnTitle: "ঝামেলাহীন রিটার্ন",
  serviceReturnText: "পণ্যে ত্রুটি থাকলে ফেরতের সুযোগ",
  serviceSafeTitle: "নিরাপদ লেনদেন",
  serviceSafeText: "যাচাই করা বিক্রেতা ও সুরক্ষিত পেমেন্ট",
  colInformation: "তথ্য",
  colShopBy: "কেনাকাটা",
  colSupport: "সাপোর্ট",
  colConsumerPolicy: "ভোক্তা নীতি",
  footerIntro:
    "হাটের আনন্দ এখন ঘরে বসেই — যাচাই করা পণ্য, পরিষ্কার দাম আর দ্রুত ডেলিভারিতে প্রতিদিনের সব কেনাকাটা এক ঠিকানায়।",
  footerTrackOrder: "অর্ডার ট্র্যাক করুন",
  footerContact: "যোগাযোগ করুন",
  paymentLabel: "পেমেন্ট:",
  deliveryPartnerLabel: "ডেলিভারি পার্টনার:",
  copyrightLine: "© {year} {brand} — সর্বস্বত্ব সংরক্ষিত।",
  contactHint: "যোগাযোগের জন্য এখানে দেখুন",

  // Shared labels
  breadcrumbAria: "ব্রেডক্রাম্ব",
  homeLabel: "হোম",
  shopLabel: "দোকান",
  inStock: "স্টকে আছে",
  outOfStock: "স্টক শেষ",
  soldOutSuffix: " (স্টক শেষ)",
  decreaseQuantity: "পরিমাণ কমান",
  increaseQuantity: "পরিমাণ বাড়ান",
  productsCount: "{count}টি পণ্য",

  // Home — hero
  heroHeadline: "প্রতিদিনের সব বাজার, এক ঠিকানায়",
  heroSubtext:
    "পছন্দের পণ্য খুঁজুন, দাম মিলিয়ে দেখুন আর ঘরে বসেই অর্ডার করুন — ক্যাশ অন ডেলিভারি সারাদেশে।",
  heroViewAllProducts: "সব পণ্য দেখুন",
  heroAllCategories: "সব ক্যাটাগরি",
  heroAllCategoriesHint: "দোকানের সব পণ্য একসাথে দেখুন →",
  heroCategoryCountViewAll: "{count}টি পণ্য — সব দেখুন →",
  heroHighlightAria: "হাইলাইট",
  bannerPickerAria: "ব্যানার বেছে নিন",
  bannerN: "ব্যানার {n}",

  // Home — flash rail
  flashAria: "আজকের অফার",
  flashTitle: "আজকের অফার",
  flashViewAll: "সব অফার দেখুন →",
  prevProduct: "আগের পণ্য",
  nextProduct: "পরের পণ্য",

  // Home — categories + sections
  categoriesAria: "ক্যাটাগরি",
  shopByCategory: "ক্যাটাগরি ধরে কিনুন",
  allCategoriesLink: "সব ক্যাটাগরি →",
  viewAllLink: "সবগুলো দেখুন →",
  pickedForYou: "আপনার জন্য বাছাই",
  moreProducts: "আরও পণ্য দেখুন",

  // Product card
  addedShort: "যোগ হয়েছে ✓",
  addToCartLabel: "কার্টে যোগ করুন",
  priceOnRequest: "দামের জন্য যোগাযোগ করুন",

  // Cart drawer
  cartDrawerTitle: "শপিং কার্ট",
  cartTotalWithCount: "মোট ({count}টি পণ্য)",
  deliveryNote: "ডেলিভারি চার্জ চেকআউটে হিসাব হবে।",
  checkoutBtn: "চেকআউট",
  goToCartPage: "কার্ট পেজে যান",
  cartEmptyTitle: "আপনার কার্ট খালি",
  cartEmptyHint:
    "এখনো কোনো পণ্য যোগ করা হয়নি — পছন্দের পণ্য যোগ করে কেনাকাটা শুরু করুন।",
  startShopping: "কেনাকাটা শুরু করুন",
  removeItemAria: "{name} সরান",
  youMayAlsoLike: "আপনার ভালো লাগতে পারে",
  addBtn: "যোগ করুন",

  // Shop chrome
  priceUnder500: "৫০০ টাকার কম",
  price500To1000: "৫০০ – ১,০০০ টাকা",
  price1000To3000: "১,০০০ – ৩,০০০ টাকা",
  priceOver3000: "৩,০০০ টাকার বেশি",
  sortPopularity: "জনপ্রিয়তা",
  sortNewest: "নতুন আগে",
  sortPriceAsc: "দাম: কম থেকে বেশি",
  sortPriceDesc: "দাম: বেশি থেকে কম",
  sortRating: "রেটিং",
  ratingAll: "সব রেটিং",
  rating4Up: "৪★ ও উপরে",
  rating3Up: "৩★ ও উপরে",
  filterCategory: "ক্যাটাগরি",
  filterPriceRange: "দামের পরিসর",
  filterBrand: "ব্র্যান্ড",
  filterRatingStock: "রেটিং ও স্টক",
  allCategories: "সব ক্যাটাগরি",
  allPrices: "সব দাম",
  allBrands: "সব ব্র্যান্ড",
  allProducts: "সব পণ্য",
  inStockOnly: "শুধু স্টকে আছে",
  productsLoading: "পণ্য লোড হচ্ছে…",
  showingResults: "{total}টির মধ্যে {total}টি পণ্য দেখানো হচ্ছে",
  filtersAppliedSuffix: " — ফিল্টার প্রয়োগ করা হয়েছে",
  activeFiltersCount: "{count}টি ফিল্টার সক্রিয়",
  sortByLabel: "সাজান:",
  removeFilterAria: "{label} ফিল্টার সরান",
  clearAllFilters: "সব ফিল্টার মুছুন",

  // PDP — gallery + tabs
  galleryAria: "পণ্যের ছবি বেছে নিন",
  viewImageN: "ছবি {n} দেখুন",
  prevImage: "আগের ছবি",
  nextImage: "পরের ছবি",
  tabsAria: "পণ্যের তথ্য",
  tabDescription: "বিবরণ",
  tabReviews: "ক্রেতাদের রিভিউ",

  // PDP — actions + buy section
  buyNowLabel: "এখনই কিনুন",
  whatsappOrder: "হোয়াটসঅ্যাপে অর্ডার করুন",
  callForOrder: "কল করে অর্ডার করুন",
  whatsappText: "আমি এই পণ্যটি অর্ডার করতে চাই: {title}",
  noticeOutOfStock: "স্টকে আর নেই — কার্টে যোগ করা যায়নি।",
  noticeAddedCapped: "কার্টে যোগ হয়েছে — স্টকে যা ছিল সব নেওয়া হয়েছে।",
  noticeAdded: "কার্টে যোগ হয়েছে ✓",
  onlyLeftOrderFast: "মাত্র {stock}টি বাকি — দ্রুত অর্ডার করুন",
  quantityLabel: "পরিমাণ",
  gramsApprox: "≈ {grams} গ্রাম (প্রতি ধাপ {step} গ্রাম)",
  savePill: "সাশ্রয় {amount} ({pct}%)",

  // PDP — composition
  trustDelivery: "সারাদেশে হোম ডেলিভারি — ডেলিভারির সময় চেকআউটে দেখানো হয়",
  trustCod: "ক্যাশ অন ডেলিভারি — পণ্য হাতে পেয়ে দাম পরিশোধ করুন",
  trustReturn: "পণ্যে সমস্যা থাকলে সহজ শর্তে রিটার্নের সুযোগ",
  trustQuality: "মান যাচাই করে পাঠানো হয় — প্রতিটি অর্ডার যত্নে প্যাক করা",
  preorderBadge: "⏳ প্রি-অর্ডার চলছে",
  reviewsCount: "{count}টি রিভিউ",
  brandLabel: "ব্র্যান্ড:",
  priceRangeLabel: "দামের পরিসর:",
  maxDiscount: "সর্বোচ্চ {pct}% ছাড়",
  digitalTitle: "📥 ডিজিটাল পণ্য — ফাইল ডেলিভারি",
  digitalText:
    "পেমেন্ট সম্পন্ন হলে ডাউনলোড লিংক আপনার অ্যাকাউন্টে পৌঁছে যাবে — কোনো শিপিং চার্জ নেই।",
  preorderTermsTitle: "⏳ প্রি-অর্ডারের শর্ত",
  preorderDelivery: "সম্ভাব্য ডেলিভারি: {label}",
  preorderDeposit:
    "বুকিং কনফার্ম করতে অগ্রিম {pct}% দিতে হবে — বাকি টাকা ডেলিভারির সময়।",
  preorderMaxUnits: "সীমিত প্রি-অর্ডার: সর্বোচ্চ {count}টি পর্যন্ত",
  bundleUnavailableAlert:
    "এই বান্ডলের একটি উপাদান স্টকে নেই — বান্ডলটি এখন কেনা যাবে না।",
  priceOnRequestTitle: "দামের জন্য যোগাযোগ করুন",
  priceOnRequestText:
    "এই পণ্যের দাম অর্ডারের সময় নিশ্চিত করা হয়। অর্ডার করতে কল করুন অথবা যোগাযোগ পেজ থেকে বার্তা পাঠান।",
  contactBtn: "যোগাযোগ করুন",
  preorderCta: "প্রি-অর্ডার করুন",
  preorderBuyNow: "এখনই প্রি-অর্ডার করুন",
  bundleUnavailableLabel: "বান্ডল স্টকে নেই",
  standardVariant: "স্ট্যান্ডার্ড",
  podTitle: "🎨 কাস্টম প্রিন্ট পণ্য",
  podText:
    "এই পণ্যে আপনার নিজের লেখা ছাপানো যাবে (সর্বোচ্চ {max} অক্ষর{colors}) — লেখাটি চেকআউটে দিতে হবে।",
  podColorsPart: ", রঙও বেছে নেওয়া যাবে",
  podFeeNote: " প্রিন্ট ফি প্রতি আইটেমে {fee} টাকা, অর্ডারের মোটে যোগ হবে।",
  weightedTitle:
    "⚖️ ওজন অনুযায়ী দাম — প্যাকের ভগ্নাংশেও কেনা যায় (ওজনের ধাপ অনুযায়ী)",
  weightedPackLabel: "প্যাক: {grams} গ্রাম · প্রতি কেজি",
  weightedPackPriceLabel: " · প্যাকের দাম",
  weightedOutOfSync:
    " · (হার অনুযায়ী দাম হালনাগাদ বাকি — উপরে দেখানো দামই প্রযোজ্য)",
  descriptionEmpty: "এই পণ্যের বিবরণ এখনো যোগ করা হয়নি।",
  specTitle: "স্পেসিফিকেশন",
  sizeChartNote:
    "এই ভ্যারিয়েন্টের প্যাক অনুযায়ী মাপের টেবিল থাকতে পারে — ভ্যারিয়েন্ট বেছে সাইজ চার্ট বোতামে দেখুন।",
  faqTitle: "সাধারণ জিজ্ঞাসা",
  bundleContentsTitle: "বান্ডলে যা যা আছে",
  componentProductFallback: "কম্পোনেন্ট পণ্য",
  componentsTotalLabel: "উপাদানগুলোর মোট:",
  bundlePriceLabel: "বান্ডল মূল্য:",
  bundleSaveLabel: "সাশ্রয়",
  bundleOutOfStockNote:
    "আপাতত বান্ডলটি স্টকে নেই — কম্পোনেন্টগুলো আলাদাভাবে কিনতে উপরের লিংকগুলো দেখুন।",
  relatedAria: "সম্পর্কিত পণ্য",
  relatedTitle: "সম্পর্কিত পণ্য",
};

export type HaatStrings = { [K in keyof typeof bn]: string };

const en: HaatStrings = {
  // Header
  utilityTagline: "Order from home — home delivery across the country",
  quickLinksAria: "Quick links",
  trackOrderLink: "Track Order",
  signInLink: "Sign In",
  registerLink: "Register",
  cartLink: "Cart",
  searchPlaceholder: "Search Haat… type a product name",
  searchProductAria: "Search products",
  searchSubmitAria: "Search",
  cartAriaEmpty: "Cart — open drawer",
  cartAriaWithCount: "Cart, {count} items — open drawer",
  cartLabel: "Cart",

  // Footer
  serviceCodTitle: "Cash on Delivery",
  serviceCodText: "Pay when you receive your product",
  serviceDeliveryTitle: "Delivery Across the Country",
  serviceDeliveryText: "From cities to upazilas — home delivery",
  serviceReturnTitle: "Hassle-Free Returns",
  serviceReturnText: "Returns available if a product is faulty",
  serviceSafeTitle: "Safe Transactions",
  serviceSafeText: "Verified sellers and secure payments",
  colInformation: "Information",
  colShopBy: "Shop By",
  colSupport: "Support",
  colConsumerPolicy: "Consumer Policy",
  footerIntro:
    "The joy of the haat, now from home — verified products, clear prices and fast delivery for all your everyday shopping in one place.",
  footerTrackOrder: "Track Order",
  footerContact: "Contact Us",
  paymentLabel: "Payment:",
  deliveryPartnerLabel: "Delivery partners:",
  copyrightLine: "© {year} {brand} — All rights reserved.",
  contactHint: "See here for contact details",

  // Shared labels
  breadcrumbAria: "Breadcrumb",
  homeLabel: "Home",
  shopLabel: "Shop",
  inStock: "In Stock",
  outOfStock: "Out of Stock",
  soldOutSuffix: " (Out of stock)",
  decreaseQuantity: "Decrease quantity",
  increaseQuantity: "Increase quantity",
  productsCount: "{count} products",

  // Home — hero
  heroHeadline: "All your everyday shopping, in one place",
  heroSubtext:
    "Find the products you love, compare prices and order from home — cash on delivery across the country.",
  heroViewAllProducts: "View All Products",
  heroAllCategories: "All Categories",
  heroAllCategoriesHint: "See all the shop's products together →",
  heroCategoryCountViewAll: "{count} products — view all →",
  heroHighlightAria: "Highlights",
  bannerPickerAria: "Choose a banner",
  bannerN: "Banner {n}",

  // Home — flash rail
  flashAria: "Today's Offers",
  flashTitle: "Today's Offers",
  flashViewAll: "View all offers →",
  prevProduct: "Previous products",
  nextProduct: "Next products",

  // Home — categories + sections
  categoriesAria: "Categories",
  shopByCategory: "Shop by Category",
  allCategoriesLink: "All Categories →",
  viewAllLink: "View all →",
  pickedForYou: "Picked for You",
  moreProducts: "View More Products",

  // Product card
  addedShort: "Added ✓",
  addToCartLabel: "Add to Cart",
  priceOnRequest: "Contact for price",

  // Cart drawer
  cartDrawerTitle: "Shopping Cart",
  cartTotalWithCount: "Total ({count} items)",
  deliveryNote: "Delivery charge will be calculated at checkout.",
  checkoutBtn: "Checkout",
  goToCartPage: "Go to Cart Page",
  cartEmptyTitle: "Your cart is empty",
  cartEmptyHint:
    "No products added yet — add your favourites and start shopping.",
  startShopping: "Start Shopping",
  removeItemAria: "Remove {name}",
  youMayAlsoLike: "You May Also Like",
  addBtn: "Add",

  // Shop chrome
  priceUnder500: "Under 500 taka",
  price500To1000: "500 – 1,000 taka",
  price1000To3000: "1,000 – 3,000 taka",
  priceOver3000: "Over 3,000 taka",
  sortPopularity: "Popularity",
  sortNewest: "Newest first",
  sortPriceAsc: "Price: low to high",
  sortPriceDesc: "Price: high to low",
  sortRating: "Rating",
  ratingAll: "All ratings",
  rating4Up: "4★ & up",
  rating3Up: "3★ & up",
  filterCategory: "Category",
  filterPriceRange: "Price Range",
  filterBrand: "Brand",
  filterRatingStock: "Rating & Stock",
  allCategories: "All Categories",
  allPrices: "All Prices",
  allBrands: "All Brands",
  allProducts: "All Products",
  inStockOnly: "In stock only",
  productsLoading: "Loading products…",
  showingResults: "Showing {total} of {total} products",
  filtersAppliedSuffix: " — filters applied",
  activeFiltersCount: "{count} filters active",
  sortByLabel: "Sort By:",
  removeFilterAria: "Remove {label} filter",
  clearAllFilters: "Clear all filters",

  // PDP — gallery + tabs
  galleryAria: "Choose a product image",
  viewImageN: "View image {n}",
  prevImage: "Previous image",
  nextImage: "Next image",
  tabsAria: "Product information",
  tabDescription: "Description",
  tabReviews: "Customer Reviews",

  // PDP — actions + buy section
  buyNowLabel: "Buy Now",
  whatsappOrder: "Order on WhatsApp",
  callForOrder: "Call to Order",
  whatsappText: "I want to order this product: {title}",
  noticeOutOfStock: "Out of stock — could not be added to the cart.",
  noticeAddedCapped: "Added to cart — all available stock has been taken.",
  noticeAdded: "Added to cart ✓",
  onlyLeftOrderFast: "Only {stock} left — order fast",
  quantityLabel: "Quantity",
  gramsApprox: "≈ {grams} g (per step {step} g)",
  savePill: "Save {amount} ({pct}%)",

  // PDP — composition
  trustDelivery: "Home delivery across the country — delivery time is shown at checkout",
  trustCod: "Cash on delivery — pay when you receive your product",
  trustReturn: "Easy returns on simple terms if a product has a problem",
  trustQuality: "Quality-checked before dispatch — every order is packed with care",
  preorderBadge: "⏳ Pre-order is live",
  reviewsCount: "{count} reviews",
  brandLabel: "Brand:",
  priceRangeLabel: "Price range:",
  maxDiscount: "Up to {pct}% off",
  digitalTitle: "📥 Digital Product — File Delivery",
  digitalText:
    "Once payment is complete, the download link will reach your account — no shipping charge.",
  preorderTermsTitle: "⏳ Pre-order Terms",
  preorderDelivery: "Expected delivery: {label}",
  preorderDeposit:
    "An advance of {pct}% is required to confirm the booking — the rest is due on delivery.",
  preorderMaxUnits: "Limited pre-order: up to {count} units",
  bundleUnavailableAlert:
    "One component of this bundle is out of stock — the bundle cannot be bought right now.",
  priceOnRequestTitle: "Contact for price",
  priceOnRequestText:
    "This product's price is confirmed at order time. Call to order, or send a message from the contact page.",
  contactBtn: "Contact Us",
  preorderCta: "Pre-order Now",
  preorderBuyNow: "Pre-order Right Now",
  bundleUnavailableLabel: "Bundle out of stock",
  standardVariant: "Standard",
  podTitle: "🎨 Custom Print Product",
  podText:
    "Your own text can be printed on this product (up to {max} characters{colors}) — you will provide the text at checkout.",
  podColorsPart: ", and you can choose colours too",
  podFeeNote: " Print fee is {fee} taka per item, added to the order total.",
  weightedTitle:
    "⚖️ Priced by weight — you can also buy fractions of a pack (by weight steps)",
  weightedPackLabel: "Pack: {grams} g · per kg",
  weightedPackPriceLabel: " · Pack price",
  weightedOutOfSync:
    " · (Rate-based price update pending — the price shown above applies)",
  descriptionEmpty: "No description has been added for this product yet.",
  specTitle: "Specifications",
  sizeChartNote:
    "This variant's pack may have a size table — pick the variant and check the size chart button.",
  faqTitle: "Frequently Asked Questions",
  bundleContentsTitle: "What's in the Bundle",
  componentProductFallback: "Component product",
  componentsTotalLabel: "Components total:",
  bundlePriceLabel: "Bundle price:",
  bundleSaveLabel: "You save",
  bundleOutOfStockNote:
    "This bundle is out of stock for now — see the links above to buy the components separately.",
  relatedAria: "Related products",
  relatedTitle: "Related Products",
};

export const HAAT_STRINGS: Record<Locale, HaatStrings> = { bn, en };
