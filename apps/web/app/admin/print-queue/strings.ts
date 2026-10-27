/**
 * Admin print queue (POD) — UI dictionary (doc 30 unified language system).
 * bn typed once, en typed as the mapped type — parity is compile-checked.
 * Order DATA (print text, product names, customer names) is never translated.
 */
import type { Locale } from "@/i18n/locale";

const bn = {
  lockedTitle: "প্রিন্ট কিউ",
  lockedText1: "🔒 This module is locked for this install. Print-on-demand is a paid add-on — enable ",
  lockedText2: " in Admin > Settings > Feature Flags to unlock it.",
  title: "প্রিন্ট কিউ",
  description:
    "কাস্টম প্রিন্টের অপেক্ষমাণ অর্ডার — সবচেয়ে পুরনোটি আগে। ছাপানো শেষ হলে ‘ছাপানো হয়েছে’ চাপুন — অর্ডারে একটি নোট যোগ হয়ে সেটি কিউ থেকে সরে যাবে। বোর্ডটি প্রতি ৩০ সেকেন্ডে নিজে হালনাগাদ হয় (polling — live realtime নয়)।",
  // Board
  boardAria: "প্রিন্ট কিউ",
  pendingLabel: "ছাপানো বাকি:",
  pendingCount: "{count}টি",
  pollNote: "প্রতি ৩০ সেকেন্ডে স্বয়ংক্রিয় হালনাগাদ হয় (polling — live realtime নয়)।",
  loadFailed: "প্রিন্ট কিউ লোড করা যায়নি।",
  networkLoad: "নেটওয়ার্ক ত্রুটি — কিউ হালনাগাদ করা যায়নি।",
  markFailed: "ছাপানো হিসেবে চিহ্নিত করা যায়নি।",
  networkMark: "নেটওয়ার্ক ত্রুটি — ছাপানো হিসেবে চিহ্নিত করা যায়নি।",
  loading: "প্রিন্ট কিউ লোড হচ্ছে…",
  empty: "এখন ছাপানোর অপেক্ষায় কোনো অর্ডার নেই।",
  colorLabel: "রঙ: {color}",
  orderLabel: "অর্ডার",
  printFee: "প্রিন্ট ফি:",
  feeIncluded: "(মোটে অন্তর্ভুক্ত)",
  markPrinted: "ছাপানো হয়েছে",
  // Config card
  configAria: "প্রিন্ট-অন-ডিমান্ড কনফিগ",
  configTitle: "প্রিন্ট-অন-ডিমান্ড কনফিগ",
  configIntro:
    "কোন ভ্যারিয়েন্টে কাস্টম প্রিন্ট হবে, প্রতি আইটেমে প্রিন্ট ফি কত, আর লেখার সর্বোচ্চ দৈর্ঘ্য — সব এখান থেকে। ফি বা সীমা বদলালে শুধু নতুন অর্ডারে প্রযোজ্য হয়; আগের অর্ডারের লেখা ও ফি অর্ডারের নোটেই নির্ধারিত (frozen) থাকে।",
  sourceLabel: "উৎস:",
  sourceSaved: "সংরক্ষিত",
  sourceDefault: "ডিফল্ট",
  moduleOffNote: " · মডিউল এখন বন্ধ (module.print_on_demand) — কনফিগ আগে থেকে তৈরি রাখা যায়।",
  configLoadFailed: "কনফিগ লোড করা যায়নি।",
  networkConfigLoad: "নেটওয়ার্ক ত্রুটি — কনফিগ লোড করা যায়নি।",
  reasonRequired: "পরিবর্তনের কারণ লিখুন (অডিটের জন্য আবশ্যক)।",
  feeInvalid: "প্রিন্ট ফি সঠিক সংখ্যা হতে হবে (ঋণাত্মক নয়)।",
  configSaveFailed: "কনফিগ সংরক্ষণ করা যায়নি।",
  networkConfigSave: "নেটওয়ার্ক ত্রুটি — কনফিগ সংরক্ষণ করা যায়নি।",
  configSaved: "কনফিগ সংরক্ষিত হয়েছে।",
  feeLabel: "প্রিন্ট ফি (টাকা / আইটেম)",
  feeHint: "০ মানে প্রিন্ট ফি নেই — ছাপানোর খরচ পণ্যের দামেই ধরা আছে।",
  textMaxLabel: "লেখার সর্বোচ্চ দৈর্ঘ্য (অক্ষর)",
  imageUploadTitle: "ছবি/আর্টওয়ার্ক আপলোড (ভবিষ্যতের জন্য)",
  imageUploadHint:
    "এখন শুধু পছন্দটি সংরক্ষিত থাকে — স্টোরেজ (R2/S3) সেটআপ না হওয়া পর্যন্ত কোথাও আপলোডের সুবিধা দেখানো হয় না। এই সংস্করণে কাস্টম প্রিন্ট মানে শুধু লেখা + রঙ।",
  variantIdsLabel: "কাস্টম-প্রিন্টযোগ্য ভ্যারিয়েন্ট ID (প্রতি লাইনে একটি)",
  variantIdsHint:
    "তালিকার বাইরের কোনো ভ্যারিয়েন্টে কাস্টম প্রিন্ট হবে না। ভ্যারিয়েন্ট ID পণ্যের সম্পাদনা পেজে পাওয়া যায়।",
  colorsLabel: "প্রিন্টের রঙের তালিকা (প্রতি লাইনে একটি, ঐচ্ছিক)",
  colorsPlaceholder: "কালো\nসাদা\n#C0392B",
  colorsHint:
    "গ্রাহক চেকআউটে এই তালিকা থেকেই রঙ বেছে নেবেন; তালিকা ফাঁকা থাকলে রঙ বেছে নেওয়ার সুবিধাই থাকবে না (দোকানের ডিফল্ট কালিতেই ছাপা হবে)। #RRGGBB আকারে লিখলে চেকআউটে রঙের নমুনা দেখাবে।",
  reasonLabel: "পরিবর্তনের কারণ (আবশ্যক)",
  reasonPlaceholder: "যেমন: নতুন কাস্টম টি-শার্ট যোগ করা হলো",
  saving: "সংরক্ষণ হচ্ছে…",
  saveConfig: "কনফিগ সংরক্ষণ করুন",
};

export type PrintQueueStrings = { [K in keyof typeof bn]: string };

const en: PrintQueueStrings = {
  lockedTitle: "Print Queue",
  lockedText1: "🔒 This module is locked for this install. Print-on-demand is a paid add-on — enable ",
  lockedText2: " in Admin > Settings > Feature Flags to unlock it.",
  title: "Print Queue",
  description:
    "Orders waiting for a custom print — oldest first. When printing is done, press ‘Printed’ — a note is added to the order and it leaves the queue. The board refreshes itself every 30 seconds (polling — not live realtime).",
  boardAria: "Print queue",
  pendingLabel: "Waiting to print:",
  pendingCount: "{count}",
  pollNote: "Refreshes automatically every 30 seconds (polling — not live realtime).",
  loadFailed: "The print queue could not be loaded.",
  networkLoad: "Network error — the queue could not be refreshed.",
  markFailed: "Could not mark as printed.",
  networkMark: "Network error — could not mark as printed.",
  loading: "Loading the print queue…",
  empty: "No orders are waiting to be printed right now.",
  colorLabel: "Colour: {color}",
  orderLabel: "Order",
  printFee: "Print fee:",
  feeIncluded: "(included in the total)",
  markPrinted: "Printed",
  configAria: "Print-on-demand config",
  configTitle: "Print-on-Demand Config",
  configIntro:
    "Which variants get a custom print, the print fee per item, and the maximum text length — all from here. Fee or limit changes apply only to new orders; earlier orders' text and fee stay frozen on the order note.",
  sourceLabel: "Source:",
  sourceSaved: "Saved",
  sourceDefault: "Default",
  moduleOffNote: " · The module is currently off (module.print_on_demand) — the config can be prepared in advance.",
  configLoadFailed: "The config could not be loaded.",
  networkConfigLoad: "Network error — the config could not be loaded.",
  reasonRequired: "Enter a reason for the change (required for audit).",
  feeInvalid: "The print fee must be a valid number (not negative).",
  configSaveFailed: "The config could not be saved.",
  networkConfigSave: "Network error — the config could not be saved.",
  configSaved: "Config saved.",
  feeLabel: "Print fee (Taka / item)",
  feeHint: "0 means no print fee — the printing cost is included in the product price.",
  textMaxLabel: "Maximum text length (characters)",
  imageUploadTitle: "Image/artwork upload (for the future)",
  imageUploadHint:
    "For now only the preference is saved — no upload is offered anywhere until storage (R2/S3) is set up. In this version a custom print means text + colour only.",
  variantIdsLabel: "Custom-printable variant IDs (one per line)",
  variantIdsHint:
    "No variant outside this list gets a custom print. Variant IDs are found on the product edit page.",
  colorsLabel: "Print colour list (one per line, optional)",
  colorsPlaceholder: "Black\nWhite\n#C0392B",
  colorsHint:
    "Customers pick a colour from this list at checkout; if the list is empty there is no colour choice (printing uses the store's default ink). Written as #RRGGBB, a colour swatch is shown at checkout.",
  reasonLabel: "Reason for the change (required)",
  reasonPlaceholder: "e.g. Added a new custom T-shirt",
  saving: "Saving…",
  saveConfig: "Save config",
};

export const PRINT_QUEUE_STRINGS: Record<Locale, PrintQueueStrings> = { bn, en };
