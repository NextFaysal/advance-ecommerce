/**
 * Storefront UX (Part B) UI strings — doc 30 unified language system.
 *
 * Slice-local dictionary for the components in this folder (back-in-stock
 * form, compare tray, quick view, recently viewed, size guide, sticky buy
 * bar, order OTP panel). Shared words (cart, reviews, order now, …) come
 * from COMMON_STRINGS via useLocale().t; only Part B-specific copy lives
 * here. Templates use {name} placeholders via interpolate().
 *
 * Parity: `bn` is written plainly (never `as const`), `en` is typed as
 * the mapped UxStrings — a missing/extra key in either fails tsc.
 */
import type { Locale } from "@/i18n/locale";

const bn = {
  // Back-in-stock form
  bisTitle: "স্টক শেষ — এলে জানিয়ে দেব",
  bisSubtitle: "আপনার মোবাইল নম্বর দিন, পণ্যটি আবার স্টকে এলেই SMS পাবেন।",
  bisVariantLabel: "ভেরিয়েন্ট বাছুন",
  bisPhoneLabel: "মোবাইল নম্বর",
  bisNotifyMe: "জানিয়ে দিন",
  bisFootnote: "সাইনআপ ডাটাবেসে সংরক্ষিত থাকে; স্টক এলেই একবার SMS পাঠানো হবে।",
  bisInvalidPhone: "সঠিক মোবাইল নম্বর দিন (01XXXXXXXXX)।",
  bisDuplicate: "আপনি আগেই সাইন আপ করেছেন ({phone}) — স্টক এলেই একবার SMS পাবেন।",
  bisThanks: "ধন্যবাদ! {phone} নম্বরে স্টক এলেই SMS পাঠানো হবে।",
  bisNetworkError: "নেটওয়ার্ক ত্রুটি — আবার চেষ্টা করুন।",

  // Compare tray + toggle
  compareAdd: "তুলনা করুন",
  compareAdded: "✓ তুলনায় আছে",
  compareFull: "সর্বোচ্চ {max}টি পণ্য তুলনা করা যাবে — আগে একটি সরান।",
  compareDuplicate: "পণ্যটি ইতিমধ্যে তুলনায় আছে।",
  compareTrayLabel: "তুলনা ({count}/{max})",
  compareRemove: "তুলনা থেকে সরান",
  compareClearAll: "সব মুছুন",
  compareView: "তুলনা দেখুন",

  // Quick view (modal + rail button)
  quickView: "দ্রুত দেখুন",
  qvReviews: "({count} রিভিউ)",
  qvStock: "(স্টক: {stock})",
  qvSizeGuideNote: "এই পণ্যের জন্য সাইজ গাইড আছে — পণ্যের পেজে দেখুন।",
  qvViewDetails: "বিস্তারিত দেখুন",

  // Recently viewed rail
  rvTitle: "সম্প্রতি দেখেছেন",
  rvViewAll: "সব দেখুন →",

  // Price range suffix/prefix: "{price} থেকে" / "from {price}"
  priceFromTemplate: "{price} থেকে",

  // Size guide modal chrome (table data itself is bilingual in size-guide.ts)
  sgSize: "সাইজ",
  sgCm: "(সেমি)",
  sgHowToMeasure: "কীভাবে মাপবেন",

  // Order OTP panel
  otpVerified: "✓ ফোন যাচাই সম্পন্ন হয়েছে — ধন্যবাদ! আপনার অর্ডারটি এখন নিশ্চিতকরণের ধাপে এগিয়ে যাবে।",
  otpNotRequired: "এই অর্ডারের জন্য ফোন যাচাই (OTP) প্রয়োজন নেই।",
  otpAriaLabel: "ফোন যাচাই (OTP)",
  otpTitle: "ফোন যাচাই (OTP) প্রয়োজন",
  otpIntroBefore: "অর্ডারটি নিশ্চিত করতে ",
  otpIntroAfter: " নম্বরে পাঠানো ৬ সংখ্যার কোডটি দিন।",
  otpFirstSmsPending:
    " প্রথম কোডের SMS এখনো পাঠানো সম্পূর্ণ হয়নি — কোড না পেলে নিচের “আবার কোড পাঠান” বোতামটি ব্যবহার করুন।",
  otpCodeLabel: "৬ সংখ্যার কোড",
  otpCodeAria: "৬ সংখ্যার OTP কোড",
  otpVerifying: "যাচাই হচ্ছে…",
  otpVerify: "যাচাই করুন",
  otpAttemptsLeft: "আরও {count}বার ভুল কোড দেওয়ার সুযোগ বাকি আছে।",
  otpResendQueued: "নতুন কোড পাঠানো হয়েছে — ১০ মিনিটের মধ্যে কোডটি ব্যবহার করুন।",
  otpResendNoSms: "নতুন কোড তৈরি হয়েছে, তবে SMS এখন পাঠানো যায়নি — কিছুক্ষণ পরে আবার চেষ্টা করুন।",
  otpVerifyFailed: "যাচাই করা যায়নি। আবার চেষ্টা করুন।",
  otpSendFailed: "কোড পাঠানো যায়নি। আবার চেষ্টা করুন।",
  otpNetworkError: "নেটওয়ার্ক সমস্যা — সংযোগ যাচাই করে আবার চেষ্টা করুন।",
  otpSending: "কোড পাঠানো হচ্ছে…",
  otpResendWait: "আবার কোড পাঠাতে {seconds} সেকেন্ড অপেক্ষা করুন",
  otpResend: "আবার কোড পাঠান",
};

export type UxStrings = { [K in keyof typeof bn]: string };

const en: UxStrings = {
  bisTitle: "Out of stock — we'll let you know",
  bisSubtitle: "Leave your mobile number and we'll SMS you as soon as it's back in stock.",
  bisVariantLabel: "Choose a variant",
  bisPhoneLabel: "Mobile number",
  bisNotifyMe: "Notify me",
  bisFootnote: "Your signup is stored in our database; one SMS is sent when it's back in stock.",
  bisInvalidPhone: "Please enter a valid mobile number (01XXXXXXXXX).",
  bisDuplicate: "You're already signed up ({phone}) — you'll get one SMS when it's back in stock.",
  bisThanks: "Thanks! We'll SMS {phone} as soon as it's back in stock.",
  bisNetworkError: "Network error — please try again.",

  compareAdd: "Compare",
  compareAdded: "✓ In compare list",
  compareFull: "You can compare up to {max} products — remove one first.",
  compareDuplicate: "This product is already in the compare list.",
  compareTrayLabel: "Compare ({count}/{max})",
  compareRemove: "Remove from compare",
  compareClearAll: "Clear all",
  compareView: "View comparison",

  quickView: "Quick view",
  qvReviews: "({count} reviews)",
  qvStock: "(Stock: {stock})",
  qvSizeGuideNote: "This product has a size guide — see the product page.",
  qvViewDetails: "View details",

  rvTitle: "Recently viewed",
  rvViewAll: "View all →",

  priceFromTemplate: "from {price}",

  sgSize: "Size",
  sgCm: "(cm)",
  sgHowToMeasure: "How to measure",

  otpVerified: "✓ Phone verified — thank you! Your order will now move to the confirmation step.",
  otpNotRequired: "Phone verification (OTP) is not required for this order.",
  otpAriaLabel: "Phone verification (OTP)",
  otpTitle: "Phone verification (OTP) required",
  otpIntroBefore: "To confirm your order, enter the 6-digit code sent to ",
  otpIntroAfter: ".",
  otpFirstSmsPending:
    " The first code's SMS hasn't finished sending yet — if you don't receive it, use the “Resend code” button below.",
  otpCodeLabel: "6-digit code",
  otpCodeAria: "6-digit OTP code",
  otpVerifying: "Verifying…",
  otpVerify: "Verify",
  otpAttemptsLeft: "{count} more attempts left before the code locks.",
  otpResendQueued: "A new code has been sent — use it within 10 minutes.",
  otpResendNoSms: "A new code was created, but the SMS couldn't be sent right now — please try again shortly.",
  otpVerifyFailed: "Verification failed. Please try again.",
  otpSendFailed: "Couldn't send the code. Please try again.",
  otpNetworkError: "Network problem — check your connection and try again.",
  otpSending: "Sending code…",
  otpResendWait: "Wait {seconds} seconds to resend the code",
  otpResend: "Resend code",
};

export const UX_STRINGS: Record<Locale, UxStrings> = { bn, en };
