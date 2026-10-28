/**
 * Landing renderer dictionary (doc 34 L1, doc-30 completion at the
 * render layer).
 *
 * Every chrome string the PUBLIC landing components print — stock
 * labels, "view details", the countdown, and the whole QuickOrderForm
 * (labels, placeholders, totals, success panel, API error copy) —
 * lives here as bn+en pairs. Section CONTENT copy stays in the
 * section model itself (each section carries its own bn+en pair);
 * this module is only for the fixed UI text around it, which before
 * L1 was hardcoded Bangla literals inside LandingView /
 * QuickOrderForm / CountdownNote (audit gap #10).
 *
 * Shape follows the doc-30 contract: a `bn` object typed once, `en`
 * typed as the mapped LandingStrings — a missing/extra key in either
 * locale fails compilation, so the two can never drift. The bn values
 * are the pre-L1 literals VERBATIM (bn rendering is unchanged).
 *
 * Usage: `pick(locale, LANDING_STRINGS)` — server surfaces resolve
 * the locale via getRequestLocale and pass it down; the admin
 * builder passes its own useLocale() value to the preview.
 */
import type { Locale } from "@/i18n/locale";

const bn = {
  // LandingView chrome
  viewDetails: "পণ্যের বিস্তারিত দেখুন",
  offerUnavailable: "এই অফারের পণ্যটি এখন পাওয়া যাচ্ছে না।",
  defaultCta: "এখনই অর্ডার করুন",
  inStockCount: "স্টক আছে ({count}টি)",
  outOfStock: "স্টক শেষ",
  standardVariant: "স্ট্যান্ডার্ড",
  quickOrderIntro: "ফর্মটি পূরণ করুন — কোনো অ্যাকাউন্ট বা অগ্রিম পেমেন্ট লাগবে না।",
  // CountdownNote (product_offer countdown label)
  countdownExpired: "অফারের সময় শেষ হয়ে গেছে",
  countdownDays: "অফার শেষ হতে বাকি: {days} দিন {hours} ঘণ্টা",
  countdownHours: "অফার শেষ হতে বাকি: {hours} ঘণ্টা {minutes} মিনিট",
  countdownMinutes: "অফার শেষ হতে বাকি: {minutes} মিনিট",
  // QuickOrderForm chrome
  viewDetailsShort: "বিস্তারিত দেখুন",
  variantLegend: "ভেরিয়েন্ট বেছে নিন",
  quantityLabel: "পরিমাণ",
  qtyDecreaseAria: "পরিমাণ কমান",
  qtyIncreaseAria: "পরিমাণ বাড়ান",
  nameLabel: "আপনার নাম *",
  namePlaceholder: "যেমন: মোঃ রফিকুল ইসলাম",
  phoneLabel: "মোবাইল নম্বর *",
  zoneLabel: "ডেলিভারি এলাকা *",
  zoneInsideDhaka: "ঢাকার ভিতরে",
  zoneOutsideDhaka: "ঢাকার বাইরে",
  divisionLabel: "বিভাগ *",
  divisionPlaceholder: "ঢাকা",
  districtLabel: "জেলা *",
  districtPlaceholder: "ঢাকা",
  upazilaLabel: "উপজেলা / থানা *",
  upazilaPlaceholder: "মিরপুর",
  unionLabel: "ইউনিয়ন (যদি থাকে)",
  unionPlaceholder: "ঐচ্ছিক",
  addressLabel: "সম্পূর্ণ ঠিকানা *",
  addressPlaceholder: "বাসা/হোল্ডিং, রোড, এলাকা — যেমন: বাসা ১২, রোড ৫, মিরপুর ১০",
  subtotalLabel: "পণ্যের মূল্য",
  deliveryNote: "ডেলিভারি চার্জ ঠিকানা অনুযায়ী অর্ডারের মোটে যোগ হবে। পেমেন্ট: ক্যাশ অন ডেলিভারি — পণ্য হাতে পেয়ে টাকা দিন।",
  submitBusy: "অর্ডার করা হচ্ছে…",
  submitLabel: "অর্ডার করুন — ক্যাশ অন ডেলিভারি",
  successTitle: "অর্ডার সম্পন্ন হয়েছে!",
  successOrderNo: "অর্ডার নম্বর",
  successTotalLabel: "মোট",
  successTotalSuffix: "(ডেলিভারি চার্জসহ)",
  successConfirmNote: "আমাদের টিম শীঘ্রই ফোন করে অর্ডারটি নিশ্চিত করবে। পণ্য হাতে পেয়ে যাচাই করে তারপর টাকা পরিশোধ করুন।",
  trackOrderCta: "অর্ডার ট্র্যাক করুন",
  // QuickOrderForm — order API failure copy (was ERROR_BN)
  errorValidation: "কিছু তথ্য ঠিকমতো দেওয়া হয়নি — ঘরগুলো আবার দেখে চেষ্টা করুন।",
  errorInsufficientStock: "দুঃখিত, এই মুহূর্তে পর্যাপ্ত স্টক নেই। সংখ্যা কমিয়ে আবার চেষ্টা করুন।",
  errorVariantNotFound: "দুঃখিত, এই পণ্যটি এখন পাওয়া যাচ্ছে না।",
  errorIdempotencyConflict: "এই অর্ডারটি ইতিমধ্যে গৃহীত হয়েছে। পেজটি রিফ্রেশ করে আবার চেষ্টা করুন।",
  errorGeneric: "কিছু সমস্যা হয়েছে — আবার চেষ্টা করুন।",
  errorNetwork: "নেটওয়ার্ক সমস্যা — আবার চেষ্টা করুন।",
};

export type LandingStrings = { [K in keyof typeof bn]: string };

const en: LandingStrings = {
  viewDetails: "View product details",
  offerUnavailable: "This offer's product is not available right now.",
  defaultCta: "Order Now",
  inStockCount: "In stock ({count} available)",
  outOfStock: "Out of stock",
  standardVariant: "Standard",
  quickOrderIntro: "Fill in the form — no account or advance payment needed.",
  countdownExpired: "This offer has ended",
  countdownDays: "Offer ends in: {days}d {hours}h",
  countdownHours: "Offer ends in: {hours}h {minutes}m",
  countdownMinutes: "Offer ends in: {minutes}m",
  viewDetailsShort: "View details",
  variantLegend: "Choose a variant",
  quantityLabel: "Quantity",
  qtyDecreaseAria: "Decrease quantity",
  qtyIncreaseAria: "Increase quantity",
  nameLabel: "Your name *",
  namePlaceholder: "e.g. Md. Rafiqul Islam",
  phoneLabel: "Mobile number *",
  zoneLabel: "Delivery area *",
  zoneInsideDhaka: "Inside Dhaka",
  zoneOutsideDhaka: "Outside Dhaka",
  divisionLabel: "Division *",
  divisionPlaceholder: "Dhaka",
  districtLabel: "District *",
  districtPlaceholder: "Dhaka",
  upazilaLabel: "Upazila / Thana *",
  upazilaPlaceholder: "Mirpur",
  unionLabel: "Union (if any)",
  unionPlaceholder: "Optional",
  addressLabel: "Full address *",
  addressPlaceholder: "House/holding, road, area — e.g. House 12, Road 5, Mirpur 10",
  subtotalLabel: "Product price",
  deliveryNote: "The delivery charge is added to the order total based on your address. Payment: Cash on Delivery — pay when the product is in your hand.",
  submitBusy: "Placing order…",
  submitLabel: "Place Order — Cash on Delivery",
  successTitle: "Order placed successfully!",
  successOrderNo: "Order number",
  successTotalLabel: "Total",
  successTotalSuffix: "(including delivery charge)",
  successConfirmNote: "Our team will call shortly to confirm your order. Check the product in hand, then pay.",
  trackOrderCta: "Track your order",
  errorValidation: "Some information was not entered correctly — please check the fields and try again.",
  errorInsufficientStock: "Sorry, there is not enough stock right now. Please reduce the quantity and try again.",
  errorVariantNotFound: "Sorry, this product is not available right now.",
  errorIdempotencyConflict: "This order has already been received. Please refresh the page and try again.",
  errorGeneric: "Something went wrong — please try again.",
  errorNetwork: "Network problem — please try again.",
};

export const LANDING_STRINGS: Record<Locale, LandingStrings> = { bn, en };
