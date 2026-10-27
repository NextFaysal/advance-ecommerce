/**
 * Admin security page — UI dictionary (doc 30 unified language system).
 * bn typed once, en typed as the mapped type — parity is compile-checked.
 * The security-* cards in src/components/admin keep their strings in
 * ADMIN_STRINGS (slice L4); only this page + the TOTP card live here.
 */
import type { Locale } from "@/i18n/locale";

const bn = {
  title: "নিরাপত্তা",
  loginRequiredDesc: "আপনার অ্যাকাউন্টের দুই-ধাপ যাচাই (2FA)",
  loginRequired: "এই পেজ দেখতে আগে লগইন করুন।",
  description:
    "আপনার নিজের অ্যাকাউন্টের দুই-ধাপ যাচাই (TOTP 2FA) — অন্য কারো 2FA এখান থেকে বদলানো যায় না। নিচে IP নিয়ম, নিরাপত্তা সতর্কতা ও সক্রিয় স্টাফ সেশন।",
  breadcrumb: "Admin / System",
  // ---- TOTP enrol card ----
  totpTitle: "দুই-ধাপ যাচাই (TOTP 2FA)",
  totpOn: "চালু আছে",
  totpPending: "সেটআপ অসম্পূর্ণ",
  totpOff: "বন্ধ আছে",
  totpAccountPrefix: "অ্যাকাউন্ট",
  totpIntro:
    "। Google Authenticator / Microsoft Authenticator-এর মতো অ্যাপ দিয়ে লগইনের সময় ৬ সংখ্যার কোড লাগবে — পাসওয়ার্ড ফাঁস হলেও অ্যাকাউন্ট সুরক্ষিত থাকবে।",
  totpSetupFailed: "সেটআপ শুরু করা যায়নি — আবার চেষ্টা করুন।",
  totpNetworkError: "সার্ভারে পৌঁছানো যাচ্ছে না — নেটওয়ার্ক দেখে আবার চেষ্টা করুন।",
  totpCodePrompt: "অথেনটিকেটর অ্যাপের ৬ সংখ্যার কোডটি লিখুন।",
  totpCodeMismatch: "কোডটি মেলেনি — অ্যাপে দেখানো বর্তমান কোডটি আবার লিখুন।",
  totpEnabledMsg: "2FA চালু হয়েছে। পরের লগইন থেকে পাসওয়ার্ডের পর কোড লাগবে।",
  totpOnceWarningBefore: "এই গোপন কীটি ",
  totpOnceWarningStrong: "শুধু একবারই",
  totpOnceWarningAfter:
    " দেখানো হচ্ছে। এখনই অথেনটিকেটর অ্যাপে যোগ করুন — এই পেজ ছাড়লে এটি আর দেখা যাবে না, তখন নতুন করে সেটআপ শুরু করতে হবে।",
  totpSecretLabel: "গোপন কী (হাতে লিখুন)",
  totpOtpauthLabel: "otpauth লিংক (QR-এর বদলে কপি করে অ্যাপে নিন)",
  totpCodeLabel: "অ্যাপের ৬ সংখ্যার কোড",
  totpVerifying: "যাচাই হচ্ছে…",
  totpConfirmBtn: "কোড দিয়ে চালু করুন",
  totpPendingNote:
    "আগের সেটআপের গোপন কী আবার দেখা সম্ভব নয় (নিরাপত্তার কারণে শুধু একবারই দেখানো হয়) — নতুন করে শুরু করুন।",
  totpWorking: "হচ্ছে…",
  totpResetBtn: "2FA আবার সেটআপ করুন (রিসেট)",
  totpStartBtn: "2FA সেটআপ শুরু করুন",
  totpResetWarning:
    "সতর্কতা: নতুন সেটআপ শুরু করলেই পুরনো অ্যাপের কোড কাজ করা বন্ধ করে দেবে — নতুন কী অ্যাপে যোগ করে কোড দিয়ে নিশ্চিত না করা পর্যন্ত 2FA সম্পূর্ণ হবে না।",
};

export type SecurityStrings = { [K in keyof typeof bn]: string };

const en: SecurityStrings = {
  title: "Security",
  loginRequiredDesc: "Two-factor authentication (2FA) for your account",
  loginRequired: "Please log in first to view this page.",
  description:
    "Two-factor authentication (TOTP 2FA) for your own account — nobody else's 2FA can be changed from here. Below: IP rules, security alerts and active staff sessions.",
  breadcrumb: "Admin / System",
  totpTitle: "Two-Factor Authentication (TOTP 2FA)",
  totpOn: "Enabled",
  totpPending: "Setup incomplete",
  totpOff: "Disabled",
  totpAccountPrefix: "Account",
  totpIntro:
    ". A 6-digit code from an app such as Google Authenticator / Microsoft Authenticator will be required at login — your account stays protected even if the password leaks.",
  totpSetupFailed: "Setup could not be started — please try again.",
  totpNetworkError: "Could not reach the server — check your network and try again.",
  totpCodePrompt: "Enter the 6-digit code from your authenticator app.",
  totpCodeMismatch: "The code did not match — enter the current code shown in the app again.",
  totpEnabledMsg: "2FA is enabled. From the next login, a code will be required after your password.",
  totpOnceWarningBefore: "This secret key is shown ",
  totpOnceWarningStrong: "only once",
  totpOnceWarningAfter:
    ". Add it to your authenticator app now — once you leave this page it will never be shown again, and you will have to start setup over.",
  totpSecretLabel: "Secret key (enter manually)",
  totpOtpauthLabel: "otpauth link (copy into the app instead of a QR)",
  totpCodeLabel: "6-digit code from the app",
  totpVerifying: "Verifying…",
  totpConfirmBtn: "Enable with code",
  totpPendingNote:
    "The previous setup's secret key cannot be shown again (for security it is shown only once) — start a new setup.",
  totpWorking: "Working…",
  totpResetBtn: "Set up 2FA again (reset)",
  totpStartBtn: "Start 2FA setup",
  totpResetWarning:
    "Warning: starting a new setup immediately stops the old app's codes from working — 2FA will not be complete until you add the new key to the app and confirm with a code.",
};

export const SECURITY_STRINGS: Record<Locale, SecurityStrings> = { bn, en };
