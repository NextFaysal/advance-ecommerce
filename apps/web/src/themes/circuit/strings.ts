/**
 * Circuit theme — UI copy dictionary (doc 30 unified language system).
 *
 * Every hardcoded UI string in the Circuit package resolves through
 * this file: bn is the source object, en is typed against it via the
 * mapped type so the two can never drift. Merchant/DB content
 * (product names, category names, CMS slide copy) is NOT here — only
 * the package's own chrome copy, in Circuit's tech-store voice.
 */
import type { Locale } from "@/i18n/locale";
import type { IconName } from "@/components/ui/icon";

const bn = {
  // Header
  searchPlaceholder: "পণ্য খুঁজুন… যেমন: ল্যাপটপ, মনিটর, রাউটার, হেডফোন",
  searchAria: "পণ্য খুঁজুন",
  searchButtonAria: "খুঁজুন",
  offersLabel: "অফার",
  accountLabel: "অ্যাকাউন্ট",
  allOffersCta: "সব অফার",
  navCategoriesAria: "ক্যাটাগরি",
  allCategories: "সব ক্যাটাগরি",
  cartAria: "কার্ট — ড্রয়ার খুলুন",
  cartAriaCount: "কার্ট, {count}টি পণ্য — ড্রয়ার খুলুন",
  compareAria: "পণ্য তুলনা করুন",

  // Footer
  footerIntro:
    "ল্যাপটপ, গ্যাজেট আর কম্পিউটার সরঞ্জাম — যাচাই করা আসল পণ্য, স্বচ্ছ দাম আর সারাদেশে নির্ভরযোগ্য হোম ডেলিভারি।",
  footerTrackOrder: "অর্ডার ট্র্যাক করুন",
  footerContact: "যোগাযোগ করুন",
  paymentLabel: "পেমেন্ট:",
  deliveryPartnersLabel: "ডেলিভারি পার্টনার:",
  copyrightLine: "© {year} {brand} — সর্বস্বত্ব সংরক্ষিত।",
  footerContactHint: "যোগাযোগের জন্য এখানে দেখুন",
  poweredBy: "চালনায় Advance Ecommerce",

  // Home hero
  heroHighlightAria: "হাইলাইট",
  staticHeadline: "নতুন প্রযুক্তি, যাচাই করা আসল গ্যাজেট",
  staticSubtext:
    "ল্যাপটপ, কম্পিউটার সরঞ্জাম, গেমিং গিয়ার আর স্মার্ট ডিভাইস — স্বচ্ছ দামে ক্যাশ অন ডেলিভারিতে সারাদেশে।",
  staticCta: "কেনাকাটা শুরু করুন",
  sideCategoryCount: "{count}টি পণ্য — সব দেখুন →",
  sideAllCategories: "সব ক্যাটাগরি",
  sideAllCategoriesSub: "দোকানের সব পণ্য একসাথে দেখুন →",
  bannerPickerAria: "ব্যানার বেছে নিন",
  bannerN: "ব্যানার {n}",

  // Home categories / featured / sections / testimonials
  categoriesAria: "জনপ্রিয় ক্যাটাগরি",
  categoriesHeading: "জনপ্রিয় ক্যাটাগরি",
  prevCategories: "আগের ক্যাটাগরি",
  nextCategories: "পরের ক্যাটাগরি",
  productCount: "{count}টি পণ্য",
  featuredAria: "ফিচার্ড পণ্য",
  featuredHeading: "ফিচার্ড পণ্য",
  prevProducts: "আগের পণ্য",
  nextProducts: "পরের পণ্য",
  viewAll: "সব দেখুন →",
  justForYouAria: "আপনার জন্য বাছাই",
  justForYouTitle: "আপনার জন্য বাছাই",
  viewAllProducts: "সব পণ্য দেখুন",
  testimonialsAria: "কাস্টমারদের মতামত",
  testimonialsHeading: "কাস্টমাররা যা বলছেন",
  productLabel: "পণ্য:",

  // Home utility strip
  codBannerText:
    "সারাদেশে ক্যাশ অন ডেলিভারি চালু আছে — অর্ডার করুন, পণ্য হাতে পেয়ে নিশ্চিন্তে মূল্য পরিশোধ করুন।",
  benefitsAria: "আমাদের সুবিধা",

  // Product card
  saveLine: "সাশ্রয় {amount} (−{pct}%)",
  inStock: "স্টকে আছে",
  outOfStock: "স্টক শেষ",
  priceOnRequest: "দামের জন্য যোগাযোগ করুন",
  addedCheck: "যোগ হয়েছে ✓",
  addToCart: "কার্টে যোগ করুন",

  // Shop chrome
  filterCategoryTitle: "ক্যাটাগরি দিয়ে ফিল্টার",
  priceRangeTitle: "দামের সীমা",
  brandTitle: "ব্র্যান্ড",
  ratingAvailabilityTitle: "রেটিং ও প্রাপ্যতা",
  allPrices: "সব দাম",
  allBrands: "সব ব্র্যান্ড",
  allProducts: "সব পণ্য",
  inStockOnly: "শুধু স্টকে আছে",
  breadcrumbAria: "ব্রেডক্রাম্ব",
  home: "হোম",
  shop: "দোকান",
  loadingProducts: "পণ্য লোড হচ্ছে…",
  showingResults: "{total}টি পণ্যের মধ্যে {total}টি দেখানো হচ্ছে",
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
  brandLabel: "ব্র্যান্ড:",
  reviewsCountLine: "{count}টি রিভিউ",
  soldOutSuffix: " (স্টক শেষ)",
  priceRangeLabel: "দামের পরিসর:",
  maxDiscountLine: "সর্বোচ্চ {pct}% ছাড়",
  digitalTitle: "📥 ডিজিটাল পণ্য — ফাইল ডেলিভারি",
  digitalText:
    "পেমেন্ট সম্পন্ন হলে ডাউনলোড লিংক আপনার অ্যাকাউন্টে পৌঁছে যাবে — কোনো শিপিং চার্জ নেই।",
  preorderBadge: "⏳ প্রি-অর্ডার চলছে",
  preorderTermsTitle: "⏳ প্রি-অর্ডারের শর্ত",
  preorderDeliveryLine: "সম্ভাব্য ডেলিভারি: {label}",
  preorderDepositLine: "বুকিং কনফার্ম করতে অগ্রিম {pct}% দিতে হবে — বাকি টাকা ডেলিভারির সময়।",
  preorderMaxUnitsLine: "সীমিত প্রি-অর্ডার: সর্বোচ্চ {count}টি পর্যন্ত",
  bundleUnavailableAlert: "এই বান্ডলের একটি উপাদান স্টকে নেই — বান্ডলটি এখন কেনা যাবে না।",
  priceOnRequestText:
    "এই পণ্যের দাম অর্ডারের সময় নিশ্চিত করা হয়। অর্ডার করতে কল করুন অথবা যোগাযোগ পেজ থেকে বার্তা পাঠান।",
  contactUsBtn: "যোগাযোগ করুন",
  preorderCta: "প্রি-অর্ডার করুন",
  preorderBuyNow: "এখনই প্রি-অর্ডার করুন",
  bundleUnavailableLabel: "বান্ডল স্টকে নেই",
  podTitle: "🎨 কাস্টম প্রিন্ট পণ্য",
  podText:
    "এই পণ্যে আপনার নিজের লেখা ছাপানো যাবে (সর্বোচ্চ {max} অক্ষর{colors}) — লেখাটি চেকআউটে দিতে হবে।",
  podColorsSegment: ", রঙও বেছে নেওয়া যাবে",
  podFeeSuffix: " প্রিন্ট ফি প্রতি আইটেমে {fee} টাকা, অর্ডারের মোটে যোগ হবে।",
  standardVariantLabel: "স্ট্যান্ডার্ড",
  weightedTitle: "⚖️ ওজন অনুযায়ী দাম — প্যাকের ভগ্নাংশেও কেনা যায় (ওজনের ধাপ অনুযায়ী)",
  packLabel: "প্যাক:",
  gramsUnit: "গ্রাম",
  perKgLabel: "প্রতি কেজি",
  packPriceLabel: "প্যাকের দাম",
  weightedStaleNote: "(হার অনুযায়ী দাম হালনাগাদ বাকি — উপরে দেখানো দামই প্রযোজ্য)",
  noDescription: "এই পণ্যের বিবরণ এখনো যোগ করা হয়নি।",
  specifications: "স্পেসিফিকেশন",
  sizeChartNote:
    "এই ভ্যারিয়েন্টের প্যাক অনুযায়ী মাপের টেবিল থাকতে পারে — ভ্যারিয়েন্ট বেছে সাইজ চার্ট বোতামে দেখুন।",
  faqTitle: "সাধারণ জিজ্ঞাসা",
  bundleContentsTitle: "বান্ডলে যা যা আছে",
  componentProductFallback: "কম্পোনেন্ট পণ্য",
  bundleComponentsTotalLabel: "উপাদানগুলোর মোট:",
  bundlePriceLabel: "বান্ডল মূল্য:",
  saveLabel: "সাশ্রয়",
  bundleUnavailableNote:
    "আপাতত বান্ডলটি স্টকে নেই — কম্পোনেন্টগুলো আলাদাভাবে কিনতে উপরের লিংকগুলো দেখুন।",
  relatedProducts: "সম্পর্কিত পণ্য",

  // PDP buy section
  noticeOutOfStock: "স্টকে আর নেই — কার্টে যোগ করা যায়নি।",
  noticeAddedCapped: "কার্টে যোগ হয়েছে — স্টকে যা ছিল সব নেওয়া হয়েছে।",
  noticeAdded: "কার্টে যোগ হয়েছে ✓",
  lowStockLine: "মাত্র {count}টি বাকি — দ্রুত অর্ডার করুন",
  quantityLabel: "পরিমাণ",
  weightApproxLine: "≈ {grams} গ্রাম (প্রতি ধাপ {step} গ্রাম)",

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

export type CircuitStrings = { [K in keyof typeof bn]: string };

const en: CircuitStrings = {
  // Header
  searchPlaceholder: "Search products… e.g. laptop, monitor, router, headphones",
  searchAria: "Search products",
  searchButtonAria: "Search",
  offersLabel: "Offers",
  accountLabel: "Account",
  allOffersCta: "All Offers",
  navCategoriesAria: "Categories",
  allCategories: "All Categories",
  cartAria: "Cart — open the drawer",
  cartAriaCount: "Cart, {count} items — open the drawer",
  compareAria: "Compare products",

  // Footer
  footerIntro:
    "Laptops, gadgets and computer gear — verified genuine products, transparent prices and reliable home delivery nationwide.",
  footerTrackOrder: "Track Order",
  footerContact: "Contact Us",
  paymentLabel: "Payment:",
  deliveryPartnersLabel: "Delivery Partners:",
  copyrightLine: "© {year} {brand} — All rights reserved.",
  footerContactHint: "See here for contact details",
  poweredBy: "Powered by Advance Ecommerce",

  // Home hero
  heroHighlightAria: "Highlights",
  staticHeadline: "New tech, verified genuine gadgets",
  staticSubtext:
    "Laptops, computer gear, gaming kit and smart devices — transparent prices with cash on delivery, nationwide.",
  staticCta: "Start Shopping",
  sideCategoryCount: "{count} products — view all →",
  sideAllCategories: "All Categories",
  sideAllCategoriesSub: "See every product in the store together →",
  bannerPickerAria: "Choose a banner",
  bannerN: "Banner {n}",

  // Home categories / featured / sections / testimonials
  categoriesAria: "Popular Categories",
  categoriesHeading: "Popular Categories",
  prevCategories: "Previous categories",
  nextCategories: "Next categories",
  productCount: "{count} products",
  featuredAria: "Featured Products",
  featuredHeading: "Featured Products",
  prevProducts: "Previous products",
  nextProducts: "Next products",
  viewAll: "View All →",
  justForYouAria: "Picked For You",
  justForYouTitle: "Picked For You",
  viewAllProducts: "View All Products",
  testimonialsAria: "Customer Opinions",
  testimonialsHeading: "What Customers Say",
  productLabel: "Product:",

  // Home utility strip
  codBannerText:
    "Cash on delivery is live nationwide — order now and pay with peace of mind when the product is in your hands.",
  benefitsAria: "Our Benefits",

  // Product card
  saveLine: "Save {amount} (−{pct}%)",
  inStock: "In Stock",
  outOfStock: "Out of Stock",
  priceOnRequest: "Contact for Price",
  addedCheck: "Added ✓",
  addToCart: "Add to Cart",

  // Shop chrome
  filterCategoryTitle: "Filter by Category",
  priceRangeTitle: "Price Range",
  brandTitle: "Brands",
  ratingAvailabilityTitle: "Rating & Availability",
  allPrices: "All Prices",
  allBrands: "All Brands",
  allProducts: "All Products",
  inStockOnly: "In Stock Only",
  breadcrumbAria: "Breadcrumb",
  home: "Home",
  shop: "Shop",
  loadingProducts: "Loading products…",
  showingResults: "Showing {total} of {total} products",
  filtersAppliedSuffix: " — filters applied",
  activeFiltersCount: "{count} filters active",
  sortBy: "Sort By:",
  removeFilterAria: "Remove the {label} filter",
  clearAllFilters: "Clear All Filters",

  // Cart drawer
  yourCart: "Your Cart",
  totalWithCount: "Total ({count} items)",
  deliveryChargeNote: "Delivery charge is calculated at checkout.",
  checkout: "Checkout",
  goToCartPage: "Go to Cart Page",
  cartEmptyTitle: "Your cart is empty",
  cartEmptyText: "Nothing has been added yet — add something you like and start shopping.",
  startShopping: "Start Shopping",
  removeItemAria: "Remove {name}",
  decreaseQty: "Decrease quantity",
  increaseQty: "Increase quantity",
  youMayAlsoLike: "You May Also Like",
  addShort: "Add",

  // PDP composition
  brandLabel: "Brand:",
  reviewsCountLine: "{count} reviews",
  soldOutSuffix: " (Out of Stock)",
  priceRangeLabel: "Price Range:",
  maxDiscountLine: "Up to {pct}% off",
  digitalTitle: "📥 Digital Product — File Delivery",
  digitalText:
    "Once payment completes, the download link reaches your account — no shipping charge.",
  preorderBadge: "⏳ Pre-order Open",
  preorderTermsTitle: "⏳ Pre-order Terms",
  preorderDeliveryLine: "Estimated delivery: {label}",
  preorderDepositLine: "An advance of {pct}% confirms the booking — the rest is due at delivery.",
  preorderMaxUnitsLine: "Limited pre-order: up to {count} units",
  bundleUnavailableAlert: "One item in this bundle is out of stock — the bundle cannot be bought right now.",
  priceOnRequestText:
    "The price of this product is confirmed at order time. To order, call us or send a message from the contact page.",
  contactUsBtn: "Contact Us",
  preorderCta: "Place Pre-order",
  preorderBuyNow: "Pre-order Now",
  bundleUnavailableLabel: "Bundle Out of Stock",
  podTitle: "🎨 Custom Print Product",
  podText:
    "Your own text can be printed on this product (up to {max} characters{colors}) — provide the text at checkout.",
  podColorsSegment: ", colours can be chosen too",
  podFeeSuffix: " Print fee is {fee} taka per item, added to the order total.",
  standardVariantLabel: "Standard",
  weightedTitle: "⚖️ Priced by weight — buy fractions of a pack too (by weight step)",
  packLabel: "Pack:",
  gramsUnit: "grams",
  perKgLabel: "per kg",
  packPriceLabel: "Pack price",
  weightedStaleNote: "(Rate-based price update pending — the price shown above applies)",
  noDescription: "No description has been added for this product yet.",
  specifications: "Specifications",
  sizeChartNote:
    "This variant's pack may have a size table — choose the variant and check the size chart button.",
  faqTitle: "Frequently Asked Questions",
  bundleContentsTitle: "What's in the Bundle",
  componentProductFallback: "Component Product",
  bundleComponentsTotalLabel: "Components total:",
  bundlePriceLabel: "Bundle price:",
  saveLabel: "Save",
  bundleUnavailableNote:
    "The bundle is out of stock for now — see the links above to buy the components separately.",
  relatedProducts: "Related Products",

  // PDP buy section
  noticeOutOfStock: "Out of stock — could not be added to the cart.",
  noticeAddedCapped: "Added to cart — everything in stock was taken.",
  noticeAdded: "Added to cart ✓",
  lowStockLine: "Only {count} left — order fast",
  quantityLabel: "Quantity",
  weightApproxLine: "≈ {grams} grams ({step} grams per step)",

  // PDP actions
  buyNow: "Buy Now",
  orderOnWhatsApp: "Order on WhatsApp",
  callForOrder: "Call to Order",
  whatsappPrefill: "I want to order this product: {title}",

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

export const CIRCUIT_STRINGS: Record<Locale, CircuitStrings> = { bn, en };

/* ------------------------------------------------------------------ */
/* Structured copy (arrays whose shape differs per entry)              */
/* ------------------------------------------------------------------ */

/** PDP compact trust rows under the buy box — Circuit's warranty voice. */
export const CIRCUIT_TRUST_ROWS: Record<
  Locale,
  ReadonlyArray<{ icon: string; text: string }>
> = {
  bn: [
    { icon: "🚚", text: "সারাদেশে হোম ডেলিভারি — জেলা-উপজেলার ঠিকানায় পৌঁছে দিই" },
    { icon: "💵", text: "ক্যাশ অন ডেলিভারি — পণ্য হাতে পেয়ে টাকা পরিশোধ করুন" },
    { icon: "↩️", text: "সহজ রিটার্ন — পণ্যে সমস্যা থাকলে সহজ শর্তে রিটার্ন" },
    { icon: "🛡️", text: "ওয়ারেন্টি তথ্য — যেসব পণ্যে ওয়ারেন্টি আছে, বিবরণ ও স্পেসিফিকেশনে উল্লেখ থাকে" },
  ],
  en: [
    { icon: "🚚", text: "Home delivery nationwide — we deliver to district and upazila addresses" },
    { icon: "💵", text: "Cash on delivery — pay when you receive the product" },
    { icon: "↩️", text: "Easy returns — fair-terms returns if the product has a problem" },
    { icon: "🛡️", text: "Warranty info — where a product carries a warranty, it is stated in the description and specs" },
  ],
};

/** Home utility cards (COD / delivery / returns / warranty info). */
export const CIRCUIT_UTILITY_ITEMS: Record<
  Locale,
  ReadonlyArray<{ icon: IconName; title: string; text: string }>
> = {
  bn: [
    { icon: "banknote", title: "ক্যাশ অন ডেলিভারি", text: "পণ্য হাতে পেয়ে মূল্য পরিশোধ করুন" },
    { icon: "truck", title: "সারাদেশে হোম ডেলিভারি", text: "জেলা-উপজেলার ঠিকানায় পৌঁছে দিই" },
    { icon: "rotate-ccw", title: "সহজ রিটার্ন", text: "পণ্যে সমস্যা থাকলে সহজ শর্তে রিটার্ন" },
    { icon: "shield", title: "পণ্যে ওয়ারেন্টি তথ্য", text: "ওয়ারেন্টি থাকলে পণ্যের পেজেই বিস্তারিত" },
  ],
  en: [
    { icon: "banknote", title: "Cash on Delivery", text: "Pay when you receive the product" },
    { icon: "truck", title: "Nationwide Home Delivery", text: "Delivered to district and upazila addresses" },
    { icon: "rotate-ccw", title: "Easy Returns", text: "Easy returns on fair terms if there's a problem" },
    { icon: "shield", title: "Warranty Info on Products", text: "Where there's a warranty, details are on the product page" },
  ],
};

/** Shop preset price ranges (ShopBrowser's URL contract values). */
export const CIRCUIT_PRICE_RANGES: Record<
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
export const CIRCUIT_SORT_OPTIONS: Record<
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
export const CIRCUIT_RATING_OPTIONS: Record<
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
