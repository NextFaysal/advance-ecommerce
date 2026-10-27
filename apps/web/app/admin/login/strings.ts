/**
 * Admin login — UI dictionary (doc 30 unified language system).
 * bn typed once, en typed as the mapped type — parity is compile-checked.
 * Server-provided error messages (error.message from the auth API) are
 * DATA and pass through untranslated; only this page's own copy lives here.
 */
import type { Locale } from "@/i18n/locale";

const bn = {
  brandHeadline1: "আপনার দোকান,",
  brandHeadline2: "এক ড্যাশবোর্ডেই সব।",
  brandText:
    "অর্ডার, পেমেন্ট, কুরিয়ার আর কাস্টমার — সবকিছু এক জায়গা থেকে পরিচালনা করুন। ক্যাশ অন ডেলিভারি থেকে bKash অটো-ভেরিফাই পর্যন্ত, বাংলাদেশি ব্যবসার জন্যই তৈরি।",
  brandFeat1: "✓ সারাদেশে কুরিয়ার ট্র্যাকিং",
  brandFeat2: "✓ দৈনিক ক্যাশ ক্লোজিং ও রিপোর্ট",
  brandFeat3: "✓ ফ্রড স্কোরিং ও অটোমেশন",
  title: "অ্যাডমিন লগইন",
  subtitle: "শুধুমাত্র স্টাফদের জন্য। ইমেইল বা ফোন নম্বর ও পাসওয়ার্ড দিয়ে লগইন করুন।",
  identifierLabel: "ইমেইল / ফোন",
  passwordLabel: "পাসওয়ার্ড",
  showPassword: "পাসওয়ার্ড দেখুন",
  loggingIn: "লগইন হচ্ছে…",
  login: "লগইন",
  or: "অথবা",
  passkeyBusy: "পাসকি যাচাই হচ্ছে…",
  passkeyLogin: "পাসকি দিয়ে প্রবেশ",
  totpLabel: "2FA কোড (৬ সংখ্যা, authenticator app থেকে)",
  verifying: "যাচাই হচ্ছে…",
  verify: "যাচাই করুন",
  backToLogin: "লগইনে ফিরে যান",
  securityNote:
    "নিরাপত্তা: ৫ বার ভুল লগইন করলে অ্যাকাউন্ট ৩০ মিনিটের জন্য লক হবে। সন্দেহজনক লগইন হলে অ্যাডমিনকে জানানো হবে।",
  backToStore: "← দোকানে ফিরে যান",
  errPasskeyNeedsId: "আগে ইমেইল / ফোন লিখুন, তারপর পাসকি দিয়ে চেষ্টা করুন।",
  errPasskeyCancelled:
    "পাসকি লগইন সম্পন্ন হয়নি — প্রম্পট বাতিল হয়ে থাকতে পারে। পাসওয়ার্ড দিয়ে লগইন করুন।",
  errLoginFailed: "লগইন ব্যর্থ হয়েছে। আবার চেষ্টা করুন।",
  errNetwork: "নেটওয়ার্ক ত্রুটি। সংযোগ দেখে আবার চেষ্টা করুন।",
  errInvalidCode: "কোডটি সঠিক নয়। আবার চেষ্টা করুন।",
};

export type LoginStrings = { [K in keyof typeof bn]: string };

const en: LoginStrings = {
  brandHeadline1: "Your store,",
  brandHeadline2: "all in one dashboard.",
  brandText:
    "Orders, payments, couriers and customers — manage everything from one place. From cash on delivery to bKash auto-verification, built for Bangladeshi businesses.",
  brandFeat1: "✓ Courier tracking nationwide",
  brandFeat2: "✓ Daily cash closing & reports",
  brandFeat3: "✓ Fraud scoring & automation",
  title: "Admin Login",
  subtitle: "Staff only. Sign in with your email or phone number and password.",
  identifierLabel: "Email / Phone",
  passwordLabel: "Password",
  showPassword: "Show password",
  loggingIn: "Signing in…",
  login: "Login",
  or: "or",
  passkeyBusy: "Verifying passkey…",
  passkeyLogin: "Sign in with a passkey",
  totpLabel: "2FA code (6 digits, from your authenticator app)",
  verifying: "Verifying…",
  verify: "Verify",
  backToLogin: "Back to login",
  securityNote:
    "Security: 5 failed logins lock the account for 30 minutes. Suspicious logins are reported to the admin.",
  backToStore: "← Back to the store",
  errPasskeyNeedsId: "Enter your email / phone first, then try the passkey.",
  errPasskeyCancelled:
    "Passkey sign-in did not complete — the prompt may have been cancelled. Sign in with your password.",
  errLoginFailed: "Login failed. Please try again.",
  errNetwork: "Network error. Check your connection and try again.",
  errInvalidCode: "Invalid code. Please try again.",
};

export const LOGIN_STRINGS: Record<Locale, LoginStrings> = { bn, en };
