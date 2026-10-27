/**
 * Unified language system (doc 30) — /admin/tickets dictionary.
 * Merchant/customer DATA (ticket subjects, message bodies, canned
 * reply bodies, KB article content) is NOT translated — only UI copy.
 */
import type { Locale } from "@/i18n/locale";

const bn = {
  // page.tsx
  pageTitle: "সাপোর্ট টিকিট",
  pageDescription:
    "গ্রাহকদের খোলা সাপোর্ট টিকিটের কিউ। উত্তর দিলে টিকিট PENDING হয়, গ্রাহক আবার লিখলে OPEN হয়ে যায়; সমাধান হলে বন্ধ করে দিন। ফোন নম্বর এখানে মাস্ক করা দেখানো হয়। (Support Tickets — customers.view / customers.edit)",
  pageBreadcrumb: "Admin / Customers",
  toolsLabel: "সাপোর্ট টুলস",
  toolsHeading: "সাপোর্ট টুলস",

  // tickets-manager: tabs / badges
  tabOpen: "খোলা",
  tabPending: "স্টাফ উত্তর দিয়েছেন",
  tabClosed: "বন্ধ",
  tabAll: "সব",
  tablistLabel: "টিকিটের স্ট্যাটাস",
  statusOpen: "খোলা (OPEN)",
  statusPending: "উত্তর দেওয়া (PENDING)",
  statusClosed: "বন্ধ (CLOSED)",
  slaOk: "SLA ঠিক আছে",
  slaAtRisk: "SLA ঝুঁকিতে",
  slaBreached: "SLA ভেঙেছে",
  slaOnlyFilter: "শুধু SLA-ভাঙা টিকিট",
  slaOnlyTitle: "শুধু যেসব টিকিটের SLA সময়সীমা পেরিয়ে গেছে",

  // tickets-manager: states / errors
  loadFailed: "টিকিট লোড করা যায়নি।",
  networkError: "নেটওয়ার্ক ত্রুটি — আবার চেষ্টা করুন।",
  openFailed: "টিকিট খোলা যায়নি।",
  replyFailed: "উত্তর পাঠানো যায়নি।",
  statusFailed: "স্ট্যাটাস বদলানো যায়নি।",
  threadLoading: "থ্রেড লোড হচ্ছে…",
  emptyList: "এই তালিকায় কোনো টিকিট নেই।",
  detailPlaceholder:
    "বাম থেকে একটি টিকিট বেছে নিন — পুরো কথোপকথন, উত্তর দেওয়ার ঘর ও স্ট্যাটাস বদলের বোতাম এখানে আসবে।",

  // tickets-manager: list / detail composition
  orderInline: "অর্ডার {no}",
  metaMessages: "{count}টি বার্তা",
  customerLabel: "গ্রাহক:",
  orderDetail: "অর্ডার: {no}",
  openedLabel: "খোলা",
  slaHeading: "SLA সময়সীমা",
  slaIntro: "(খোলার সময় থেকে হিসাব করা):",
  slaFirstDue: "প্রথম উত্তরের শেষ সময় {date}",
  slaResponded: "উত্তর দেওয়া হয়েছে {date}",
  slaNotResponded: "এখনো স্টাফের উত্তর হয়নি",
  slaBreachedPast: "(সময়সীমা পেরিয়েছিল)",
  slaResolutionDue: "সমাধানের শেষ সময় {date}",
  slaBreachedNow: "(সময়সীমা পেরিয়েছে)",
  supportTeam: "সাপোর্ট টিম",

  // tickets-manager: reply box
  replyLabel: "উত্তর লিখুন (পাঠালে স্ট্যাটাস PENDING হবে)",
  replyPlaceholder: "গ্রাহকের উদ্দেশে উত্তর লিখুন…",
  sending: "পাঠানো হচ্ছে…",
  sendReply: "উত্তর পাঠান",
  closeTicket: "টিকিট বন্ধ করুন",
  reopenTicket: "আবার খুলুন",

  // support-tools: canned reply picker
  pickerLabel: "তৈরি উত্তর:",
  pickerPlaceholder: "বেছে নিন…",
  pickerInsert: "উত্তরে বসান",

  // support-tools: canned replies editor
  cannedTitle: "তৈরি উত্তর (Canned Replies)",
  cannedDesc:
    "টিকিটের উত্তর বাক্সে এক ক্লিকে বসানো যায় এমন তৈরি উত্তর। বসানোর পরও পাঠানোর আগে লেখা বদলানো যায়।",
  cannedLoadFailed: "তৈরি উত্তর লোড করা যায়নি।",
  saveFailed: "সংরক্ষণ করা যায়নি।",
  cannedSaved: "তৈরি উত্তর সংরক্ষণ হয়েছে।",
  replyN: "উত্তর {n}",
  cannedTitleLabel: "শিরোনাম",
  cannedBodyLabel: "উত্তরের লেখা",
  cannedTitlePlaceholder: "যেমন: ডেলিভারি বিলম্বের জন্য দুঃখিত",
  addCanned: "+ নতুন তৈরি উত্তর",
  reasonLabel: "পরিবর্তনের কারণ (আবশ্যক)",
  reasonPlaceholder: "কেন বদলাচ্ছেন?",
  saving: "সংরক্ষণ হচ্ছে…",
  saveCanned: "তৈরি উত্তর সংরক্ষণ করুন",

  // support-tools: KB editor
  kbTitle: "সাহায্য কেন্দ্রের আর্টিকেল (Knowledge Base)",
  kbDescA: "শুধু \"প্রকাশিত\" আর্টিকেলগুলোই গ্রাহকদের /kb পেজে দেখা যায়। Slug হতে হবে ছোট হাতের ইংরেজি অক্ষর, সংখ্যা ও হাইফেন (যেমন:",
  kbDescB: ") — একই slug দুইবার চলবে না।",
  kbLoadFailed: "আর্টিকেল লোড করা যায়নি।",
  kbSaved: "আর্টিকেল সংরক্ষণ হয়েছে — প্রকাশিতগুলো /kb পেজে দেখা যাবে।",
  articleN: "আর্টিকেল {n}",
  publishedLabel: "প্রকাশিত",
  slugLabel: "Slug (URL)",
  kbTitleBnLabel: "শিরোনাম (বাংলা)",
  kbTitleEnLabel: "শিরোনাম (English, ঐচ্ছিক)",
  kbBodyBnLabel: "লেখা (বাংলা)",
  kbBodyEnLabel: "লেখা (English, ঐচ্ছিক)",
  addArticle: "+ নতুন আর্টিকেল",
  saveArticles: "আর্টিকেল সংরক্ষণ করুন",
};

export type TicketsStrings = { [K in keyof typeof bn]: string };

const en: TicketsStrings = {
  pageTitle: "Support Tickets",
  pageDescription:
    "Queue of support tickets opened by customers. Replying moves a ticket to PENDING; a customer reply reopens it to OPEN; close it once resolved. Phone numbers are shown masked here. (Support Tickets — customers.view / customers.edit)",
  pageBreadcrumb: "Admin / Customers",
  toolsLabel: "Support Tools",
  toolsHeading: "Support Tools",

  tabOpen: "Open",
  tabPending: "Staff replied",
  tabClosed: "Closed",
  tabAll: "All",
  tablistLabel: "Ticket status",
  statusOpen: "Open (OPEN)",
  statusPending: "Replied (PENDING)",
  statusClosed: "Closed (CLOSED)",
  slaOk: "SLA on track",
  slaAtRisk: "SLA at risk",
  slaBreached: "SLA breached",
  slaOnlyFilter: "SLA-breached tickets only",
  slaOnlyTitle: "Only tickets whose SLA deadline has passed",

  loadFailed: "Could not load tickets.",
  networkError: "Network error — please try again.",
  openFailed: "Could not open the ticket.",
  replyFailed: "Could not send the reply.",
  statusFailed: "Could not change the status.",
  threadLoading: "Loading thread…",
  emptyList: "No tickets in this list.",
  detailPlaceholder:
    "Pick a ticket on the left — the full conversation, reply box and status buttons will appear here.",

  orderInline: "Order {no}",
  metaMessages: "{count} messages",
  customerLabel: "Customer:",
  orderDetail: "Order: {no}",
  openedLabel: "Opened",
  slaHeading: "SLA deadlines",
  slaIntro: "(calculated from the opening time):",
  slaFirstDue: "First response due {date}",
  slaResponded: "Responded {date}",
  slaNotResponded: "No staff response yet",
  slaBreachedPast: "(deadline had passed)",
  slaResolutionDue: "Resolution due {date}",
  slaBreachedNow: "(deadline passed)",
  supportTeam: "Support Team",

  replyLabel: "Write a reply (sending sets the status to PENDING)",
  replyPlaceholder: "Write a reply to the customer…",
  sending: "Sending…",
  sendReply: "Send reply",
  closeTicket: "Close ticket",
  reopenTicket: "Reopen",

  pickerLabel: "Canned reply:",
  pickerPlaceholder: "Choose…",
  pickerInsert: "Insert into reply",

  cannedTitle: "Canned Replies",
  cannedDesc:
    "Ready-made replies that can be inserted into the ticket reply box with one click. The text can still be edited after inserting, before sending.",
  cannedLoadFailed: "Could not load canned replies.",
  saveFailed: "Could not save.",
  cannedSaved: "Canned replies saved.",
  replyN: "Reply {n}",
  cannedTitleLabel: "Title",
  cannedBodyLabel: "Reply text",
  cannedTitlePlaceholder: "e.g. Sorry for the delivery delay",
  addCanned: "+ New canned reply",
  reasonLabel: "Reason for the change (required)",
  reasonPlaceholder: "Why are you changing this?",
  saving: "Saving…",
  saveCanned: "Save canned replies",

  kbTitle: "Help Centre Articles (Knowledge Base)",
  kbDescA: "Only \"published\" articles appear on the customers' /kb page. The slug must be lowercase English letters, digits and hyphens (e.g.",
  kbDescB: ") — the same slug cannot be used twice.",
  kbLoadFailed: "Could not load articles.",
  kbSaved: "Articles saved — published ones will appear on the /kb page.",
  articleN: "Article {n}",
  publishedLabel: "Published",
  slugLabel: "Slug (URL)",
  kbTitleBnLabel: "Title (Bangla)",
  kbTitleEnLabel: "Title (English, optional)",
  kbBodyBnLabel: "Body (Bangla)",
  kbBodyEnLabel: "Body (English, optional)",
  addArticle: "+ New article",
  saveArticles: "Save articles",
};

export const TICKETS_STRINGS: Record<Locale, TicketsStrings> = { bn, en };
