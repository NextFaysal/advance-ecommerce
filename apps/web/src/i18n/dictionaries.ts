/**
 * Unified language system (doc 30) — SHARED UI dictionary.
 *
 * Common words every surface needs (navigation, cart, account, generic
 * actions and states). Domain surfaces keep their own dictionaries next
 * to their code, but they ALL follow this shape: a `bn` object typed
 * once, and `en` typed as `typeof bn` — TypeScript then refuses to
 * compile a dictionary whose key sets differ, which is how "one locale
 * is missing half the strings" (the old mix problem) becomes impossible.
 *
 * Usage: `const t = pick(locale, COMMON_STRINGS)` in server components,
 * or `const { t } = useLocale()` (t = the common dict for the active
 * locale) in client components.
 */
import type { Locale } from "./locale";

const bn = {
  // Brand / navigation
  home: "হোম",
  shop: "শপ",
  categories: "ক্যাটাগরি",
  allProducts: "সব পণ্য",
  search: "খুঁজুন",
  searchPlaceholder: "পণ্য খুঁজুন…",
  cart: "কার্ট",
  wishlist: "উইশলিস্ট",
  compare: "তুলনা",
  account: "অ্যাকাউন্ট",
  myAccount: "আমার অ্যাকাউন্ট",
  login: "লগইন",
  register: "রেজিস্টার",
  logout: "লগআউট",
  trackOrder: "অর্ডার ট্র্যাক করুন",
  offers: "অফার",
  menu: "মেনু",
  close: "বন্ধ করুন",
  language: "ভাষা",

  // Commerce
  addToCart: "কার্টে যোগ করুন",
  buyNow: "এখনই কিনুন",
  checkout: "চেকআউট",
  price: "দাম",
  total: "মোট",
  subtotal: "সাবটোটাল",
  deliveryCharge: "ডেলিভারি চার্জ",
  discount: "ছাড়",
  free: "ফ্রি",
  inStock: "স্টকে আছে",
  outOfStock: "স্টক শেষ",
  quantity: "পরিমাণ",
  orderNow: "অর্ডার করুন",
  viewAll: "সব দেখুন",
  details: "বিস্তারিত",
  reviews: "রিভিউ",

  // Generic actions / states
  save: "সেভ করুন",
  saving: "সেভ হচ্ছে…",
  cancel: "বাতিল",
  delete: "মুছে ফেলুন",
  edit: "সম্পাদনা",
  add: "যোগ করুন",
  back: "পেছনে",
  next: "পরবর্তী",
  previous: "আগের",
  submit: "জমা দিন",
  loading: "লোড হচ্ছে…",
  noResults: "কিছু পাওয়া যায়নি",
  yes: "হ্যাঁ",
  no: "না",
  status: "অবস্থা",
  actions: "অ্যাকশন",
  name: "নাম",
  phone: "ফোন",
  email: "ইমেইল",
  address: "ঠিকানা",
  date: "তারিখ",
  all: "সব",

  // Utility pages (404 / offline) — doc 32 P7: this copy used to be
  // hardcoded Bangla in app/not-found.tsx and app/offline/*; the bn
  // values below are those originals verbatim, en is the translation.
  notFoundTitle: "পেজটি পাওয়া যায়নি",
  notFoundBody:
    "আপনি যে পেজটি খুঁজছেন তা সরে গেছে অথবা লিংকটি ভুল। দোকান থেকে আবার শুরু করুন — পছন্দের পণ্য অপেক্ষা করছে।",
  notFoundShopCta: "দোকানে যান",
  notFoundHomeCta: "হোমপেজ",
  notFoundCategoriesLabel: "জনপ্রিয় ক্যাটাগরি",
  notFoundShortcutsLabel: "দরকারি লিংক",
  offlineMetaTitle: "অফলাইন — Advance Ecommerce",
  offlineMetaDescription: "ইন্টারনেট সংযোগ নেই। সংযোগ ফিরে এলে আবার চেষ্টা করুন।",
  offlineTitle: "ইন্টারনেট সংযোগ নেই",
  offlineBody:
    "আপনি এখন অফলাইনে আছেন। আগে দেখা পেজগুলো ক্যাশ থেকে খুলতে পারে, কিন্তু নতুন অর্ডার, পেমেন্ট বা স্টক আপডেটের জন্য ইন্টারনেট লাগবে। সংযোগ ফিরে এলে আবার চেষ্টা করুন।",
  offlineRetry: "আবার চেষ্টা করুন",
  offlineHomeCta: "হোমপেজে যান",
  offlineFootnote:
    "আপনার কার্টের পণ্য এই ডিভাইসেই সংরক্ষিত আছে — সংযোগ ফিরলে সেখান থেকেই কেনাকাটা চালিয়ে যেতে পারবেন।",

  // Footer
  aboutUs: "আমাদের সম্পর্কে",
  contactUs: "যোগাযোগ",
  privacyPolicy: "গোপনীয়তা নীতি",
  terms: "শর্তাবলি",
  refundPolicy: "রিফান্ড নীতি",
  shippingPolicy: "শিপিং নীতি",
  faq: "সাধারণ জিজ্ঞাসা",
  customerService: "কাস্টমার সার্ভিস",
  quickLinks: "দ্রুত লিংক",
  allRightsReserved: "সর্বস্বত্ব সংরক্ষিত",
};

/**
 * Same KEYS as bn, values are plain strings (NOT bn's literal types —
 * `as const` on bn would make every value a unique literal type and no
 * English string could ever satisfy it). Missing/extra keys in `en`
 * still fail to compile, which is the parity guarantee we actually want.
 */
export type CommonStrings = { [K in keyof typeof bn]: string };

const en: CommonStrings = {
  home: "Home",
  shop: "Shop",
  categories: "Categories",
  allProducts: "All Products",
  search: "Search",
  searchPlaceholder: "Search products…",
  cart: "Cart",
  wishlist: "Wishlist",
  compare: "Compare",
  account: "Account",
  myAccount: "My Account",
  login: "Login",
  register: "Register",
  logout: "Logout",
  trackOrder: "Track Order",
  offers: "Offers",
  menu: "Menu",
  close: "Close",
  language: "Language",

  addToCart: "Add to Cart",
  buyNow: "Buy Now",
  checkout: "Checkout",
  price: "Price",
  total: "Total",
  subtotal: "Subtotal",
  deliveryCharge: "Delivery Charge",
  discount: "Discount",
  free: "Free",
  inStock: "In Stock",
  outOfStock: "Out of Stock",
  quantity: "Quantity",
  orderNow: "Order Now",
  viewAll: "View All",
  details: "Details",
  reviews: "Reviews",

  save: "Save",
  saving: "Saving…",
  cancel: "Cancel",
  delete: "Delete",
  edit: "Edit",
  add: "Add",
  back: "Back",
  next: "Next",
  previous: "Previous",
  submit: "Submit",
  loading: "Loading…",
  noResults: "Nothing found",
  yes: "Yes",
  no: "No",
  status: "Status",
  actions: "Actions",
  name: "Name",
  phone: "Phone",
  email: "Email",
  address: "Address",
  date: "Date",
  all: "All",

  notFoundTitle: "Page not found",
  notFoundBody:
    "The page you're looking for has moved or the link is wrong. Start again from the shop — your favourite products are waiting.",
  notFoundShopCta: "Go to Shop",
  notFoundHomeCta: "Homepage",
  notFoundCategoriesLabel: "Popular categories",
  notFoundShortcutsLabel: "Useful links",
  offlineMetaTitle: "Offline — Advance Ecommerce",
  offlineMetaDescription: "No internet connection. Please try again when you're back online.",
  offlineTitle: "No internet connection",
  offlineBody:
    "You're offline right now. Pages you've already visited may open from cache, but new orders, payments and stock updates need an internet connection. Please try again when you're back online.",
  offlineRetry: "Try again",
  offlineHomeCta: "Go to homepage",
  offlineFootnote:
    "The items in your cart are saved on this device — when the connection returns, you can pick up shopping right where you left off.",

  aboutUs: "About Us",
  contactUs: "Contact",
  privacyPolicy: "Privacy Policy",
  terms: "Terms & Conditions",
  refundPolicy: "Refund Policy",
  shippingPolicy: "Shipping Policy",
  faq: "FAQ",
  customerService: "Customer Service",
  quickLinks: "Quick Links",
  allRightsReserved: "All rights reserved",
};

export const COMMON_STRINGS: Record<Locale, CommonStrings> = { bn, en };
