/**
 * Bazaar theme-local dictionary (doc 30 unified language system).
 *
 * Every hardcoded UI string in this package lives here, in BOTH
 * locales, following the exact pattern of src/i18n/dictionaries.ts:
 * the `bn` object is written once, `en` is typed as the mapped
 * string type over bn's keys, so a missing/extra key in either
 * locale fails compilation (parity). Templates use `{name}`
 * placeholders, filled with interpolate() from "@/i18n/locale".
 *
 * Merchant/DB content (product titles, category names, CMS menu
 * labels, review text…) is NOT here — only this package's own
 * hardcoded UI copy.
 */
import type { Locale } from "@/i18n/locale";

const bn = {
  // Header
  searchPlaceholder: "পণ্য খুঁজুন… যেমন: খাঁটি সরিষার তেল, মধু, খেজুর",
  searchAria: "পণ্য খুঁজুন",
  searchButtonAria: "খুঁজুন",
  trackOrderAction: "অর্ডার ট্র্যাক করুন",
  signInAction: "সাইন ইন",
  wishlistAction: "উইশলিস্ট",
  cartLabel: "কার্ট",
  cartDrawerAria: "কার্ট — ড্রয়ার খুলুন",
  cartDrawerAriaCount: "কার্ট, {count}টি পণ্য — ড্রয়ার খুলুন",
  floatingCartAria: "কার্ট খুলুন — {count}টি পণ্য, মোট {total}",
  itemCountShort: "{count}টি",
  categoriesAria: "ক্যাটাগরি",
  allCategories: "সব ক্যাটাগরি",
  chatContactAria: "চ্যাটে যোগাযোগ করুন",
  callOrderAria: "কল করে অর্ডার করুন",
  backToTopAria: "উপরে যান",

  // Footer
  footerIntro:
    "প্রতিদিনের টাটকা ও খাঁটি বাজার এখন ঘরে বসেই — যত্নে বাছাই করা পণ্য, সঠিক ওজন আর সারাদেশে নির্ভরযোগ্য ডেলিভারি।",
  trackOrderButton: "অর্ডার ট্র্যাক করুন",
  contactButton: "যোগাযোগ করুন",
  paymentLabel: "পেমেন্ট:",
  deliveryPartnerLabel: "ডেলিভারি পার্টনার:",
  copyrightLine: "© {year} {brand} — সর্বস্বত্ব সংরক্ষিত।",
  contactHint: "যোগাযোগের জন্য এখানে দেখুন",

  // Cart drawer
  cartDrawerTitle: "শপিং কার্ট",
  cartTotalItems: "মোট ({count}টি পণ্য)",
  deliveryChargeNote: "ডেলিভারি চার্জ চেকআউটে হিসাব হবে।",
  checkoutButton: "চেকআউট",
  goToCartPage: "কার্ট পেজে যান",
  cartEmptyTitle: "আপনার কার্ট খালি",
  cartEmptyText: "এখনো কোনো পণ্য যোগ করা হয়নি — পছন্দের পণ্য যোগ করে কেনাকাটা শুরু করুন।",
  startShopping: "কেনাকাটা শুরু করুন",
  removeItemAria: "{name} সরান",
  qtyDecreaseAria: "পরিমাণ কমান",
  qtyIncreaseAria: "পরিমাণ বাড়ান",
  youMayAlsoLike: "আপনার ভালো লাগতে পারে",
  youMayAlsoLikeAria: "আপনার ভালো লাগতে পারে",
  addButton: "যোগ করুন",

  // Product card
  savingBadge: "সাশ্রয় {pct}%",
  outOfStock: "স্টক শেষ",
  inStock: "স্টকে আছে",
  addedToCart: "যোগ হয়েছে ✓",
  addToCartButton: "কার্টে যোগ করুন",
  priceOnRequest: "দামের জন্য যোগাযোগ করুন",

  // Home sections / trust strip
  trustCodTitle: "ক্যাশ অন ডেলিভারি",
  trustCodText: "পণ্য হাতে পেয়ে মূল্য পরিশোধ",
  trustDeliveryTitle: "সারাদেশে ডেলিভারি",
  trustDeliveryText: "জেলা-উপজেলায় হোম ডেলিভারি",
  trustReturnTitle: "সহজ রিটার্ন",
  trustReturnText: "সমস্যা থাকলে সহজ শর্তে রিটার্ন",
  trustQualityTitle: "যাচাই করা মান",
  trustQualityText: "প্রতিটি পণ্য যাচাই করে পাঠাই",
  ourBenefitsAria: "আমাদের সুবিধা",
  viewAllItems: "সব পণ্য দেখুন →",
  justForYou: "আপনার জন্য",
  justForYouAria: "আপনার জন্য",
  loadMore: "আরও দেখুন",

  // Home hero
  heroStaticHeadline: "খাঁটি ও প্রাকৃতিক পণ্য, প্রতিদিনের বাজার",
  heroStaticSubtext:
    "মধু, খেজুর, ঘি, তেল ও মসলা — যাচাই করা মানের পণ্য ক্যাশ অন ডেলিভারিতে সারাদেশে।",
  heroCategoryCountLine: "{count}টি পণ্য — সব দেখুন →",
  allCategoriesSub: "দোকানের সব পণ্য একসাথে দেখুন →",
  highlightsAria: "হাইলাইট",
  bannerPickerAria: "ব্যানার বেছে নিন",
  bannerNumberAria: "ব্যানার {n}",

  // Home categories
  featuredCategoriesAria: "ফিচার্ড ক্যাটাগরি",
  featuredCategories: "ফিচার্ড ক্যাটাগরি",
  prevCategoriesAria: "আগের ক্যাটাগরি",
  nextCategoriesAria: "পরের ক্যাটাগরি",
  productCountLine: "{count}টি পণ্য",

  // Home brands
  ourBrandsAria: "আমাদের ব্র্যান্ড",
  ourBrands: "আমাদের ব্র্যান্ড",
  seeAll: "সব দেখুন →",

  // Home testimonials
  testimonialsAria: "কাস্টমারদের মতামত",
  testimonialsHeading: "কাস্টমাররা যা বলছেন",
  productLabel: "পণ্য:",

  // Home top selling
  topSellingAria: "সেরা বিক্রি",
  topSelling: "সেরা বিক্রি",
  prevProductsAria: "আগের পণ্য",
  nextProductsAria: "পরের পণ্য",

  // Shop chrome
  filterByCategory: "ক্যাটাগরি দিয়ে ফিল্টার",
  priceRangeTitle: "দামের পরিসর",
  allPrices: "সব দাম",
  brandsTitle: "ব্র্যান্ড",
  allBrands: "সব ব্র্যান্ড",
  ratingAvailabilityTitle: "রেটিং ও উপস্থিতি",
  allProductsFilter: "সব পণ্য",
  inStockOnlyFilter: "শুধু স্টকে আছে",
  breadcrumbAria: "ব্রেডক্রাম্ব",
  homeCrumb: "হোম",
  shopCrumb: "দোকান",
  loadingProducts: "পণ্য লোড হচ্ছে…",
  showingProducts: "মোট {total}টি পণ্যের মধ্যে {shown}টি দেখানো হচ্ছে",
  filtersAppliedSuffix: " — ফিল্টার প্রয়োগ করা হয়েছে",
  activeFiltersCount: "{count}টি ফিল্টার সক্রিয়",
  sortByLabel: "সাজান:",
  removeFilterAria: "{label} ফিল্টার সরান",
  clearAllFilters: "সব ফিল্টার মুছুন",
  priceRangeUnder500: "৫০০ টাকার কম",
  priceRange500to1000: "৫০০ – ১,০০০ টাকা",
  priceRange1000to3000: "১,০০০ – ৩,০০০ টাকা",
  priceRangeOver3000: "৩,০০০ টাকার বেশি",
  sortRelevance: "জনপ্রিয়তা",
  sortNewest: "নতুন আগে",
  sortPriceAsc: "দাম: কম থেকে বেশি",
  sortPriceDesc: "দাম: বেশি থেকে কম",
  sortRating: "রেটিং",
  ratingAll: "সব রেটিং",
  rating4Plus: "৪★ ও উপরে",
  rating3Plus: "৩★ ও উপরে",

  // PDP actions
  whatsappOrderText: "আমি এই পণ্যটি অর্ডার করতে চাই: {title}",
  buyNowButton: "এখনই কিনুন",
  orderOnWhatsapp: "WhatsApp-এ অর্ডার করুন",
  callForOrder: "কল করে অর্ডার করুন",

  // PDP buy section
  noticeOutOfStock: "স্টকে আর নেই — কার্টে যোগ করা যায়নি।",
  noticeCapped: "কার্টে যোগ হয়েছে — স্টকে যা ছিল সব নেওয়া হয়েছে।",
  noticeAdded: "কার্টে যোগ হয়েছে ✓",
  soldOutSuffix: " (স্টক শেষ)",
  savePill: "সাশ্রয় {amount} ({pct}%)",
  lowStockWarning: "মাত্র {stock}টি বাকি — দ্রুত অর্ডার করুন",
  quantityLabel: "পরিমাণ",
  weightApprox: "≈ {grams} গ্রাম (প্রতি ধাপ {pack} গ্রাম)",

  // PDP gallery
  galleryThumbsAria: "পণ্যের ছবি বেছে নিন",
  galleryImageAria: "ছবি {n} দেখুন",
  prevImageAria: "আগের ছবি",
  nextImageAria: "পরের ছবি",

  // PDP tabs
  pdpTabsAria: "পণ্যের তথ্য",
  descriptionTab: "বিবরণ",
  reviewsTab: "কাস্টমার রিভিউ",

  // PDP composition
  trustFastDelivery: "দ্রুত ডেলিভারি — ঢাকার ভেতরে ২৪–৪৮ ঘণ্টা, সারাদেশে ২–৫ দিন",
  trustCodRow: "ক্যাশ অন ডেলিভারি — পণ্য হাতে পেয়ে টাকা পরিশোধ করুন",
  trustEasyReturn: "সহজ রিটার্ন — পণ্যে সমস্যা থাকলে সহজ শর্তে রিটার্ন",
  trustGenuine: "আসল পণ্য — প্রতিটি পণ্য বিক্রেতা-যাচাইকৃত",
  preorderBadge: "⏳ প্রি-অর্ডার চলছে",
  reviewsCount: "{count}টি রিভিউ",
  brandLabel: "ব্র্যান্ড:",
  priceRangeLabel: "দামের পরিসর:",
  maxDiscount: "সর্বোচ্চ {pct}% ছাড়",
  digitalTitle: "📥 ডিজিটাল পণ্য — ফাইল ডেলিভারি",
  digitalText:
    "পেমেন্ট সম্পন্ন হলে ডাউনলোড লিংক আপনার অ্যাকাউন্টে পৌঁছে যাবে — কোনো শিপিং চার্জ নেই।",
  preorderTermsTitle: "⏳ প্রি-অর্ডারের শর্ত",
  expectedDelivery: "সম্ভাব্য ডেলিভারি: {label}",
  preorderDeposit: "বুকিং কনফার্ম করতে অগ্রিম {pct}% দিতে হবে — বাকি টাকা ডেলিভারির সময়।",
  preorderMaxUnits: "সীমিত প্রি-অর্ডার: সর্বোচ্চ {count}টি পর্যন্ত",
  bundleUnavailableAlert: "এই বান্ডলের একটি উপাদান স্টকে নেই — বান্ডলটি এখন কেনা যাবে না।",
  priceOnRequestText:
    "এই পণ্যের দাম অর্ডারের সময় নিশ্চিত করা হয়। অর্ডার করতে কল করুন অথবা যোগাযোগ পেজ থেকে বার্তা পাঠান।",
  preorderCta: "প্রি-অর্ডার করুন",
  preorderBuyNow: "এখনই প্রি-অর্ডার করুন",
  bundleUnavailableLabel: "বান্ডল স্টকে নেই",
  podTitle: "🎨 কাস্টম প্রিন্ট পণ্য",
  podText: "এই পণ্যে আপনার নিজের লেখা ছাপানো যাবে (সর্বোচ্চ {max} অক্ষর{colors}) — লেখাটি চেকআউটে দিতে হবে।",
  podColorsSuffix: ", রঙও বেছে নেওয়া যাবে",
  podFeeSuffix: " প্রিন্ট ফি প্রতি আইটেমে {fee} টাকা, অর্ডারের মোটে যোগ হবে।",
  weightedTitle: "⚖️ ওজন অনুযায়ী দাম — প্যাকের ভগ্নাংশেও কেনা যায় (ওজনের ধাপ অনুযায়ী)",
  weightedPackLine: "প্যাক: {grams} গ্রাম · প্রতি কেজি {price}",
  weightedPackPrice: " · প্যাকের দাম {price}",
  weightedOutdatedNote: " · (হার অনুযায়ী দাম হালনাগাদ বাকি — উপরে দেখানো দামই প্রযোজ্য)",
  descriptionMissing: "এই পণ্যের বিবরণ এখনো যোগ করা হয়নি।",
  sizeChartPackNote:
    "এই ভ্যারিয়েন্টের প্যাক অনুযায়ী মাপের টেবিল থাকতে পারে — ভ্যারিয়েন্ট বেছে সাইজ চার্ট বোতামে দেখুন।",
  specificationsTitle: "স্পেসিফিকেশন",
  faqTitle: "সাধারণ জিজ্ঞাসা",
  bundleContentsTitle: "বান্ডলে যা যা আছে",
  componentProductFallback: "কম্পোনেন্ট পণ্য",
  componentsTotalLabel: "উপাদানগুলোর মোট:",
  bundlePriceLabel: "বান্ডল মূল্য:",
  saveAmount: "সাশ্রয় {amount}",
  bundleOutOfStockNote: "আপাতত বান্ডলটি স্টকে নেই — কম্পোনেন্টগুলো আলাদাভাবে কিনতে উপরের লিংকগুলো দেখুন।",
  relatedAria: "সম্পর্কিত পণ্য",
  relatedTitle: "সম্পর্কিত পণ্য",
  standardVariant: "স্ট্যান্ডার্ড",
};

export type BazaarStrings = { [K in keyof typeof bn]: string };

const en: BazaarStrings = {
  // Header
  searchPlaceholder: "Search products… e.g. pure mustard oil, honey, dates",
  searchAria: "Search products",
  searchButtonAria: "Search",
  trackOrderAction: "Track Order",
  signInAction: "Sign In",
  wishlistAction: "Wishlist",
  cartLabel: "Cart",
  cartDrawerAria: "Cart — open drawer",
  cartDrawerAriaCount: "Cart, {count} items — open drawer",
  floatingCartAria: "Open cart — {count} items, total {total}",
  itemCountShort: "{count} items",
  categoriesAria: "Categories",
  allCategories: "All Categories",
  chatContactAria: "Contact via chat",
  callOrderAria: "Call to order",
  backToTopAria: "Back to top",

  // Footer
  footerIntro:
    "Fresh, pure everyday groceries, now from the comfort of home — carefully selected products, accurate weight and reliable delivery across the country.",
  trackOrderButton: "Track Order",
  contactButton: "Contact Us",
  paymentLabel: "Payment:",
  deliveryPartnerLabel: "Delivery partners:",
  copyrightLine: "© {year} {brand} — All rights reserved.",
  contactHint: "See here for contact details",

  // Cart drawer
  cartDrawerTitle: "SHOPPING CART",
  cartTotalItems: "Total ({count} items)",
  deliveryChargeNote: "Delivery charge will be calculated at checkout.",
  checkoutButton: "Checkout",
  goToCartPage: "Go to cart page",
  cartEmptyTitle: "Your cart is empty",
  cartEmptyText: "No products have been added yet — add your favourites and start shopping.",
  startShopping: "Start Shopping",
  removeItemAria: "Remove {name}",
  qtyDecreaseAria: "Decrease quantity",
  qtyIncreaseAria: "Increase quantity",
  youMayAlsoLike: "You May Also Like",
  youMayAlsoLikeAria: "You may also like",
  addButton: "Add",

  // Product card
  savingBadge: "Save {pct}%",
  outOfStock: "Out of Stock",
  inStock: "In Stock",
  addedToCart: "Added ✓",
  addToCartButton: "Add To Cart",
  priceOnRequest: "Contact for price",

  // Home sections / trust strip
  trustCodTitle: "Cash on Delivery",
  trustCodText: "Pay when you receive the product",
  trustDeliveryTitle: "Nationwide Delivery",
  trustDeliveryText: "Home delivery to districts and upazilas",
  trustReturnTitle: "Easy Returns",
  trustReturnText: "Easy returns if there is a problem",
  trustQualityTitle: "Verified Quality",
  trustQualityText: "Every product is checked before dispatch",
  ourBenefitsAria: "Our benefits",
  viewAllItems: "VIEW ALL ITEMS →",
  justForYou: "Just For You",
  justForYouAria: "Just for you",
  loadMore: "LOAD MORE",

  // Home hero
  heroStaticHeadline: "Pure, natural products — your everyday market",
  heroStaticSubtext:
    "Honey, dates, ghee, oil and spices — quality-checked products with cash on delivery, nationwide.",
  heroCategoryCountLine: "{count} products — view all →",
  allCategoriesSub: "See all the store's products together →",
  highlightsAria: "Highlights",
  bannerPickerAria: "Choose a banner",
  bannerNumberAria: "Banner {n}",

  // Home categories
  featuredCategoriesAria: "Featured categories",
  featuredCategories: "Featured Categories",
  prevCategoriesAria: "Previous categories",
  nextCategoriesAria: "Next categories",
  productCountLine: "{count} products",

  // Home brands
  ourBrandsAria: "Our brands",
  ourBrands: "Our Brands",
  seeAll: "SEE ALL →",

  // Home testimonials
  testimonialsAria: "Customer reviews",
  testimonialsHeading: "What Customers Are Saying",
  productLabel: "Product:",

  // Home top selling
  topSellingAria: "Top selling",
  topSelling: "Top Selling",
  prevProductsAria: "Previous products",
  nextProductsAria: "Next products",

  // Shop chrome
  filterByCategory: "Filter by Category",
  priceRangeTitle: "Price Range",
  allPrices: "All prices",
  brandsTitle: "Brands",
  allBrands: "All Brands",
  ratingAvailabilityTitle: "Rating & Availability",
  allProductsFilter: "All products",
  inStockOnlyFilter: "In stock only",
  breadcrumbAria: "Breadcrumb",
  homeCrumb: "Home",
  shopCrumb: "Shop",
  loadingProducts: "Loading products…",
  showingProducts: "Showing {shown} of {total} products",
  filtersAppliedSuffix: " — filters applied",
  activeFiltersCount: "{count} active filters",
  sortByLabel: "Sort By:",
  removeFilterAria: "Remove {label} filter",
  clearAllFilters: "Clear all filters",
  priceRangeUnder500: "Under 500 taka",
  priceRange500to1000: "500 – 1,000 taka",
  priceRange1000to3000: "1,000 – 3,000 taka",
  priceRangeOver3000: "Over 3,000 taka",
  sortRelevance: "Popularity",
  sortNewest: "Newest first",
  sortPriceAsc: "Price: low to high",
  sortPriceDesc: "Price: high to low",
  sortRating: "Rating",
  ratingAll: "All ratings",
  rating4Plus: "4★ & above",
  rating3Plus: "3★ & above",

  // PDP actions
  whatsappOrderText: "I want to order this product: {title}",
  buyNowButton: "Buy Now",
  orderOnWhatsapp: "Order On WhatsApp",
  callForOrder: "Call For Order",

  // PDP buy section
  noticeOutOfStock: "Out of stock — could not be added to the cart.",
  noticeCapped: "Added to cart — all the available stock was taken.",
  noticeAdded: "Added to cart ✓",
  soldOutSuffix: " (Out of stock)",
  savePill: "Save {amount} ({pct}%)",
  lowStockWarning: "Only {stock} left — order soon",
  quantityLabel: "Quantity",
  weightApprox: "≈ {grams} g (each step {pack} g)",

  // PDP gallery
  galleryThumbsAria: "Choose a product image",
  galleryImageAria: "View image {n}",
  prevImageAria: "Previous image",
  nextImageAria: "Next image",

  // PDP tabs
  pdpTabsAria: "Product information",
  descriptionTab: "Description",
  reviewsTab: "Customer Reviews",

  // PDP composition
  trustFastDelivery: "Fast delivery — 24–48 hours inside Dhaka, 2–5 days nationwide",
  trustCodRow: "Cash on delivery — pay when you receive the product",
  trustEasyReturn: "Easy returns — on simple terms if the product has a problem",
  trustGenuine: "Genuine products — every product is seller-verified",
  preorderBadge: "⏳ Pre-order is on",
  reviewsCount: "{count} reviews",
  brandLabel: "Brand:",
  priceRangeLabel: "Price range:",
  maxDiscount: "Up to {pct}% off",
  digitalTitle: "📥 Digital product — file delivery",
  digitalText:
    "Once payment is complete, the download link will reach your account — no shipping charge.",
  preorderTermsTitle: "⏳ Pre-order terms",
  expectedDelivery: "Expected delivery: {label}",
  preorderDeposit: "Pay {pct}% in advance to confirm the booking — the rest is due on delivery.",
  preorderMaxUnits: "Limited pre-order: up to {count} units",
  bundleUnavailableAlert: "One component of this bundle is out of stock — the bundle cannot be bought right now.",
  priceOnRequestText:
    "This product's price is confirmed at order time. Call to order, or send a message from the contact page.",
  preorderCta: "Pre-order",
  preorderBuyNow: "Pre-order Now",
  bundleUnavailableLabel: "Bundle out of stock",
  podTitle: "🎨 Custom print product",
  podText: "Your own text can be printed on this product (up to {max} characters{colors}) — you will enter the text at checkout.",
  podColorsSuffix: ", colours can also be chosen",
  podFeeSuffix: " Print fee is {fee} taka per item, added to the order total.",
  weightedTitle: "⚖️ Priced by weight — buy fractions of a pack too (by weight step)",
  weightedPackLine: "Pack: {grams} g · per kg {price}",
  weightedPackPrice: " · Pack price {price}",
  weightedOutdatedNote: " · (Price update by rate pending — the price shown above applies)",
  descriptionMissing: "No description has been added for this product yet.",
  sizeChartPackNote:
    "This variant's pack may have its own size table — pick a variant and check the size chart button.",
  specificationsTitle: "Specifications",
  faqTitle: "Frequently Asked Questions",
  bundleContentsTitle: "What's in the Bundle",
  componentProductFallback: "Component product",
  componentsTotalLabel: "Components total:",
  bundlePriceLabel: "Bundle price:",
  saveAmount: "Save {amount}",
  bundleOutOfStockNote: "The bundle is out of stock for now — see the links above to buy the components separately.",
  relatedAria: "Related products",
  relatedTitle: "Related Products",
  standardVariant: "Standard",
};

export const BAZAAR_STRINGS: Record<Locale, BazaarStrings> = { bn, en };
