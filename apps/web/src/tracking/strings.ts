/**
 * Tracking UI strings — doc 30 unified language system, slice L3d.
 *
 * Only the user-visible chrome of src/tracking lives here (the consent
 * banner). Tracking LOGIC files carry no UI strings and are untouched.
 * Shape follows the core contract: `bn` written once (NOT `as const`),
 * `en` typed with the mapped type so key parity is compile-checked.
 */
import type { Locale } from "@/i18n/locale";

const bn = {
  consentAriaLabel: "ট্র্যাকিং সম্মতি",
  consentTitle: "আপনার গোপনীয়তা",
  consentBodyBeforeLink:
    "আপনার কেনাকাটার অভিজ্ঞতা ভালো করতে এবং বিজ্ঞাপনের ফলাফল মাপতে আমরা কুকি ও ট্র্যাকিং ব্যবহার করতে চাই। সম্মতি দিলে কেবল হ্যাশ করা তথ্য পাঠানো হয় — আপনার ফোন নম্বর বা ইমেইল কখনো সরাসরি পাঠানো হয় না। বিস্তারিত জানতে",
  consentPrivacyLink: "গোপনীয়তা নীতি",
  consentBodyAfterLink: "দেখুন।",
  consentDeny: "না, ধন্যবাদ",
  consentGrant: "সম্মতি দিচ্ছি",
};

export type TrackingStrings = { [K in keyof typeof bn]: string };

const en: TrackingStrings = {
  consentAriaLabel: "Tracking consent",
  consentTitle: "Your privacy",
  consentBodyBeforeLink:
    "We would like to use cookies and tracking to improve your shopping experience and measure advertising results. If you consent, only hashed data is sent — your phone number or email is never sent directly. To learn more, see our",
  consentPrivacyLink: "Privacy Policy",
  consentBodyAfterLink: "",
  consentDeny: "No, thanks",
  consentGrant: "I consent",
};

export const TRACKING_STRINGS: Record<Locale, TrackingStrings> = { bn, en };
