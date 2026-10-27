/**
 * Admin accept-invite — UI dictionary (doc 30 unified language system).
 * bn typed once, en typed as the mapped type — parity is compile-checked.
 * Invite DATA (name, identifier, role) is never translated.
 */
import type { Locale } from "@/i18n/locale";

const bn = {
  brandWelcome: "টিমে স্বাগতম!",
  brandText:
    "আপনাকে এই দোকানের স্টাফ হিসেবে আমন্ত্রণ জানানো হয়েছে। নিজের নাম ও পাসওয়ার্ড সেট করলেই আপনার অ্যাকাউন্ট সক্রিয় হয়ে যাবে — তারপর লগইন করে ড্যাশবোর্ড ব্যবহার করতে পারবেন।",
  title: "স্টাফ আমন্ত্রণ",
  subtitle: "আপনার অ্যাকাউন্ট সক্রিয় করতে নাম ও একটি পাসওয়ার্ড সেট করুন।",
  invalidLink:
    "আমন্ত্রণ লিংকটি অবৈধ বা এর মেয়াদ শেষ হয়ে গেছে। নতুন লিংকের জন্য অ্যাডমিনের সাথে যোগাযোগ করুন।",
  goToLogin: "লগইন পেজে যান",
  errPasswordShort: "পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে।",
  errPasswordMismatch: "পাসওয়ার্ড দুটি মিলছে না।",
  errNetwork: "সার্ভারে সংযোগ করা যায়নি। আবার চেষ্টা করুন।",
  doneText:
    "অ্যাকাউন্ট সক্রিয় হয়েছে! এখন লগইন পেজে গিয়ে ইমেইল/ফোন ও আপনার নতুন পাসওয়ার্ড দিয়ে লগইন করুন।",
  invitedAccount: "আমন্ত্রিত অ্যাকাউন্ট",
  roleLabel: "ভূমিকা: {role}",
  yourName: "আপনার নাম",
  namePlaceholder: "আপনার পুরো নাম",
  newPassword: "নতুন পাসওয়ার্ড (কমপক্ষে ৮ অক্ষর)",
  confirmPassword: "পাসওয়ার্ড আবার লিখুন",
  submitting: "অপেক্ষা করুন…",
  submit: "অ্যাকাউন্ট সক্রিয় করুন",
};

export type AcceptInviteStrings = { [K in keyof typeof bn]: string };

const en: AcceptInviteStrings = {
  brandWelcome: "Welcome to the team!",
  brandText:
    "You have been invited as staff of this store. Set your name and a password and your account will be activated — then you can sign in and use the dashboard.",
  title: "Staff Invitation",
  subtitle: "Set your name and a password to activate your account.",
  invalidLink:
    "This invitation link is invalid or has expired. Please contact the admin for a new link.",
  goToLogin: "Go to the login page",
  errPasswordShort: "The password must be at least 8 characters.",
  errPasswordMismatch: "The two passwords do not match.",
  errNetwork: "Could not connect to the server. Please try again.",
  doneText:
    "Your account is activated! Now go to the login page and sign in with your email/phone and new password.",
  invitedAccount: "Invited account",
  roleLabel: "Role: {role}",
  yourName: "Your name",
  namePlaceholder: "Your full name",
  newPassword: "New password (at least 8 characters)",
  confirmPassword: "Re-enter the password",
  submitting: "Please wait…",
  submit: "Activate account",
};

export const ACCEPT_INVITE_STRINGS: Record<Locale, AcceptInviteStrings> = { bn, en };
