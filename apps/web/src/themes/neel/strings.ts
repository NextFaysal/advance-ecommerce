/**
 * Neel theme — UI dictionary (doc 30 unified language system).
 *
 * EVERY hardcoded UI string in this package lives here, in both
 * locales, with identical key sets (TypeScript enforces parity:
 * `en` is typed as the mapped type of `bn`). Client components
 * read it via useLocale() + pick(); server compositions via
 * getRequestLocale() + pick().
 *
 * Merchant / DB content (product titles, category names, CMS
 * menu labels, hero-slide copy) is NOT here — that is merchant
 * content and keeps rendering from its own data fields.
 */
import type { Locale } from "@/i18n/locale";

const bn = {
  // Header
  stripDelivery: "সারা দেশে হোম ডেলিভারি — অর্ডার করুন ঘরে বসেই",
  aboutUs: "আমাদের সম্পর্কে",
  trackOrder: "অর্ডার ট্র্যাক করুন",
  signIn: "সাইন ইন",
  register: "রেজিস্টার",
  help: "সাহায্য",
  quickLinksAria: "দ্রুত লিংক",
  searchPlaceholder: "পণ্য খুঁজুন… যেমন: শাড়ি, মোবাইল, জুতা",
  searchAria: "পণ্য খুঁজুন",
  searchSubmitAria: "খুঁজুন",
  wishlistLabel: "উইশলিস্ট",
  wishlistAria: "উইশলিস্ট",
  wishlistAriaCount: "উইশলিস্ট, {count}টি পণ্য",
  compareLabel: "তুলনা",
  compareAria: "তুলনা দেখুন",
  cartLabel: "কার্ট",
  cartAria: "কার্ট — ড্রয়ার খুলুন",
  cartAriaCount: "কার্ট, {count}টি পণ্য — ড্রয়ার খুলুন",

  // Footer
  footerIntro:
    "পছন্দের পণ্য ঘরে বসেই — এক জায়গায় হাজারো পণ্য, পরিষ্কার দাম আর দেশজুড়ে যত্নে ডেলিভারি।",
  footerTrackOrder: "অর্ডার ট্র্যাক করুন",
  footerContact: "যোগাযোগ করুন",
  footerColInformation: "তথ্য",
  footerColShopBy: "কেনাকাটা",
  footerColSupport: "সাপোর্ট",
  footerColPolicy: "ভোক্তা নীতি",
  paymentLabel: "পেমেন্ট:",
  deliveryPartnerLabel: "ডেলিভারি পার্টনার:",
  rightsReserved: "সর্বস্বত্ব সংরক্ষিত।",
  contactPrompt: "যোগাযোগের জন্য এখানে দেখুন",
  poweredBy: "Powered by Advance Ecommerce",

  // Cart drawer
  yourCart: "আপনার কার্ট",
  cartTotalCount: "মোট ({count}টি পণ্য)",
  deliveryNote: "ডেলিভারি চার্জ চেকআউটে হিসাব হবে।",
  checkoutLabel: "চেকআউট",
  goToCartPage: "কার্ট পেজে যান",
  emptyCartTitle: "কার্টে কিছু নেই",
  emptyCartText: "পছন্দের পণ্য বেছে কার্টে যোগ করুন — তারপর এক ক্লিকে অর্ডার।",
  browseProducts: "পণ্য দেখতে যান",
  removeItemAria: "{name} সরান",
  decreaseQty: "পরিমাণ কমান",
  increaseQty: "পরিমাণ বাড়ান",
  seeMore: "আরও দেখুন",
  addLabel: "যোগ করুন",

  // Shared commerce words
  inStock: "স্টকে আছে",
  outOfStock: "স্টক শেষ",
  outOfStockSuffix: " (স্টক শেষ)",
  priceOnRequest: "দামের জন্য যোগাযোগ করুন",
  addToCartLabel: "কার্টে যোগ করুন",
  buyNowLabel: "এখনই কিনুন",
  breadcrumbAria: "ব্রেডক্রাম্ব",
  crumbHome: "হোম",
  crumbShop: "দোকান",
  itemsCount: "{count}টি পণ্য",

  // Home — category circles
  categoriesAria: "ক্যাটাগরি",
  shopByCategory: "ক্যাটাগরি ধরে কেনাকাটা",
  prevCategories: "আগের ক্যাটাগরি",
  nextCategories: "পরের ক্যাটাগরি",

  // Home — hero
  heroStaticHeadline: "যা দরকার, সব এক ছাদের নিচে",
  heroStaticSubtext:
    "ফ্যাশন, ইলেকট্রনিক্স, ঘরোয়া পণ্য — পরিষ্কার দামে, সারাদেশে ডেলিভারিসহ।",
  viewAllProductsBtn: "সব পণ্য দেখুন",
  categoryTileMeta: "{count}টি পণ্য — দেখুন →",
  allCategories: "সব ক্যাটাগরি",
  allCategoriesSub: "দোকানের সব পণ্য একসাথে দেখুন →",
  highlightAria: "হাইলাইট",
  bannerPickerAria: "ব্যানার বেছে নিন",
  bannerAria: "ব্যানার {n}",

  // Home — sections / trust strip
  trustCodTitle: "ক্যাশ অন ডেলিভারি",
  trustCodText: "পণ্য হাতে পেয়ে মূল্য পরিশোধ",
  trustDeliveryTitle: "দেশজুড়ে ডেলিভারি",
  trustDeliveryText: "জেলা-উপজেলায় হোম ডেলিভারি",
  trustTrackingTitle: "অর্ডার ট্র্যাকিং",
  trustTrackingText: "যেকোনো সময় অর্ডারের অবস্থা দেখুন",
  trustReturnTitle: "সহজ রিটার্ন",
  trustReturnText: "সমস্যা থাকলে সহজ শর্তে রিটার্ন",
  viewAllLink: "সব দেখুন →",
  benefitsAria: "আমাদের সুবিধা",
  pickedForYou: "আপনার জন্য বাছাই",
  loadMore: "আরও দেখুন",

  // Home — testimonials
  testimonialsAria: "ক্রেতাদের অভিজ্ঞতা",
  testimonialsHeading: "ক্রেতারা যা বললেন",
  productPrefix: "পণ্য:",

  // Home — featured rail
  featuredProducts: "নির্বাচিত পণ্য",
  prevProducts: "আগের পণ্য",
  nextProducts: "পরের পণ্য",

  // PDP — composition
  preorderBadge: "প্রি-অর্ডার চলছে",
  reviewsCount: "{count}টি রিভিউ",
  brandLabel: "ব্র্যান্ড:",
  priceRangeLabel: "দামের পরিসর:",
  maxDiscount: "সর্বোচ্চ {pct}% ছাড়",
  digitalTitle: "ডিজিটাল পণ্য — ফাইল ডেলিভারি",
  digitalText:
    "পেমেন্ট সম্পন্ন হলে ডাউনলোড লিংক আপনার অ্যাকাউন্টে পৌঁছে যাবে — কোনো শিপিং চার্জ নেই।",
  preorderTermsTitle: "প্রি-অর্ডারের শর্ত",
  preorderDelivery: "সম্ভাব্য ডেলিভারি: {date}",
  preorderDeposit:
    "বুকিং কনফার্ম করতে অগ্রিম {pct}% দিতে হবে — বাকি টাকা ডেলিভারির সময়।",
  preorderMaxUnits: "সীমিত প্রি-অর্ডার: সর্বোচ্চ {count}টি পর্যন্ত",
  bundleUnavailableAlert:
    "এই বান্ডলের একটি উপাদান স্টকে নেই — বান্ডলটি এখন কেনা যাবে না।",
  priceOnRequestText:
    "এই পণ্যের দাম অর্ডারের সময় নিশ্চিত করা হয়। অর্ডার করতে কল করুন অথবা যোগাযোগ পেজ থেকে বার্তা পাঠান।",
  contactUsBtn: "যোগাযোগ করুন",
  preorderCta: "প্রি-অর্ডার করুন",
  preorderBuyNow: "এখনই প্রি-অর্ডার করুন",
  bundleUnavailableLabel: "বান্ডল স্টকে নেই",
  podTitle: "কাস্টম প্রিন্ট পণ্য",
  podText:
    "এই পণ্যে আপনার নিজের লেখা ছাপানো যাবে (সর্বোচ্চ {chars} অক্ষর{colors}) — লেখাটি চেকআউটে দিতে হবে।",
  podColorsPart: ", রঙও বেছে নেওয়া যাবে",
  podFeePart: " প্রিন্ট ফি প্রতি আইটেমে {fee} টাকা, অর্ডারের মোটে যোগ হবে।",
  weightedTitle: "ওজন অনুযায়ী দাম — প্যাকের ভগ্নাংশেও কেনা যায় (ওজনের ধাপ অনুযায়ী)",
  weightedPackLabel: "প্যাক:",
  gramsUnit: "গ্রাম",
  weightedPerKg: "প্রতি কেজি",
  weightedPackPrice: "প্যাকের দাম",
  weightedRatePending: "(হার অনুযায়ী দাম হালনাগাদ বাকি — উপরে দেখানো দামই প্রযোজ্য)",
  noDescription: "এই পণ্যের বিবরণ এখনো যোগ করা হয়নি।",
  specsTitle: "স্পেসিফিকেশন",
  sizeChartNote:
    "এই ভ্যারিয়েন্টের প্যাক অনুযায়ী মাপের টেবিল থাকতে পারে — ভ্যারিয়েন্ট বেছে সাইজ চার্ট বোতামে দেখুন।",
  faqTitle: "সাধারণ জিজ্ঞাসা",
  bundleContentsTitle: "বান্ডলে যা যা আছে",
  componentFallback: "কম্পোনেন্ট পণ্য",
  componentsTotal: "উপাদানগুলোর মোট:",
  bundlePrice: "বান্ডল মূল্য:",
  bundleSavings: "সাশ্রয়",
  bundleOutOfStockNote:
    "আপাতত বান্ডলটি স্টকে নেই — কম্পোনেন্টগুলো আলাদাভাবে কিনতে উপরের লিংকগুলো দেখুন।",
  relatedProducts: "সম্পর্কিত পণ্য",
  standardLabel: "স্ট্যান্ডার্ড",
  trustRowDelivery: "দেশজুড়ে ডেলিভারি — ঢাকায় ২৪–৪৮ ঘণ্টা, বাইরে ২–৫ দিন",
  trustRowCod: "ক্যাশ অন ডেলিভারি — পণ্য হাতে পেয়ে মূল্য দিন",
  trustRowReturn: "সহজ রিটার্ন — ত্রুটি থাকলে সহজ শর্তে ফেরত",
  trustRowCare: "যত্নে বাছাই — প্রতিটি পণ্য পরীক্ষা করে পাঠাই",

  // PDP — buy section
  noticeOutOfStock: "স্টকে আর নেই — কার্টে যোগ করা যায়নি।",
  noticeCapped: "কার্টে যোগ হয়েছে — স্টকে যা ছিল সব নেওয়া হয়েছে।",
  noticeAdded: "কার্টে যোগ হয়েছে ✓",
  savePill: "সাশ্রয় {amount} ({pct}%)",
  lowStockWarning: "মাত্র {count}টি বাকি — দ্রুত অর্ডার করুন",
  quantityLabel: "পরিমাণ",
  weightApprox: "≈ {grams} গ্রাম (প্রতি ধাপ {step} গ্রাম)",

  // PDP — actions
  whatsappOrder: "WhatsApp-এ অর্ডার করুন",
  callForOrder: "কল করে অর্ডার করুন",
  waMessage: "আমি এই পণ্যটি কিনতে চাই: {title}",

  // PDP — gallery
  galleryAria: "পণ্যের ছবি বেছে নিন",
  viewImageAria: "ছবি {n} দেখুন",
  prevImage: "আগের ছবি",
  nextImage: "পরের ছবি",

  // PDP — tabs
  productInfoAria: "পণ্যের তথ্য",
  tabDescription: "বিবরণ",
  tabReviews: "ক্রেতাদের রিভিউ",

  // Product card
  offBadge: "-{pct}% ছাড়",
  wishlistAddAria: "{title} উইশলিস্টে রাখুন",
  wishlistRemoveAria: "{title} উইশলিস্ট থেকে সরান",
  addedShort: "যোগ হয়েছে ✓",

  // Shop chrome
  priceUnder500: "৫০০ টাকার কম",
  price500to1000: "৫০০ – ১,০০০ টাকা",
  price1000to3000: "১,০০০ – ৩,০০০ টাকা",
  priceOver3000: "৩,০০০ টাকার বেশি",
  sortPopularity: "জনপ্রিয়তা",
  sortNewest: "নতুন আগে",
  sortPriceAsc: "দাম: কম থেকে বেশি",
  sortPriceDesc: "দাম: বেশি থেকে কম",
  sortRating: "রেটিং",
  allRatings: "সব রেটিং",
  rating4Up: "৪★ ও উপরে",
  rating3Up: "৩★ ও উপরে",
  filterByCategory: "ক্যাটাগরি দিয়ে ফিল্টার",
  priceRangeTitle: "দামের পরিসর",
  brandsTitle: "ব্র্যান্ড",
  ratingAvailabilityTitle: "রেটিং ও স্টক অবস্থা",
  allPrices: "সব দাম",
  allBrands: "সব ব্র্যান্ড",
  allProductsAvail: "সব পণ্য",
  inStockOnlyLabel: "শুধু স্টকে আছে",
  productsLoading: "পণ্য লোড হচ্ছে…",
  showingProducts: "মোট {total}টি পণ্যের মধ্যে {total}টি দেখানো হচ্ছে",
  filtersAppliedSuffix: " — ফিল্টার প্রয়োগ করা হয়েছে",
  activeFiltersCount: "{count}টি ফিল্টার সক্রিয়",
  sortByLabel: "সাজান:",
  removeFilterAria: "{label} ফিল্টার সরান",
  clearAllFilters: "সব ফিল্টার মুছুন",
};

export type NeelStrings = { [K in keyof typeof bn]: string };

const en: NeelStrings = {
  // Header
  stripDelivery: "Home delivery nationwide — order from home",
  aboutUs: "About Us",
  trackOrder: "Track Order",
  signIn: "Sign In",
  register: "Register",
  help: "Help",
  quickLinksAria: "Quick links",
  searchPlaceholder: "Search products… e.g. saree, mobile, shoes",
  searchAria: "Search products",
  searchSubmitAria: "Search",
  wishlistLabel: "Wishlist",
  wishlistAria: "Wishlist",
  wishlistAriaCount: "Wishlist, {count} items",
  compareLabel: "Compare",
  compareAria: "View compare",
  cartLabel: "Cart",
  cartAria: "Cart — open drawer",
  cartAriaCount: "Cart, {count} items — open drawer",

  // Footer
  footerIntro:
    "Your favourite products, from home — thousands of products in one place, clear prices and careful delivery across the country.",
  footerTrackOrder: "Track Order",
  footerContact: "Contact Us",
  footerColInformation: "Information",
  footerColShopBy: "Shop By",
  footerColSupport: "Support",
  footerColPolicy: "Consumer Policy",
  paymentLabel: "Payment:",
  deliveryPartnerLabel: "Delivery partners:",
  rightsReserved: "All rights reserved.",
  contactPrompt: "See here for contact details",
  poweredBy: "Powered by Advance Ecommerce",

  // Cart drawer
  yourCart: "Your Cart",
  cartTotalCount: "Total ({count} items)",
  deliveryNote: "Delivery charge will be calculated at checkout.",
  checkoutLabel: "Checkout",
  goToCartPage: "Go to cart page",
  emptyCartTitle: "Your cart is empty",
  emptyCartText: "Pick your favourite products and add them to the cart — then order in one click.",
  browseProducts: "Browse products",
  removeItemAria: "Remove {name}",
  decreaseQty: "Decrease quantity",
  increaseQty: "Increase quantity",
  seeMore: "See more",
  addLabel: "Add",

  // Shared commerce words
  inStock: "In Stock",
  outOfStock: "Out of Stock",
  outOfStockSuffix: " (Out of Stock)",
  priceOnRequest: "Contact us for the price",
  addToCartLabel: "Add To Cart",
  buyNowLabel: "Buy Now",
  breadcrumbAria: "Breadcrumb",
  crumbHome: "Home",
  crumbShop: "Shop",
  itemsCount: "{count} products",

  // Home — category circles
  categoriesAria: "Categories",
  shopByCategory: "Shop by Category",
  prevCategories: "Previous categories",
  nextCategories: "Next categories",

  // Home — hero
  heroStaticHeadline: "Everything you need, under one roof",
  heroStaticSubtext:
    "Fashion, electronics, home essentials — at clear prices, with delivery nationwide.",
  viewAllProductsBtn: "View all products",
  categoryTileMeta: "{count} products — view →",
  allCategories: "All Categories",
  allCategoriesSub: "See all the shop's products together →",
  highlightAria: "Highlights",
  bannerPickerAria: "Choose a banner",
  bannerAria: "Banner {n}",

  // Home — sections / trust strip
  trustCodTitle: "Cash on Delivery",
  trustCodText: "Pay when the product is in your hand",
  trustDeliveryTitle: "Nationwide Delivery",
  trustDeliveryText: "Home delivery to districts and upazilas",
  trustTrackingTitle: "Order Tracking",
  trustTrackingText: "Check your order status anytime",
  trustReturnTitle: "Easy Returns",
  trustReturnText: "Simple returns if there is a problem",
  viewAllLink: "View all →",
  benefitsAria: "Our benefits",
  pickedForYou: "Picked for you",
  loadMore: "LOAD MORE",

  // Home — testimonials
  testimonialsAria: "Customer experiences",
  testimonialsHeading: "What customers say",
  productPrefix: "Product:",

  // Home — featured rail
  featuredProducts: "Featured Products",
  prevProducts: "Previous products",
  nextProducts: "Next products",

  // PDP — composition
  preorderBadge: "Pre-order open",
  reviewsCount: "{count} reviews",
  brandLabel: "Brand:",
  priceRangeLabel: "Price range:",
  maxDiscount: "Up to {pct}% off",
  digitalTitle: "Digital product — file delivery",
  digitalText:
    "Once payment is complete, the download link will arrive in your account — no shipping charge.",
  preorderTermsTitle: "Pre-order terms",
  preorderDelivery: "Expected delivery: {date}",
  preorderDeposit:
    "An advance of {pct}% is required to confirm the booking — the rest is paid on delivery.",
  preorderMaxUnits: "Limited pre-order: up to {count} units",
  bundleUnavailableAlert:
    "One component of this bundle is out of stock — the bundle cannot be bought right now.",
  priceOnRequestText:
    "This product's price is confirmed at order time. Call to order, or send a message from the contact page.",
  contactUsBtn: "Contact Us",
  preorderCta: "Pre-order",
  preorderBuyNow: "Pre-order Now",
  bundleUnavailableLabel: "Bundle out of stock",
  podTitle: "Custom print product",
  podText:
    "Your own text can be printed on this product (up to {chars} characters{colors}) — the text is provided at checkout.",
  podColorsPart: ", colours can also be chosen",
  podFeePart: " Print fee is {fee} taka per item, added to the order total.",
  weightedTitle: "Priced by weight — buy fractions of a pack too (by weight step)",
  weightedPackLabel: "Pack:",
  gramsUnit: "grams",
  weightedPerKg: "per kg",
  weightedPackPrice: "pack price",
  weightedRatePending: "(Price update by rate pending — the price shown above applies)",
  noDescription: "No description has been added for this product yet.",
  specsTitle: "Specifications",
  sizeChartNote:
    "This variant may have a pack-wise size table — choose a variant and check the size chart button.",
  faqTitle: "Frequently Asked Questions",
  bundleContentsTitle: "What's in the bundle",
  componentFallback: "Component product",
  componentsTotal: "Components total:",
  bundlePrice: "Bundle price:",
  bundleSavings: "Save",
  bundleOutOfStockNote:
    "The bundle is out of stock for now — see the links above to buy the components separately.",
  relatedProducts: "Related Products",
  standardLabel: "Standard",
  trustRowDelivery: "Nationwide delivery — 24–48 hours in Dhaka, 2–5 days outside",
  trustRowCod: "Cash on delivery — pay when the product is in your hand",
  trustRowReturn: "Easy returns — simple terms if there is a defect",
  trustRowCare: "Carefully checked — every product is inspected before dispatch",

  // PDP — buy section
  noticeOutOfStock: "Out of stock — could not be added to the cart.",
  noticeCapped: "Added to cart — all available stock was taken.",
  noticeAdded: "Added to cart ✓",
  savePill: "Save {amount} ({pct}%)",
  lowStockWarning: "Only {count} left — order fast",
  quantityLabel: "Quantity",
  weightApprox: "≈ {grams} grams ({step} grams per step)",

  // PDP — actions
  whatsappOrder: "Order On WhatsApp",
  callForOrder: "Call For Order",
  waMessage: "I want to buy this product: {title}",

  // PDP — gallery
  galleryAria: "Choose a product image",
  viewImageAria: "View image {n}",
  prevImage: "Previous image",
  nextImage: "Next image",

  // PDP — tabs
  productInfoAria: "Product information",
  tabDescription: "Description",
  tabReviews: "Customer Reviews",

  // Product card
  offBadge: "-{pct}% off",
  wishlistAddAria: "Add {title} to wishlist",
  wishlistRemoveAria: "Remove {title} from wishlist",
  addedShort: "Added ✓",

  // Shop chrome
  priceUnder500: "Under ৳500",
  price500to1000: "৳500 – ৳1,000",
  price1000to3000: "৳1,000 – ৳3,000",
  priceOver3000: "Over ৳3,000",
  sortPopularity: "Popularity",
  sortNewest: "Newest first",
  sortPriceAsc: "Price: Low to High",
  sortPriceDesc: "Price: High to Low",
  sortRating: "Rating",
  allRatings: "All ratings",
  rating4Up: "4★ & up",
  rating3Up: "3★ & up",
  filterByCategory: "Filter by Category",
  priceRangeTitle: "Price Range",
  brandsTitle: "Brands",
  ratingAvailabilityTitle: "Rating & Availability",
  allPrices: "All prices",
  allBrands: "All brands",
  allProductsAvail: "All products",
  inStockOnlyLabel: "In stock only",
  productsLoading: "Loading products…",
  showingProducts: "Showing {total} of {total} products",
  filtersAppliedSuffix: " — filters applied",
  activeFiltersCount: "{count} filters active",
  sortByLabel: "Sort By:",
  removeFilterAria: "Remove {label} filter",
  clearAllFilters: "Clear all filters",
};

export const NEEL_STRINGS: Record<Locale, NeelStrings> = { bn, en };
