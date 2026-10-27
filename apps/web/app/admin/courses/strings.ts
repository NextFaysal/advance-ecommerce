/**
 * Admin courses (LMS-lite) — UI dictionary (doc 30 unified language system).
 * bn typed once, en typed as the mapped type — parity is compile-checked.
 * Course DATA (product/module/lesson titles from the DB) is never translated.
 */
import type { Locale } from "@/i18n/locale";

const bn = {
  // Page
  title: "কোর্স (LMS-lite)",
  description:
    "কোর্স হলো সাধারণ DIGITAL পণ্য — কনফিগে তালিকাভুক্ত ভ্যারিয়েন্ট কিনলেই ক্রেতা পাঠ্যক্রমের অ্যাক্সেস পায়। আলাদা এনরোলমেন্ট টেবিল নেই: অ্যাক্সেস প্রতিবার অর্ডার থেকে যাচাই হয় — পেইড (বা ডেলিভার্ড) অর্ডার অ্যাক্সেস দেয়, রিফান্ড/রিটার্ন/বাতিল হলে অ্যাক্সেস সরে যায় (আংশিক রিফান্ডেও)। ভিডিও লেসনে শুধু YouTube/Vimeo এম্বেড — ভিডিও হোস্টিং এই প্ল্যাটফর্মে হয় না।",
  lockedPrefix: "🔒 এই মডিউলটি এই ইনস্টলে লক করা আছে। কোর্স একটি পেইড অ্যাড-অন — আনলক করতে Admin > Settings > Feature Flags থেকে",
  lockedSuffix: "চালু করুন।",

  // Shared
  sourceSaved: "সংরক্ষিত ডকুমেন্ট",
  sourceDefault: "ডিফল্ট (এখনো সংরক্ষণ হয়নি)",
  stateOn: "চালু",
  stateOff: "বন্ধ",
  reasonLabel: "পরিবর্তনের কারণ (বাধ্যতামূলক)",
  saving: "সংরক্ষণ হচ্ছে…",
  configLoadFailed: "কনফিগ লোড করা যায়নি।",
  configLoadNetwork: "নেটওয়ার্ক ত্রুটি — কনফিগ লোড করা যায়নি।",
  configSaveFailed: "কনফিগ সংরক্ষণ করা যায়নি।",
  configSaveNetwork: "নেটওয়ার্ক ত্রুটি — কনফিগ সংরক্ষণ করা যায়নি।",
  configSaved: "কনফিগ সংরক্ষিত হয়েছে।",

  // Config card
  configTitle: "কোর্স কনফিগ",
  configIntro: "কোন ভ্যারিয়েন্টগুলো কোর্স বিক্রি করে।",
  configSourceLine: "উৎস: {source} · কোর্স মডিউল: {state}",
  variantIdsLabel: "কোর্স ভ্যারিয়েন্ট আইডি (প্রতি লাইনে একটি)",
  variantIdsHelp:
    "সাধারণত DIGITAL ধরনের পণ্যের ভ্যারিয়েন্ট তালিকায় দিন। তালিকার যেকোনো ভ্যারিয়েন্ট কিনলেই ওই পণ্যের পুরো কোর্স খুলে যায়; তালিকা থেকে সরালে নতুন ক্রেতা অ্যাক্সেস পাবে না — আগের ক্রেতার অর্ডার-ভিত্তিক অ্যাক্সেসও ওই ভ্যারিয়েন্ট দিয়ে আর যাচাই হবে না।",
  reasonPlaceholderConfig: "যেমন: প্রথম কোর্স চালু",
  saveConfig: "কনফিগ সংরক্ষণ করুন",

  // Content card
  contentTitle: "পাঠ্যক্রম (কন্টেন্ট)",
  contentIntroA:
    "পণ্য বেছে মডিউল ও লেসন সাজান। সর্বোচ্চ ২০টি মডিউল, প্রতি মডিউলে ৫০টি লেসন। PDP-তে শুধু মডিউল/লেসনের",
  contentIntroStrong: "নাম",
  contentIntroB: "সবাই দেখতে পায় — লেসনের ভেতরের কন্টেন্ট শুধু ক্রেতারা অ্যাকাউন্ট থেকে দেখতে পায়।",
  productsLoadFailed: "কোর্স পণ্যের তালিকা লোড করা যায়নি।",
  productsLoadNetwork: "নেটওয়ার্ক ত্রুটি — কোর্স পণ্যের তালিকা লোড করা যায়নি।",
  docLoadFailed: "কন্টেন্ট লোড করা যায়নি।",
  docLoadNetwork: "নেটওয়ার্ক ত্রুটি — কন্টেন্ট লোড করা যায়নি।",
  contentSaveFailed: "কন্টেন্ট সংরক্ষণ করা যায়নি।",
  contentSaveNetwork: "নেটওয়ার্ক ত্রুটি — কন্টেন্ট সংরক্ষণ করা যায়নি।",
  contentSaved: "কন্টেন্ট সংরক্ষিত হয়েছে।",
  productLabel: "কোর্স পণ্য",
  productPlaceholder: "— পণ্য বেছে নিন —",
  productSummary: "{modules}টি মডিউল, {lessons}টি লেসন",
  productNoContent: "কন্টেন্ট নেই",
  noProductsNote: "কোনো কোর্স পণ্য নেই — আগে নিচের কনফিগ কার্ডে কোর্স ভ্যারিয়েন্টের আইডি যোগ করুন।",
  docSourceLine: "উৎস: {source}",
  docSourceSaved: "সংরক্ষিত ডকুমেন্ট",
  docSourceNone: "এখনো কোনো কন্টেন্ট সংরক্ষণ হয়নি",
  moduleLabel: "মডিউল {n}",
  moduleTitlePlaceholder: "মডিউলের নাম",
  deleteModule: "মডিউল মুছুন",
  lessonTitlePlaceholder: "লেসনের নাম",
  kindVideo: "ভিডিও",
  kindText: "লেখা",
  kindLink: "লিংক",
  delete: "মুছুন",
  videoUrlPlaceholder: "YouTube বা Vimeo লিংক (watch/share/embed যেকোনোটি)",
  textPlaceholder: "লেসনের লেখা (Markdown: ## শিরোনাম, **বোল্ড**, - তালিকা) — সর্বোচ্চ ২০,০০০ অক্ষর",
  addLesson: "+ লেসন যোগ করুন",
  addModule: "+ মডিউল যোগ করুন",
  reasonPlaceholderContent: "যেমন: ৩ নম্বর মডিউল যোগ",
  saveContent: "কন্টেন্ট সংরক্ষণ করুন",
};

export type CoursesStrings = { [K in keyof typeof bn]: string };

const en: CoursesStrings = {
  title: "Courses (LMS-lite)",
  description:
    "A course is an ordinary DIGITAL product — buying a variant listed in the config gives the buyer access to the curriculum. There is no separate enrolment table: access is verified from the order every time — a paid (or delivered) order grants access, and a refund/return/cancellation removes it (partial refunds too). Video lessons are YouTube/Vimeo embeds only — this platform does not host video.",
  lockedPrefix: "🔒 This module is locked for this install. Courses is a paid add-on — enable",
  lockedSuffix: "in Admin > Settings > Feature Flags to unlock it.",

  sourceSaved: "Saved document",
  sourceDefault: "Default (not saved yet)",
  stateOn: "On",
  stateOff: "Off",
  reasonLabel: "Reason for the change (required)",
  saving: "Saving…",
  configLoadFailed: "Could not load the config.",
  configLoadNetwork: "Network error — could not load the config.",
  configSaveFailed: "Could not save the config.",
  configSaveNetwork: "Network error — could not save the config.",
  configSaved: "Config saved.",

  configTitle: "Course Config",
  configIntro: "Which variants sell a course.",
  configSourceLine: "Source: {source} · Courses module: {state}",
  variantIdsLabel: "Course variant IDs (one per line)",
  variantIdsHelp:
    "Usually list variants of DIGITAL products. Buying any listed variant unlocks that product's whole course; removing one stops new buyers getting access — and earlier buyers' order-based access will no longer verify through that variant either.",
  reasonPlaceholderConfig: "e.g. Launching the first course",
  saveConfig: "Save config",

  contentTitle: "Curriculum (Content)",
  contentIntroA:
    "Pick a product and arrange its modules and lessons. Up to 20 modules, 50 lessons per module. On the PDP everyone can see only the module/lesson",
  contentIntroStrong: "names",
  contentIntroB: "— lesson content itself is visible only to buyers from their account.",
  productsLoadFailed: "Could not load the course product list.",
  productsLoadNetwork: "Network error — could not load the course product list.",
  docLoadFailed: "Could not load the content.",
  docLoadNetwork: "Network error — could not load the content.",
  contentSaveFailed: "Could not save the content.",
  contentSaveNetwork: "Network error — could not save the content.",
  contentSaved: "Content saved.",
  productLabel: "Course product",
  productPlaceholder: "— Choose a product —",
  productSummary: "{modules} modules, {lessons} lessons",
  productNoContent: "No content",
  noProductsNote: "No course products yet — add a course variant ID in the config card below first.",
  docSourceLine: "Source: {source}",
  docSourceSaved: "Saved document",
  docSourceNone: "No content saved yet",
  moduleLabel: "Module {n}",
  moduleTitlePlaceholder: "Module title",
  deleteModule: "Delete module",
  lessonTitlePlaceholder: "Lesson title",
  kindVideo: "Video",
  kindText: "Text",
  kindLink: "Link",
  delete: "Delete",
  videoUrlPlaceholder: "YouTube or Vimeo link (watch/share/embed)",
  textPlaceholder: "Lesson text (Markdown: ## heading, **bold**, - list) — up to 20,000 characters",
  addLesson: "+ Add lesson",
  addModule: "+ Add module",
  reasonPlaceholderContent: "e.g. Added module 3",
  saveContent: "Save content",
};

export const COURSES_STRINGS: Record<Locale, CoursesStrings> = { bn, en };
