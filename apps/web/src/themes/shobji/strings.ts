/**
 * Shobji theme — theme-local UI dictionary (doc 30 unified language).
 *
 * Every hardcoded UI string in src/themes/shobji/** resolves through
 * this dictionary: English selected → every string English, Bangla
 * selected → every string Bangla. Client components read it via
 * `useLocale()` + `pick(locale, SHOBJI_STRINGS)`; server components
 * (home-sections, pdp-composition) via `getRequestLocale()` + pick.
 *
 * Merchant / DB content (product titles, category names, CMS copy,
 * footer-menu labels) is NOT in here — that content is the store's
 * own and is rendered from its props exactly as before.
 *
 * Typing follows src/i18n/dictionaries.ts exactly: the `bn` object
 * is written once, `en` is typed as the mapped ShobjiStrings so a
 * missing/extra key in either locale fails compilation (parity).
 */
import type { Locale } from "@/i18n/locale";

const bn = {
  // Shared / navigation
  home: "হোম",
  shop: "দোকান",
  categories: "ক্যাটাগরি",
  allProducts: "সব পণ্য",
  viewAllArrow: "সব দেখুন →",
  breadcrumbAria: "ব্রেডক্রাম্ব",

  // Header
  searchPlaceholderLong: "পণ্য খুঁজুন… যেমন: টাটকা সবজি, ফল, মাছ, মাংস",
  searchProductsAria: "পণ্য খুঁজুন",
  searchSubmitAria: "খুঁজুন",
  trackOrder: "অর্ডার ট্র্যাক করুন",
  wishlist: "উইশলিস্ট",
  login: "লগইন",
  cart: "কার্ট",
  cartDrawerAria: "কার্ট — ড্রয়ার খুলুন",
  cartDrawerAriaWithCount: "কার্ট, {count}টি পণ্য — ড্রয়ার খুলুন",

  // Category sidebar
  categorySidebarAria: "ক্যাটাগরি সাইডবার",

  // Floating cart tab
  floatingCartAria: "কার্ট খুলুন — {count}টি পণ্য, মোট {total}",
  itemCountShort: "{count}টি",

  // Footer
  footerIntro:
    "বাজারের টাটকা সবজি, ফল আর নিত্যপণ্য এখন দরজায় — যত্নে বাছাই করা পণ্য, সঠিক ওজন আর দ্রুত হোম ডেলিভারি।",
  contactUsBtn: "যোগাযোগ করুন",
  paymentLabel: "পেমেন্ট:",
  deliveryPartnerLabel: "ডেলিভারি পার্টনার:",
  allRightsReserved: "সর্বস্বত্ব সংরক্ষিত।",
  contactPrompt: "যোগাযোগের জন্য এখানে দেখুন",

  // Product card
  addToCart: "কার্টে যোগ করুন",
  addedToCart: "যোগ হয়েছে ✓",
  outOfStock: "স্টক শেষ",
  priceOnRequest: "দামের জন্য যোগাযোগ করুন",

  // Home hero
  heroAria: "হাইলাইট",
  heroSearchPlaceholder: "কী খুঁজছেন? যেমন: আলু, পেঁয়াজ, টমেটো…",
  heroCategoryLine: "{count}টি পণ্য — সব দেখুন →",
  heroFallbackHeadline: "আজকের টাটকা বাজার, সরাসরি আপনার দরজায়",
  heroFallbackSubtext:
    "সবজি, ফল, মাছ-মাংস আর নিত্যপ্রয়োজনীয় সবকিছু — যত্নে বাছাই করে দ্রুত পৌঁছে দিই আপনার বাসায়।",
  bannerPickerAria: "ব্যানার বেছে নিন",
  bannerNumberAria: "ব্যানার {n}",

  // Home category tiles
  popularCategories: "জনপ্রিয় ক্যাটাগরি",
  prevCategoriesAria: "আগের ক্যাটাগরি",
  nextCategoriesAria: "পরের ক্যাটাগরি",
  productsCount: "{count}টি পণ্য",

  // Home featured rail
  customersChoice: "ক্রেতাদের পছন্দ",
  prevProductsAria: "আগের পণ্য",
  nextProductsAria: "পরের পণ্য",

  // Home brands
  ourBrands: "আমাদের ব্র্যান্ড",

  // Home testimonials
  customerOpinionsAria: "কাস্টমারদের মতামত",
  customersSayTitle: "কাস্টমাররা যা বলছেন",
  productLabelColon: "পণ্য:",

  // Home sections / USP cards
  benefitsAria: "আমাদের সুবিধা",
  uspCodTitle: "ক্যাশ অন ডেলিভারি",
  uspCodText: "পণ্য হাতে পেয়ে মূল্য পরিশোধ",
  uspDeliveryTitle: "হোম ডেলিভারি",
  uspDeliveryText: "বাসার দরজায় পৌঁছে দিই",
  uspReturnTitle: "সহজ রিটার্ন",
  uspReturnText: "সমস্যা থাকলে সহজ শর্তে রিটার্ন",
  uspQualityTitle: "যাচাই করা মান",
  uspQualityText: "প্রতিটি পণ্য যাচাই করে পাঠাই",
  pickedForYou: "আপনার জন্য বাছাই",
  loadMore: "আরও দেখুন",

  // Shop chrome
  filterByCategory: "ক্যাটাগরি অনুযায়ী ফিল্টার",
  allCategories: "সব ক্যাটাগরি",
  priceRange: "দামের পরিসর",
  allPrices: "সব দাম",
  brand: "ব্র্যান্ড",
  allBrands: "সব ব্র্যান্ড",
  ratingAndStock: "রেটিং ও স্টক",
  inStockOnlyOption: "শুধু স্টকে আছে",
  productsLoading: "পণ্য লোড হচ্ছে…",
  showingProducts: "{shown}টি পণ্য দেখানো হচ্ছে — মোট {total}টি",
  filtersAppliedSuffix: " — ফিল্টার প্রয়োগ করা হয়েছে",
  activeFiltersCount: "{count}টি ফিল্টার সক্রিয়",
  sortBy: "সাজান:",
  removeFilterAria: "{label} ফিল্টার সরান",
  clearAllFilters: "সব ফিল্টার মুছুন",
  priceUnder500: "৫০০ টাকার কম",
  price500to1000: "৫০০ – ১,০০০ টাকা",
  price1000to3000: "১,০০০ – ৩,০০০ টাকা",
  priceOver3000: "৩,০০০ টাকার বেশি",
  sortPopularity: "জনপ্রিয়তা",
  sortNewest: "নতুন আগে",
  sortPriceAsc: "দাম: কম থেকে বেশি",
  sortPriceDesc: "দাম: বেশি থেকে কম",
  sortRating: "রেটিং",
  ratingAll: "সব রেটিং",
  rating4Up: "৪★ ও উপরে",
  rating3Up: "৩★ ও উপরে",

  // Cart drawer
  drawerTitle: "শপিং কার্ট",
  totalItemsLine: "মোট ({count}টি পণ্য)",
  deliveryNote: "ডেলিভারি চার্জ চেকআউটে হিসাব হবে।",
  checkoutBtn: "চেকআউট",
  goToCartPage: "কার্ট পেজে যান",
  emptyCartTitle: "আপনার কার্ট খালি",
  emptyCartText: "এখনো কোনো পণ্য যোগ করা হয়নি — পছন্দের পণ্য যোগ করে কেনাকাটা শুরু করুন।",
  startShopping: "কেনাকাটা শুরু করুন",
  removeItemAria: "{name} সরান",
  decreaseQtyAria: "পরিমাণ কমান",
  increaseQtyAria: "পরিমাণ বাড়ান",
  youMayAlsoLike: "আপনার ভালো লাগতে পারে",
  addShort: "যোগ করুন",

  // PDP gallery
  galleryAria: "পণ্যের ছবি বেছে নিন",
  viewImageAria: "ছবি {n} দেখুন",
  prevImageAria: "আগের ছবি",
  nextImageAria: "পরের ছবি",

  // PDP tabs
  tabsAria: "পণ্যের তথ্য",
  descriptionTab: "বিবরণ",
  reviewsTab: "কাস্টমার রিভিউ",

  // PDP actions
  buyNow: "এখনই কিনুন",
  orderOnWhatsApp: "WhatsApp-এ অর্ডার করুন",
  callForOrder: "কল করে অর্ডার করুন",
  whatsappPrefill: "আমি এই পণ্যটি অর্ডার করতে চাই: {title}",

  // PDP buy section
  noticeOutOfStock: "স্টকে আর নেই — কার্টে যোগ করা যায়নি।",
  noticeCapped: "কার্টে যোগ হয়েছে — স্টকে যা ছিল সব নেওয়া হয়েছে।",
  noticeAdded: "কার্টে যোগ হয়েছে ✓",
  soldOutSuffix: " (স্টক শেষ)",
  savePill: "সাশ্রয় {amount} ({pct}%)",
  lowStockLine: "মাত্র {stock}টি বাকি — দ্রুত অর্ডার করুন",
  quantityLabel: "পরিমাণ",
  weightApprox: "≈ {grams} গ্রাম (প্রতি ধাপ {step} গ্রাম)",

  // PDP composition
  trustDelivery: "দ্রুত ডেলিভারি — ঢাকার ভেতরে ২৪–৪৮ ঘণ্টা, সারাদেশে ২–৫ দিন",
  trustCod: "ক্যাশ অন ডেলিভারি — পণ্য হাতে পেয়ে টাকা পরিশোধ করুন",
  trustReturn: "সহজ রিটার্ন — পণ্যে সমস্যা থাকলে সহজ শর্তে রিটার্ন",
  trustGenuine: "আসল পণ্য — প্রতিটি পণ্য বিক্রেতা-যাচাইকৃত",
  preorderBadge: "⏳ প্রি-অর্ডার চলছে",
  reviewsCountLine: "{count}টি রিভিউ",
  brandLabel: "ব্র্যান্ড:",
  inStock: "স্টকে আছে",
  priceRangeLabel: "দামের পরিসর:",
  maxDiscountLine: "সর্বোচ্চ {pct}% ছাড়",
  digitalTitle: "📥 ডিজিটাল পণ্য — ফাইল ডেলিভারি",
  digitalText: "পেমেন্ট সম্পন্ন হলে ডাউনলোড লিংক আপনার অ্যাকাউন্টে পৌঁছে যাবে — কোনো শিপিং চার্জ নেই।",
  preorderTermsTitle: "⏳ প্রি-অর্ডারের শর্ত",
  preorderDeliveryLine: "সম্ভাব্য ডেলিভারি: {label}",
  preorderDepositLine: "বুকিং কনফার্ম করতে অগ্রিম {pct}% দিতে হবে — বাকি টাকা ডেলিভারির সময়।",
  preorderMaxUnitsLine: "সীমিত প্রি-অর্ডার: সর্বোচ্চ {count}টি পর্যন্ত",
  bundleUnavailableAlert: "এই বান্ডলের একটি উপাদান স্টকে নেই — বান্ডলটি এখন কেনা যাবে না।",
  priceOnRequestText:
    "এই পণ্যের দাম অর্ডারের সময় নিশ্চিত করা হয়। অর্ডার করতে কল করুন অথবা যোগাযোগ পেজ থেকে বার্তা পাঠান।",
  preorderCta: "প্রি-অর্ডার করুন",
  preorderBuyNow: "এখনই প্রি-অর্ডার করুন",
  bundleUnavailableLabel: "বান্ডল স্টকে নেই",
  podTitle: "🎨 কাস্টম প্রিন্ট পণ্য",
  podText: "এই পণ্যে আপনার নিজের লেখা ছাপানো যাবে (সর্বোচ্চ {max} অক্ষর{colors}) — লেখাটি চেকআউটে দিতে হবে।",
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
  sizeChartNote: "এই ভ্যারিয়েন্টের প্যাক অনুযায়ী মাপের টেবিল থাকতে পারে — ভ্যারিয়েন্ট বেছে সাইজ চার্ট বোতামে দেখুন।",
  faqTitle: "সাধারণ জিজ্ঞাসা",
  bundleContentsTitle: "বান্ডলে যা যা আছে",
  componentProductFallback: "কম্পোনেন্ট পণ্য",
  bundleComponentsTotalLabel: "উপাদানগুলোর মোট:",
  bundlePriceLabel: "বান্ডল মূল্য:",
  saveLabel: "সাশ্রয়",
  bundleUnavailableNote: "আপাতত বান্ডলটি স্টকে নেই — কম্পোনেন্টগুলো আলাদাভাবে কিনতে উপরের লিংকগুলো দেখুন।",
  relatedProducts: "সম্পর্কিত পণ্য",
};

export type ShobjiStrings = { [K in keyof typeof bn]: string };

const en: ShobjiStrings = {
  // Shared / navigation
  home: "Home",
  shop: "Shop",
  categories: "Categories",
  allProducts: "All Products",
  viewAllArrow: "View all →",
  breadcrumbAria: "Breadcrumb",

  // Header
  searchPlaceholderLong: "Search products… e.g. fresh vegetables, fruit, fish, meat",
  searchProductsAria: "Search products",
  searchSubmitAria: "Search",
  trackOrder: "Track Order",
  wishlist: "Wishlist",
  login: "Login",
  cart: "Cart",
  cartDrawerAria: "Cart — open drawer",
  cartDrawerAriaWithCount: "Cart, {count} items — open drawer",

  // Category sidebar
  categorySidebarAria: "Category sidebar",

  // Floating cart tab
  floatingCartAria: "Open cart — {count} items, total {total}",
  itemCountShort: "{count} items",

  // Footer
  footerIntro:
    "Fresh market vegetables, fruit and daily essentials now at your door — carefully picked products, accurate weights and fast home delivery.",
  contactUsBtn: "Contact us",
  paymentLabel: "Payment:",
  deliveryPartnerLabel: "Delivery partners:",
  allRightsReserved: "All rights reserved.",
  contactPrompt: "See here for contact details",

  // Product card
  addToCart: "Add to Cart",
  addedToCart: "Added ✓",
  outOfStock: "Out of Stock",
  priceOnRequest: "Contact us for the price",

  // Home hero
  heroAria: "Highlights",
  heroSearchPlaceholder: "What are you looking for? e.g. potatoes, onions, tomatoes…",
  heroCategoryLine: "{count} products — View all →",
  heroFallbackHeadline: "Today's fresh market, straight to your door",
  heroFallbackSubtext:
    "Vegetables, fruit, fish, meat and all your daily essentials — carefully picked and delivered quickly to your home.",
  bannerPickerAria: "Choose a banner",
  bannerNumberAria: "Banner {n}",

  // Home category tiles
  popularCategories: "Popular Categories",
  prevCategoriesAria: "Previous categories",
  nextCategoriesAria: "Next categories",
  productsCount: "{count} products",

  // Home featured rail
  customersChoice: "Customers' Choice",
  prevProductsAria: "Previous products",
  nextProductsAria: "Next products",

  // Home brands
  ourBrands: "Our Brands",

  // Home testimonials
  customerOpinionsAria: "Customer opinions",
  customersSayTitle: "What Customers Are Saying",
  productLabelColon: "Product:",

  // Home sections / USP cards
  benefitsAria: "Our benefits",
  uspCodTitle: "Cash on Delivery",
  uspCodText: "Pay when you receive your products",
  uspDeliveryTitle: "Home Delivery",
  uspDeliveryText: "Delivered right to your doorstep",
  uspReturnTitle: "Easy Returns",
  uspReturnText: "Simple returns if there is a problem",
  uspQualityTitle: "Verified Quality",
  uspQualityText: "Every product is checked before dispatch",
  pickedForYou: "Picked for You",
  loadMore: "View More",

  // Shop chrome
  filterByCategory: "Filter by Category",
  allCategories: "All Categories",
  priceRange: "Price Range",
  allPrices: "All Prices",
  brand: "Brand",
  allBrands: "All Brands",
  ratingAndStock: "Rating & Stock",
  inStockOnlyOption: "In Stock Only",
  productsLoading: "Loading products…",
  showingProducts: "Showing {shown} of {total} products",
  filtersAppliedSuffix: " — filters applied",
  activeFiltersCount: "{count} filters active",
  sortBy: "Sort By:",
  removeFilterAria: "Remove {label} filter",
  clearAllFilters: "Clear all filters",
  priceUnder500: "Under 500 taka",
  price500to1000: "500 – 1,000 taka",
  price1000to3000: "1,000 – 3,000 taka",
  priceOver3000: "Over 3,000 taka",
  sortPopularity: "Popularity",
  sortNewest: "Newest first",
  sortPriceAsc: "Price: low to high",
  sortPriceDesc: "Price: high to low",
  sortRating: "Rating",
  ratingAll: "All ratings",
  rating4Up: "4★ & up",
  rating3Up: "3★ & up",

  // Cart drawer
  drawerTitle: "SHOPPING CART",
  totalItemsLine: "Total ({count} items)",
  deliveryNote: "Delivery charge will be calculated at checkout.",
  checkoutBtn: "Checkout",
  goToCartPage: "Go to Cart Page",
  emptyCartTitle: "Your Cart is Empty",
  emptyCartText: "No products added yet — add your favourites and start shopping.",
  startShopping: "Start Shopping",
  removeItemAria: "Remove {name}",
  decreaseQtyAria: "Decrease quantity",
  increaseQtyAria: "Increase quantity",
  youMayAlsoLike: "You May Also Like",
  addShort: "Add",

  // PDP gallery
  galleryAria: "Choose a product image",
  viewImageAria: "View image {n}",
  prevImageAria: "Previous image",
  nextImageAria: "Next image",

  // PDP tabs
  tabsAria: "Product information",
  descriptionTab: "Description",
  reviewsTab: "Customer Reviews",

  // PDP actions
  buyNow: "Buy Now",
  orderOnWhatsApp: "Order On WhatsApp",
  callForOrder: "Call For Order",
  whatsappPrefill: "I want to order this product: {title}",

  // PDP buy section
  noticeOutOfStock: "Out of stock — could not be added to the cart.",
  noticeCapped: "Added to cart — all the available stock has been taken.",
  noticeAdded: "Added to cart ✓",
  soldOutSuffix: " (Out of Stock)",
  savePill: "Save {amount} ({pct}%)",
  lowStockLine: "Only {stock} left — order soon",
  quantityLabel: "Quantity",
  weightApprox: "≈ {grams} g (each step {step} g)",

  // PDP composition
  trustDelivery: "Fast delivery — inside Dhaka 24–48 hours, nationwide 2–5 days",
  trustCod: "Cash on delivery — pay when you receive your products",
  trustReturn: "Easy returns — simple returns if there is a problem with the product",
  trustGenuine: "Genuine products — every product is seller-verified",
  preorderBadge: "⏳ Pre-order is open",
  reviewsCountLine: "{count} reviews",
  brandLabel: "Brand:",
  inStock: "In Stock",
  priceRangeLabel: "Price range:",
  maxDiscountLine: "Up to {pct}% off",
  digitalTitle: "📥 Digital product — file delivery",
  digitalText: "Once payment is complete, the download link will arrive in your account — there is no shipping charge.",
  preorderTermsTitle: "⏳ Pre-order terms",
  preorderDeliveryLine: "Expected delivery: {label}",
  preorderDepositLine: "An advance of {pct}% is required to confirm the booking — the rest is payable on delivery.",
  preorderMaxUnitsLine: "Limited pre-order: up to {count} units",
  bundleUnavailableAlert: "One item in this bundle is out of stock — the bundle cannot be bought right now.",
  priceOnRequestText:
    "The price of this product is confirmed at order time. To order, call us or send a message from the contact page.",
  preorderCta: "Place Pre-order",
  preorderBuyNow: "Pre-order Now",
  bundleUnavailableLabel: "Bundle Out of Stock",
  podTitle: "🎨 Custom print product",
  podText: "Your own text can be printed on this product (up to {max} characters{colors}) — you will provide the text at checkout.",
  podColorsSegment: ", and you can choose a colour too",
  podFeeSuffix: " The print fee is {fee} per item and will be added to the order total.",
  standardVariantLabel: "Standard",
  weightedTitle: "⚖️ Priced by weight — you can also buy a fraction of a pack (by weight step)",
  packLabel: "Pack:",
  gramsUnit: "g",
  perKgLabel: "per kg",
  packPriceLabel: "pack price",
  weightedStaleNote: "(Price update by rate is pending — the price shown above applies)",
  noDescription: "No description has been added for this product yet.",
  specifications: "Specifications",
  sizeChartNote: "This variant may have a size table by pack — choose the variant and check the Size Chart button.",
  faqTitle: "Frequently Asked Questions",
  bundleContentsTitle: "What's in the Bundle",
  componentProductFallback: "Component product",
  bundleComponentsTotalLabel: "Total of components:",
  bundlePriceLabel: "Bundle price:",
  saveLabel: "Save",
  bundleUnavailableNote: "The bundle is currently out of stock — see the links above to buy the components separately.",
  relatedProducts: "Related Products",
};

export const SHOBJI_STRINGS: Record<Locale, ShobjiStrings> = { bn, en };

/* ------------------------------------------------------------------ */
/* Shop filter option lists — values are ShopBrowser's URL contract   */
/* (unchanged); only the labels are locale copy.                      */
/* ------------------------------------------------------------------ */

export interface ShobjiPriceRange {
  label: string;
  min?: number;
  max?: number;
}

export const SHOBJI_PRICE_RANGES: Record<Locale, ReadonlyArray<ShobjiPriceRange>> = {
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

export const SHOBJI_SORT_OPTIONS: Record<
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

export const SHOBJI_RATING_OPTIONS: Record<
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
    { value: 4, label: "4★ & Above" },
    { value: 3, label: "3★ & Above" },
  ],
};
