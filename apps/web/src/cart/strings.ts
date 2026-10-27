/**
 * Unified language system (doc 30) — CART slice dictionary.
 *
 * Slice-local strings for src/cart/** and the /cart pages. Shared words
 * (addToCart, buyNow, checkout, subtotal, quantity, outOfStock …) live
 * in src/i18n/dictionaries.ts COMMON_STRINGS and are reused, NOT
 * duplicated here. This file follows the doc-30 pattern: the `bn`
 * object is written first, `en` is typed as the mapped CartStrings
 * type — a missing or extra key in either locale fails compilation.
 *
 * Usage: client components `pick(locale, CART_STRINGS)` via
 * useLocale(); server components `pick(await getRequestLocale(), …)`.
 */
import { pick, type Locale } from "@/i18n/locale";

const bn = {
  // AddToCartButton / BuyBoxActions
  addedToCart: "কার্টে যোগ হয়েছে ✓",
  allStockAddedNotice: "স্টকে যা ছিল সব কার্টে যোগ হয়েছে।",
  chooseVariant: "ভেরিয়েন্ট বেছে নিন:",
  variant: "ভেরিয়েন্ট",
  standardVariant: "স্ট্যান্ডার্ড",
  stockWithCount: "স্টক: {count}",
  onlyLeft: "মাত্র {count}টি বাকি",
  decreaseQuantity: "পরিমাণ কমান",
  increaseQuantity: "পরিমাণ বাড়ান",
  gramsUnit: "গ্রাম",
  outOfStockNotice: "স্টকে আর নেই — কার্টে যোগ করা যায়নি।",
  addedCappedNotice: "কার্টে যোগ হয়েছে — স্টকে যা ছিল সব নেওয়া হয়েছে।",

  // Cart page
  yourCart: "আপনার কার্ট",
  cartLoading: "কার্ট লোড হচ্ছে…",
  catalogNote:
    "পণ্যের তথ্য আসল ক্যাটালগ (ডাটাবেস) থেকে আসে; কার্ট এই ব্রাউজারেই সংরক্ষিত থাকে।",
  cartEmpty: "আপনার কার্ট খালি",
  cartEmptyHint: "পছন্দের পণ্য কার্টে যোগ করলেই এখানে দেখা যাবে।",
  startShopping: "কেনাকাটা শুরু করুন",
  continueShopping: "কেনাকাটা চালিয়ে যান",
  backToShopping: "← আরও কেনাকাটা করুন",
  itemRemovedNotice: "পণ্যটি কার্ট থেকে সরানো হয়েছে।",
  alreadyInWishlistNotice:
    "পণ্যটি আগেই উইশলিস্টে ছিল — কার্ট থেকে সরানো হয়েছে।",
  savedToWishlistNotice: "পণ্যটি উইশলিস্টে রাখা হয়েছে।",
  couponSavedMessage:
    "কুপন {code} সংরক্ষণ করা হয়েছে — চেকআউটে সার্ভার যাচাই করে ছাড় প্রয়োগ করবে।",
  weightedPack: "ওজন প্যাক: {grams} গ্রাম · প্রতি কেজি",
  packPrice: "প্যাকের দাম",
  packPricePending: "(হার অনুযায়ী দাম হালনাগাদ বাকি)",
  allStockTaken: "স্টকে যা আছে সব নেওয়া হয়েছে",
  saveForLater: "পরে কেনার জন্য রাখুন",
  removeItem: "সরিয়ে দিন",
  clearCart: "কার্ট খালি করুন",
  orderSummary: "হিসাবের সারাংশ",
  deliveryArea: "ডেলিভারি এলাকা",
  couponSavedPrefix: "কুপন",
  couponSavedSuffix: "সংরক্ষিত — চেকআউটে যাচাই হবে",
  couponCode: "কুপন কোড",
  couponCodePlaceholder: "কুপন কোড লিখুন",
  applyCoupon: "প্রয়োগ করুন",
  couponNote:
    "কুপন চেকআউটে সার্ভার যাচাই করবে — সঠিক কুপন হলে ছাড় অর্ডারের মোটে প্রয়োগ হবে।",
  itemDiscount: "পণ্যের ছাড়",
  codFee: "ক্যাশ অন ডেলিভারি ফি",
  vatTax: "ভ্যাট/ট্যাক্স",
  grandTotal: "সর্বমোট",
  previewNote: "এটি প্রিভিউ হিসাব — চেকআউটে দাম ও স্টক আবার যাচাই হবে।",
  proceedToCheckout: "চেকআউট করুন",
  shareCart: "কার্ট শেয়ার করুন",
  shareCreating: "লিংক তৈরি হচ্ছে…",
  shareFailed: "শেয়ার লিংক তৈরি করা যায়নি।",
  shareServerError: "সার্ভারের সঙ্গে যোগাযোগ করা যায়নি।",
  linkCopied: "লিংক কপি হয়েছে — ৭ দিন মেয়াদ থাকবে।",
  copyFailed: "কপি করা যায়নি — লিংকটি হাতে কপি করুন।",
  copyLink: "কপি করুন",
  totalWithDelivery: "সর্বমোট ({zone} ডেলিভারিসহ)",

  // Page metadata (/cart + /cart/shared)
  cartMetaTitle: "আপনার কার্ট — Advance Ecommerce",
  cartMetaDescription:
    "আপনার কার্টের পণ্য, কুপন ছাড় ও ডেলিভারি চার্জসহ মোট হিসাব দেখুন।",
  sharedCartMetaTitle: "শেয়ার করা কার্ট — Advance Ecommerce",
  sharedCartMetaDescription:
    "শেয়ার করা কার্টের পণ্যগুলো লাইভ দাম ও স্টকসহ দেখুন এবং নিজের কার্টে যোগ করুন।",
  shareErrorAria: "শেয়ার লিংকের ত্রুটি",
  shareErrorInvalidTitle: "লিংকটি সঠিক নয়",
  shareErrorInvalidBody:
    "এই শেয়ার লিংকটি যাচাই করা যায়নি — লিংকটি বদলানো হয়ে থাকতে পারে অথবা অসম্পূর্ণ কপি হয়েছে। যিনি পাঠিয়েছেন, তাঁর কাছ থেকে আবার লিংকটি নিন।",
  shareErrorExpiredTitle: "লিংকের মেয়াদ শেষ",
  shareErrorExpiredBody:
    "শেয়ার করা কার্টের লিংক ৭ দিন পর মেয়াদ উত্তীর্ণ হয়। এই লিংকটির মেয়াদ শেষ হয়ে গেছে — নতুন একটি লিংক চেয়ে নিন।",
  shareErrorNotConfiguredTitle: "শেয়ার সুবিধা এখন চালু নেই",
  shareErrorNotConfiguredBody:
    "এই সার্ভারে কার্ট শেয়ার যাচাইয়ের ব্যবস্থা এখনো চালু হয়নি, তাই লিংকটি খোলা যাচ্ছে না।",

  // Coupon rejection reasons (resolve.ts COUPON_REASON_* maps)
  couponReasonInactive: "কুপনটি এখন সক্রিয় নয়।",
  couponReasonNotStarted: "কুপনটি এখনো শুরু হয়নি।",
  couponReasonExpired: "কুপনের মেয়াদ শেষ হয়ে গেছে।",
  couponReasonMinCartNotMet: "এই কুপনের জন্য ন্যূনতম কার্ট মূল্য পূরণ হয়নি।",
  couponReasonUsageLimitReached: "কুপনের ব্যবহারের সীমা শেষ হয়ে গেছে।",
  couponReasonPerUserLimitReached: "আপনি এই কুপনের সীমা পর্যন্ত ব্যবহার করেছেন।",
  couponReasonNotFirstOrder: "এই কুপন শুধু প্রথম অর্ডারের জন্য।",
  couponReasonNotStackable: "এই কুপন অন্য কুপনের সাথে ব্যবহার করা যাবে না।",
  couponReasonNotFound: "কুপন কোডটি সঠিক নয়।",
};

export type CartStrings = { [K in keyof typeof bn]: string };

const en: CartStrings = {
  // AddToCartButton / BuyBoxActions
  addedToCart: "Added to cart ✓",
  allStockAddedNotice: "All available stock has been added to your cart.",
  chooseVariant: "Choose a variant:",
  variant: "Variant",
  standardVariant: "Standard",
  stockWithCount: "Stock: {count}",
  onlyLeft: "Only {count} left",
  decreaseQuantity: "Decrease quantity",
  increaseQuantity: "Increase quantity",
  gramsUnit: "grams",
  outOfStockNotice: "Out of stock — could not be added to the cart.",
  addedCappedNotice: "Added to cart — all available stock was taken.",

  // Cart page
  yourCart: "Your Cart",
  cartLoading: "Loading cart…",
  catalogNote:
    "Product information comes from the real catalog (database); your cart is stored in this browser only.",
  cartEmpty: "Your cart is empty",
  cartEmptyHint: "Products you add to your cart will appear here.",
  startShopping: "Start shopping",
  continueShopping: "Continue shopping",
  backToShopping: "← Continue shopping",
  itemRemovedNotice: "The item has been removed from your cart.",
  alreadyInWishlistNotice:
    "This item was already in your wishlist — it has been removed from the cart.",
  savedToWishlistNotice: "The item has been saved to your wishlist.",
  couponSavedMessage:
    "Coupon {code} saved — the server will verify it at checkout and apply the discount.",
  weightedPack: "Weight pack: {grams} g · per kg",
  packPrice: "Pack price",
  packPricePending: "(price update pending based on the rate)",
  allStockTaken: "All available stock taken",
  saveForLater: "Save for later",
  removeItem: "Remove",
  clearCart: "Clear cart",
  orderSummary: "Order summary",
  deliveryArea: "Delivery area",
  couponSavedPrefix: "Coupon",
  couponSavedSuffix: "saved — will be verified at checkout",
  couponCode: "Coupon code",
  couponCodePlaceholder: "Enter coupon code",
  applyCoupon: "Apply",
  couponNote:
    "The coupon will be verified by the server at checkout — if valid, the discount will be applied to your order total.",
  itemDiscount: "Item discount",
  codFee: "Cash on Delivery fee",
  vatTax: "VAT/Tax",
  grandTotal: "Grand total",
  previewNote:
    "This is a preview calculation — prices and stock will be verified again at checkout.",
  proceedToCheckout: "Checkout",
  shareCart: "Share cart",
  shareCreating: "Creating link…",
  shareFailed: "Could not create the share link.",
  shareServerError: "Could not reach the server.",
  linkCopied: "Link copied — valid for 7 days.",
  copyFailed: "Could not copy — please copy the link manually.",
  copyLink: "Copy",
  totalWithDelivery: "Grand total (incl. {zone} delivery)",

  // Page metadata (/cart + /cart/shared)
  cartMetaTitle: "Your Cart — Advance Ecommerce",
  cartMetaDescription:
    "View your cart items with coupon discounts and delivery charges in the total.",
  sharedCartMetaTitle: "Shared Cart — Advance Ecommerce",
  sharedCartMetaDescription:
    "View the items in the shared cart with live prices and stock, and add them to your own cart.",
  shareErrorAria: "Share link error",
  shareErrorInvalidTitle: "This link is not valid",
  shareErrorInvalidBody:
    "This share link could not be verified — it may have been altered or copied incompletely. Please ask the sender for the link again.",
  shareErrorExpiredTitle: "This link has expired",
  shareErrorExpiredBody:
    "Shared cart links expire after 7 days. This link has expired — please ask for a new one.",
  shareErrorNotConfiguredTitle: "Sharing is not enabled yet",
  shareErrorNotConfiguredBody:
    "Cart-share verification has not been enabled on this server yet, so the link cannot be opened.",

  // Coupon rejection reasons (resolve.ts COUPON_REASON_* maps)
  couponReasonInactive: "This coupon is not active right now.",
  couponReasonNotStarted: "This coupon has not started yet.",
  couponReasonExpired: "This coupon has expired.",
  couponReasonMinCartNotMet:
    "The minimum cart value for this coupon has not been met.",
  couponReasonUsageLimitReached: "This coupon's usage limit has been reached.",
  couponReasonPerUserLimitReached: "You have used this coupon up to its limit.",
  couponReasonNotFirstOrder: "This coupon is for first orders only.",
  couponReasonNotStackable: "This coupon cannot be combined with other coupons.",
  couponReasonNotFound: "This coupon code is not valid.",
};

export const CART_STRINGS: Record<Locale, CartStrings> = { bn, en };

/** The cart dictionary for one locale (thin wrapper over pick()). */
export function cartStrings(locale: Locale): CartStrings {
  return pick(locale, CART_STRINGS);
}
