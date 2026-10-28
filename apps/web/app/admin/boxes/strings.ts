/**
 * Admin subscription boxes — UI dictionary (doc 30 unified language system).
 * bn typed once, en typed as the mapped type — parity is compile-checked.
 * Box DATA (product names, cycle notes from the DB) is never translated;
 * subscription interval/status labels come from src/subscriptions/labels
 * ({bn,en} records, selected by locale at the call site).
 */
import type { Locale } from "@/i18n/locale";

const bn = {
  // Page
  title: "সাবস্ক্রিপশন বক্স",
  descriptionEnabled:
    "কিউরেটেড রিকারিং বক্স — প্রতি সাইকেলের তালিকা অনুযায়ী অর্ডার তৈরি হয়। তালিকা নির্ধারণ না থাকলে ওই সাইকেল বাদ যায় (আগের বাক্স কখনো পাঠানো হয় না)। অর্ডার তৈরি হয় শুধু ওয়ার্কার সুইপ চললে।",
  descriptionEngineOff:
    "সতর্কতা: সাবস্ক্রিপশন ইঞ্জিন (module.subscriptions) বন্ধ আছে — বক্স সাবস্ক্রিপশন তৈরি বা অর্ডার জেনারেশন কোনোটাই হবে না। আগে Feature Flags থেকে ইঞ্জিন চালু করুন।",
  lockedPrefix: "🔒 এই মডিউলটি এই ইনস্টলে লক করা আছে। সাবস্ক্রিপশন বক্স একটি পেইড অ্যাড-অন — আনলক করতে",
  lockedMid: "(এবং সাবস্ক্রিপশন ইঞ্জিন,",
  lockedSuffix: ") Admin > Settings > Feature Flags থেকে চালু করুন।",

  // Shared
  sourceSaved: "সংরক্ষিত ডকুমেন্ট",
  sourceDefault: "ডিফল্ট (এখনো সংরক্ষণ হয়নি)",
  stateOn: "চালু",
  stateOff: "বন্ধ",
  reasonLabel: "পরিবর্তনের কারণ (বাধ্যতামূলক)",
  saving: "সংরক্ষণ হচ্ছে…",
  loading: "লোড হচ্ছে…",
  configLoadFailed: "কনফিগ লোড করা যায়নি।",
  configLoadNetwork: "নেটওয়ার্ক ত্রুটি — কনফিগ লোড করা যায়নি।",
  configSaveFailed: "কনফিগ সংরক্ষণ করা যায়নি।",
  configSaveNetwork: "নেটওয়ার্ক ত্রুটি — কনফিগ সংরক্ষণ করা যায়নি।",
  configSaved: "কনফিগ সংরক্ষিত হয়েছে।",

  // List
  listTitle: "বক্স সাবস্ক্রিপশনসমূহ",
  workerNote: "অর্ডার তৈরি হয় শুধু ওয়ার্কার সুইপ চললে — ওয়ার্কার হোস্ট না থাকলে সক্রিয় সাবস্ক্রিপশনের তারিখ পেরিয়ে গেলেও অর্ডার আসবে না।",
  engineOffNote: "সাবস্ক্রিপশন ইঞ্জিন (module.subscriptions) এখন বন্ধ — জেনারেশন সম্পূর্ণ বন্ধ আছে।",
  listLoadFailed: "বক্স সাবস্ক্রিপশনের তালিকা লোড করা যায়নি।",
  listLoadFailedConn: "বক্স সাবস্ক্রিপশনের তালিকা লোড করা যায়নি — সংযোগ যাচাই করুন।",
  listEmptyTitle: "কোনো বক্স সাবস্ক্রিপশন নেই",
  listEmptyDesc: "কনফিগে বক্স ভ্যারিয়েন্ট যোগ করলে ওই পণ্যের পেজ থেকে কাস্টমার সাবস্ক্রাইব করতে পারবেন।",
  listEmpty:
    "কোনো বক্স সাবস্ক্রিপশন নেই — কনফিগে বক্স ভ্যারিয়েন্ট যোগ করলে ওই পণ্যের পেজ থেকে কাস্টমার সাবস্ক্রাইব করতে পারবেন।",
  colCustomer: "কাস্টমার",
  colBox: "বক্স",
  colCycle: "সাইকেল",
  colStatus: "অবস্থা",
  colNextCycle: "পরের সাইকেল",
  colLastGen: "সর্বশেষ জেনারেশন",
  cycleWord: "সাইকেল {key}",
  contentsSet: "তালিকা নির্ধারিত ✓ ({count}টি পণ্য)",
  contentsMissing: "তালিকা নেই — এই সাইকেল বাদ যাবে",
  cyclePrefix: "সাইকেল {key} · ",
  totalRuns: "মোট {count} বার",
  viewLastOrder: "সর্বশেষ অর্ডার দেখুন",
  notYet: "এখনো হয়নি",

  // Config card
  configTitle: "বক্স কনফিগ",
  configIntro: "কোন ভ্যারিয়েন্টগুলো সাবস্ক্রিপশন বক্স, কোন সাইকেলে সাবস্ক্রাইব করা যাবে, আর বক্স অর্ডারের ছাড়।",
  configSourceLine: "উৎস: {source} · বক্স মডিউল: {module} · সাবস্ক্রিপশন ইঞ্জিন: {engine}",
  variantIdsLabel: "বক্স ভ্যারিয়েন্ট আইডি (প্রতি লাইনে একটি)",
  variantIdsHelp:
    "তালিকায় থাকা ভ্যারিয়েন্টের পেজে বক্স সাবস্ক্রিপশন কার্ড দেখা যাবে; তালিকা থেকে সরালে ওই ভ্যারিয়েন্ট আবার সাধারণ সাবস্ক্রিপশন পণ্যের মতো আচরণ করবে।",
  cyclesLegend: "অনুমোদিত সাইকেল",
  weeklyLabel: "সাপ্তাহিক (প্রতি সপ্তাহে)",
  monthlyLabel: "মাসিক (প্রতি মাসে)",
  cyclesHelp: "অন্তত একটি সাইকেল চালু থাকতে হবে।",
  discountLabel: "বক্স ছাড় (বেসিস পয়েন্ট{current})",
  discountNow: " — এখন {pct}%",
  discountHelp:
    "1000 = 10%। 0 রাখলে সাধারণ সাবস্ক্রিপশন ছাড় (subscriptions.discount_bps) প্রযোজ্য হবে; ধনাত্মক মান দিলে বক্স অর্ডারে সেটাই প্রযোজ্য হবে।",
  reasonPlaceholderConfig: "যেমন: নভেম্বর বক্স চালু",
  saveConfig: "কনফিগ সংরক্ষণ করুন",

  // Contents card
  contentsTitle: "সাইকেল অনুযায়ী বাক্সের তালিকা",
  contentsIntro:
    "প্রতি সাইকেলে বাক্সে কী কী থাকবে তা এখানে নির্ধারণ করুন। যে সাইকেলের তালিকা নেই, সেই চক্রে অর্ডার তৈরি হবে না — আগের সাইকেলের তালিকা কখনো নিজে থেকে পুনরায় ব্যবহার হবে না।",
  contentsLoadFailed: "তালিকা লোড করা যায়নি।",
  contentsLoadNetwork: "নেটওয়ার্ক ত্রুটি — তালিকা লোড করা যায়নি।",
  boxesLoadFailed: "বক্সের তালিকা লোড করা যায়নি।",
  boxesLoadNetwork: "নেটওয়ার্ক ত্রুটি — বক্সের তালিকা লোড করা যায়নি।",
  contentsSaveFailed: "তালিকা সংরক্ষণ করা যায়নি।",
  contentsSaveNetwork: "নেটওয়ার্ক ত্রুটি — তালিকা সংরক্ষণ করা যায়নি।",
  contentsSaved: "সাইকেলের তালিকা সংরক্ষিত হয়েছে।",
  noBoxesNote: "আগে নিচের বক্স কনফিগে অন্তত একটি বক্স ভ্যারিয়েন্ট যোগ করুন — তারপর এখানে সাইকেলের তালিকা দেওয়া যাবে।",
  variantLabel: "বক্স ভ্যারিয়েন্ট",
  productMissing: "(পণ্য পাওয়া যায়নি)",
  definedCycles: "তালিকা আছে: {keys}",
  noCyclesYet: "এই বক্সের কোনো সাইকেলের তালিকা এখনো নেই।",
  cycleKeyLabel: "সাইকেল কী (YYYY-MM অথবা YYYY-Www)",
  quickThisMonth: "এই মাস",
  quickNextMonth: "পরের মাস",
  quickThisWeek: "এই সপ্তাহ",
  quickNextWeek: "পরের সপ্তাহ",
  deleteCycle: "সাইকেল মুছুন",
  noteBnLabel: "থিম/নোট (বাংলা, ঐচ্ছিক)",
  noteBnPlaceholder: "যেমন: শীতের যত্ন বক্স",
  noteEnLabel: "থিম/নোট (ইংরেজি, ঐচ্ছিক)",
  noteEnPlaceholder: "e.g. Winter care box",
  itemsHeading: "বাক্সের পণ্যসমূহ (প্রতি বাক্সে)",
  noItems: "এখনো কোনো পণ্য যোগ হয়নি।",
  quantityAria: "পরিমাণ",
  removeBtn: "সরান",
  searchPlaceholder: "পণ্য যোগ করুন — SKU বা পণ্যের নাম লিখে খুঁজুন…",
  searchAria: "পণ্য খুঁজুন",
  stockPart: "স্টক {stock}",
  addCycle: "+ নতুন সাইকেল যোগ করুন",
  reasonPlaceholderContents: "যেমন: নভেম্বর সাইকেলের তালিকা",
  saveContents: "তালিকা সংরক্ষণ করুন",
};

export type BoxesStrings = { [K in keyof typeof bn]: string };

const en: BoxesStrings = {
  title: "Subscription Boxes",
  descriptionEnabled:
    "Curated recurring boxes — orders are generated from each cycle's contents list. A cycle with no list set is skipped (an earlier box is never re-sent). Orders are created only when the worker sweep runs.",
  descriptionEngineOff:
    "Warning: the subscription engine (module.subscriptions) is off — neither box subscriptions nor order generation will happen. Enable the engine from Feature Flags first.",
  lockedPrefix: "🔒 This module is locked for this install. Subscription boxes is a paid add-on — enable",
  lockedMid: "(and the subscription engine,",
  lockedSuffix: ") in Admin > Settings > Feature Flags to unlock it.",

  sourceSaved: "Saved document",
  sourceDefault: "Default (not saved yet)",
  stateOn: "On",
  stateOff: "Off",
  reasonLabel: "Reason for the change (required)",
  saving: "Saving…",
  loading: "Loading…",
  configLoadFailed: "Could not load the config.",
  configLoadNetwork: "Network error — could not load the config.",
  configSaveFailed: "Could not save the config.",
  configSaveNetwork: "Network error — could not save the config.",
  configSaved: "Config saved.",

  listTitle: "Box Subscriptions",
  workerNote:
    "Orders are created only when the worker sweep runs — without a worker host, an active subscription's date can pass without an order appearing.",
  engineOffNote: "The subscription engine (module.subscriptions) is currently off — generation is fully stopped.",
  listLoadFailed: "Could not load the box subscriptions list.",
  listLoadFailedConn: "Could not load the box subscriptions list — check your connection.",
  listEmptyTitle: "No box subscriptions",
  listEmptyDesc: "Add a box variant in the config and customers will be able to subscribe from that product's page.",
  listEmpty:
    "No box subscriptions — once a box variant is added in the config, customers can subscribe from that product's page.",
  colCustomer: "Customer",
  colBox: "Box",
  colCycle: "Cycle",
  colStatus: "Status",
  colNextCycle: "Next cycle",
  colLastGen: "Last generation",
  cycleWord: "Cycle {key}",
  contentsSet: "Contents set ✓ ({count} items)",
  contentsMissing: "No contents — this cycle will be skipped",
  cyclePrefix: "Cycle {key} · ",
  totalRuns: "{count} runs in total",
  viewLastOrder: "View last order",
  notYet: "Not yet",

  configTitle: "Box Config",
  configIntro: "Which variants are subscription boxes, which cycles can be subscribed to, and the box order discount.",
  configSourceLine: "Source: {source} · Box module: {module} · Subscription engine: {engine}",
  variantIdsLabel: "Box variant IDs (one per line)",
  variantIdsHelp:
    "A listed variant's page shows the box subscription card; removing it makes the variant behave like an ordinary subscription product again.",
  cyclesLegend: "Allowed cycles",
  weeklyLabel: "Weekly (every week)",
  monthlyLabel: "Monthly (every month)",
  cyclesHelp: "At least one cycle must stay enabled.",
  discountLabel: "Box discount (basis points{current})",
  discountNow: " — currently {pct}%",
  discountHelp:
    "1000 = 10%. Leaving it at 0 applies the general subscription discount (subscriptions.discount_bps); a positive value applies to box orders instead.",
  reasonPlaceholderConfig: "e.g. November box launch",
  saveConfig: "Save config",

  contentsTitle: "Box Contents by Cycle",
  contentsIntro:
    "Set what goes into the box in each cycle here. A cycle with no list generates no order — an earlier cycle's list is never reused automatically.",
  contentsLoadFailed: "Could not load the contents list.",
  contentsLoadNetwork: "Network error — could not load the contents list.",
  boxesLoadFailed: "Could not load the box list.",
  boxesLoadNetwork: "Network error — could not load the box list.",
  contentsSaveFailed: "Could not save the contents list.",
  contentsSaveNetwork: "Network error — could not save the contents list.",
  contentsSaved: "Cycle contents saved.",
  noBoxesNote: "Add at least one box variant in the box config below first — then cycle contents can be set here.",
  variantLabel: "Box variant",
  productMissing: "(Product not found)",
  definedCycles: "Contents set for: {keys}",
  noCyclesYet: "This box has no cycle contents yet.",
  cycleKeyLabel: "Cycle key (YYYY-MM or YYYY-Www)",
  quickThisMonth: "This month",
  quickNextMonth: "Next month",
  quickThisWeek: "This week",
  quickNextWeek: "Next week",
  deleteCycle: "Delete cycle",
  noteBnLabel: "Theme/note (Bangla, optional)",
  noteBnPlaceholder: "যেমন: শীতের যত্ন বক্স",
  noteEnLabel: "Theme/note (English, optional)",
  noteEnPlaceholder: "e.g. Winter care box",
  itemsHeading: "Box items (per box)",
  noItems: "No items added yet.",
  quantityAria: "Quantity",
  removeBtn: "Remove",
  searchPlaceholder: "Add an item — search by SKU or product name…",
  searchAria: "Search products",
  stockPart: "Stock {stock}",
  addCycle: "+ Add a new cycle",
  reasonPlaceholderContents: "e.g. November cycle contents",
  saveContents: "Save contents",
};

export const BOXES_STRINGS: Record<Locale, BoxesStrings> = { bn, en };
