/**
 * Admin marketing mechanics (spin wheel, A/B experiments, WhatsApp
 * broadcast, seasonal campaigns, exit-intent) — UI dictionary
 * (doc 30 unified language system). bn typed once, en typed as the
 * mapped type — parity is compile-checked. Merchant DATA (preset
 * names/headlines from the API, segment labels, campaign titles,
 * status codes) is never translated; only UI copy lives here.
 */
import type { Locale } from "@/i18n/locale";

const bn = {
  // Page shell
  title: "মার্কেটিং মেকানিক্স",
  subtitle: "স্পিন হুইল, A/B এক্সপেরিমেন্ট, EMI ডিসপ্লে ও WhatsApp ব্রডকাস্ট — সব সেটিংস ডাটাবেসে থাকে, কোডে নয়।",
  lockedTitle: "এই মডিউলটি লক করা আছে",
  lockedBefore: "মার্কেটিং মেকানিক্স একটি পেইড অ্যাড-অন (ADV-18)। চালু করতে Admin → Feature Flags থেকে ",
  lockedAfter: " সক্রিয় করুন।",

  // Generic feedback
  loadFailed: "লোড করা যায়নি",
  saveFailed: "সেভ করা যায়নি",
  createFailed: "তৈরি করা যায়নি",
  updateFailed: "হালনাগাদ করা যায়নি",
  statsFailed: "ফলাফল লোড করা যায়নি",
  sendFailed: "পাঠানো যায়নি",
  saved: "সংরক্ষিত হয়েছে।",
  active: "সক্রিয়",

  // Spin wheel
  spinTitle: "স্পিন হুইল",
  spinIntro:
    "ওজন অনুযায়ী সার্ভার ফলাফল ঠিক করে। অন্তত একটি “পুরস্কার নেই” সেগমেন্ট (কুপন খালি) থাকতেই হবে — ছাড়া সেভ হবে না। যেসব পুরস্কার-সেগমেন্টের কুপন এখন সক্রিয় নয়, সেগুলো ড্র থেকে বাদ যায় (নিচে দেখুন)।",
  spinEnabledLabel: "চালু আছে",
  spinDailyLimitLabel: "দৈনিক স্পিন সীমা (জনপ্রতি)",
  spinClaimExpiryLabel: "জেতা কুপনের মেয়াদ (দিন)",
  spinSegmentLabel: "লেবেল",
  spinCouponLabel: "কুপন কোড (খালি = পুরস্কার নেই)",
  spinWeightLabel: "ওজন (bps)",
  spinOddsPrefix: "আসল সম্ভাবনা:",
  spinNotInDraw: "ড্রতে নেই",
  spinDeleteSegmentAria: "সেগমেন্ট মুছুন",
  spinAddSegment: "+ সেগমেন্ট যোগ করুন",
  spinExcludedPrefix: "ড্র থেকে বাদ:",
  spinSave: "সংরক্ষণ করুন",
  spinRecentTitle: "সাম্প্রতিক স্পিন (Redis অডিট লগ — সাময়িক)",

  // Experiments
  expTitle: "A/B এক্সপেরিমেন্ট — হোমপেজ হিরো",
  expIntro:
    "A = কন্ট্রোল (বর্তমান হিরো), B = নতুন হেডলাইন/CTA। ভিজিটর আইডির হ্যাশ দিয়ে নির্ধারিতভাবে ভ্যারিয়েন্ট দেওয়া হয় — একই ভিজিটর সবসময় একই ভ্যারিয়েন্ট দেখে। সংখ্যাগুলো কাঁচা কাউন্ট মাত্র; কোনো সিগনিফিক্যান্স দাবি করা হয় না।",
  expRequiredError: "নাম, B ভ্যারিয়েন্টের হেডলাইন ও CTA লেবেল আবশ্যক।",
  expCreated: "এক্সপেরিমেন্ট তৈরি হয়েছে (ড্রাফট)। চালু করতে “শুরু করুন” চাপুন।",
  expNameLabel: "এক্সপেরিমেন্টের নাম",
  expNamePlaceholder: "হিরো হেডলাইন টেস্ট",
  expWeightALabel: "A ওজন (bps)",
  expWeightBLabel: "B ওজন (bps)",
  expBHeadlineLabel: "B হেডলাইন",
  expBSubLabel: "B সাব-টেক্সট",
  expBCtaLabel: "B CTA লেবেল",
  expBCtaHrefLabel: "B CTA লিংক",
  expCreateDraft: "ড্রাফট তৈরি করুন",
  expStart: "শুরু করুন",
  expStop: "বন্ধ করুন",
  expViewResults: "ফলাফল দেখুন",
  expStatusDraft: "খসড়া",
  expStatusRunning: "চলমান",
  expStatusStopped: "বন্ধ",
  expVariantWeight: "{key}: ওজন {weight}",
  expControlSuffix: " (কন্ট্রোল)",
  expThVariant: "ভ্যারিয়েন্ট",
  expThExposures: "ইউনিক এক্সপোজার",
  expThConversions: "অর্ডার (কনভার্সন)",
  expThConversionPct: "কনভার্সন % (বর্ণনামূলক)",
  expNone: "কোনো এক্সপেরিমেন্ট নেই।",

  // WhatsApp broadcast
  bcTitle: "WhatsApp ব্রডকাস্ট",
  bcIntroBefore:
    "অডিয়েন্স: নিউজলেটারে সাবস্ক্রাইব করা ইমেইলের সঙ্গে মিলে যাওয়া, ফোন-সহ অ্যাক্টিভ কাস্টমাররাই শুধু — আলাদা WhatsApp সম্মতির কোনো ফিল্ড সিস্টেমে নেই, তাই এর বাইরে কাউকে পাঠানো হয় না। বর্তমান অডিয়েন্স: ",
  bcIntroAfter:
    " জন। একবারে সর্বোচ্চ ৫০ জনকে পাঠানো হয় (ব্যাচ সীমা)। Meta-র নিয়মে ২৪ ঘণ্টার উইন্ডোর বাইরে ফ্রি-ফর্ম টেক্সট বাতিল হতে পারে — অনুমোদিত টেমপ্লেট ব্যবহারই নিরাপদ।",
  bcNotConfiguredBefore: "WhatsApp চ্যানেল কনফিগার করা নেই — অনুপস্থিত Settings: ",
  bcNotConfiguredAfter: "। ক্যাম্পেইন পাঠালে NOT_SENT হিসেবে রেকর্ড হবে, পাঠানো হয়েছে বলে দেখানো হবে না।",
  bcDraftSaved: "ক্যাম্পেইন ড্রাফট হিসেবে সংরক্ষিত হয়েছে।",
  bcNotSent: "পাঠানো হয়নি: {reason}",
  bcStatusLine: "ক্যাম্পেইনের অবস্থা: {status} (চেষ্টা {count} জন)",
  bcNameLabel: "ক্যাম্পেইনের নাম",
  bcMessageLabel: "মেসেজ",
  bcCreateDraft: "ড্রাফট তৈরি করুন",
  bcAudienceLine: "অডিয়েন্স {audience} · চেষ্টা {attempted}",
  bcSending: "পাঠানো হচ্ছে…",
  bcSend: "পাঠান",
  bcNone: "কোনো ক্যাম্পেইন নেই।",

  // EMI
  emiTitle: "EMI ডিসপ্লে",
  emiBefore: "EMI শুধু প্রদর্শনের জন্য — কোনো গেটওয়ে নেই, চার্জের পরিমাণ বদলায় না। কনফিগারেশন: Admin → Settings → Payment — কীগুলো: ",
  emiAfter: "। BNPL-এর কোনো প্রোভাইডার সিস্টেমে নেই, তাই BNPL কোথাও দেখানো হয় না।",

  // Seasonal campaigns card
  campTitle: "সিজনাল ক্যাম্পেইন ও এক্সিট-ইনটেন্ট পপআপ",
  campIntro:
    "টেমপ্লেট বেছে স্লট পূরণ করুন — পণ্য আসবে আসল ক্যাটালগ থেকে (ক্যাটাগরি / ট্যাগ / চলমান ফ্ল্যাশ সেল), কুপন কোড থাকতে হবে আসল Coupon তালিকায়। কাউন্টডাউন শুধু শেষ তারিখ দিলেই দেখাবে।",
  campReasonRequired: "সেভ করতে কারণ (reason) আবশ্যক।",
  campSaved: "সেভ হয়েছে। স্টোরফ্রন্টে /campaign/<slug> পেজে দেখা যাবে (সক্রিয় থাকলে)।",
  campHeadlineBnLabel: "হেডলাইন (বাংলা, খালি = ডিফল্ট: “{headline}”)",
  campHeadlineEnLabel: "হেডলাইন (English, ঐচ্ছিক)",
  campSubBnLabel: "সাব-টেক্সট (বাংলা, ঐচ্ছিক)",
  campSourceLabel: "পণ্যের উৎস",
  campSourceCategory: "ক্যাটাগরি",
  campSourceTag: "পণ্যের ট্যাগ",
  campSourceFlash: "চলমান ফ্ল্যাশ সেল",
  campSourceValueLabel: "উৎসের মান",
  campTagPlaceholder: "যেমন: eid",
  campFlashNote: "যে ফ্ল্যাশ সেলটি তখন লাইভ থাকবে",
  campCouponLabel: "কুপন কোড (ঐচ্ছিক, থাকতে হবে)",
  campCouponPlaceholder: "যেমন: EID10",
  campCouponWarning: "সতর্কতা: এই কোডটি এখন {reason} — পেজে দেখানো হবে না।",
  campEndsLabel: "শেষ তারিখ (ঐচ্ছিক — কাউন্টডাউনের জন্য)",
  exitTitle: "এক্সিট-ইনটেন্ট পপআপ",
  exitIntro:
    "ডেস্কটপে পেজ ছাড়ার ইঙ্গিতে, মোবাইলে ৬০ সেকেন্ড পর — সেশনে সর্বোচ্চ একবার, বন্ধ করলে ৭ দিন আর দেখাবে না। চেকআউট/অ্যাকাউন্ট পেজে কখনো নয়।",
  exitHeadlineLabel: "হেডলাইন (বাংলা)",
  exitBodyLabel: "বডি টেক্সট (বাংলা)",
  exitCouponPlaceholder: "যেমন: WELCOME10",
  reasonLabel: "পরিবর্তনের কারণ (আবশ্যক, অডিটে থাকবে)",
  reasonPlaceholder: "যেমন: ঈদ ক্যাম্পেইন চালু",
  saveAll: "সব সেভ করুন",
};

export type MechanicsStrings = { [K in keyof typeof bn]: string };

const en: MechanicsStrings = {
  title: "Marketing Mechanics",
  subtitle: "Spin wheel, A/B experiments, EMI display and WhatsApp broadcast — all settings live in the database, not in code.",
  lockedTitle: "This module is locked",
  lockedBefore: "Marketing Mechanics is a paid add-on (ADV-18). To enable it, activate ",
  lockedAfter: " from Admin → Feature Flags.",

  loadFailed: "Could not load",
  saveFailed: "Could not save",
  createFailed: "Could not create",
  updateFailed: "Could not update",
  statsFailed: "Could not load results",
  sendFailed: "Could not send",
  saved: "Saved.",
  active: "Active",

  spinTitle: "Spin Wheel",
  spinIntro:
    "The server decides the result by weight. At least one “no prize” segment (empty coupon) is required — saving fails without one. Prize segments whose coupon is not currently active are excluded from the draw (see below).",
  spinEnabledLabel: "Enabled",
  spinDailyLimitLabel: "Daily spin limit (per person)",
  spinClaimExpiryLabel: "Won coupon validity (days)",
  spinSegmentLabel: "Label",
  spinCouponLabel: "Coupon code (empty = no prize)",
  spinWeightLabel: "Weight (bps)",
  spinOddsPrefix: "Actual odds:",
  spinNotInDraw: "Not in draw",
  spinDeleteSegmentAria: "Delete segment",
  spinAddSegment: "+ Add segment",
  spinExcludedPrefix: "Excluded from draw:",
  spinSave: "Save",
  spinRecentTitle: "Recent spins (Redis audit log — temporary)",

  expTitle: "A/B Experiments — Homepage Hero",
  expIntro:
    "A = control (current hero), B = new headline/CTA. Variants are assigned deterministically by visitor-ID hash — the same visitor always sees the same variant. The numbers are raw counts only; no significance is claimed.",
  expRequiredError: "Name, variant B headline and CTA label are required.",
  expCreated: "Experiment created (draft). Press “Start” to run it.",
  expNameLabel: "Experiment name",
  expNamePlaceholder: "Hero headline test",
  expWeightALabel: "A weight (bps)",
  expWeightBLabel: "B weight (bps)",
  expBHeadlineLabel: "B headline",
  expBSubLabel: "B sub-text",
  expBCtaLabel: "B CTA label",
  expBCtaHrefLabel: "B CTA link",
  expCreateDraft: "Create draft",
  expStart: "Start",
  expStop: "Stop",
  expViewResults: "View results",
  expStatusDraft: "draft",
  expStatusRunning: "running",
  expStatusStopped: "stopped",
  expVariantWeight: "{key}: weight {weight}",
  expControlSuffix: " (control)",
  expThVariant: "Variant",
  expThExposures: "Unique exposures",
  expThConversions: "Orders (conversions)",
  expThConversionPct: "Conversion % (descriptive)",
  expNone: "No experiments.",

  bcTitle: "WhatsApp Broadcast",
  bcIntroBefore:
    "Audience: only active customers with a phone whose email matches a newsletter subscription — the system has no separate WhatsApp consent field, so nobody outside this set is sent to. Current audience: ",
  bcIntroAfter:
    " people. At most 50 are sent per batch (batch limit). Under Meta's rules, free-form text outside the 24-hour window may be rejected — using an approved template is safer.",
  bcNotConfiguredBefore: "The WhatsApp channel is not configured — missing Settings: ",
  bcNotConfiguredAfter: ". Sending a campaign will record it as NOT_SENT; it will not be shown as sent.",
  bcDraftSaved: "Campaign saved as a draft.",
  bcNotSent: "Not sent: {reason}",
  bcStatusLine: "Campaign status: {status} (attempted {count})",
  bcNameLabel: "Campaign name",
  bcMessageLabel: "Message",
  bcCreateDraft: "Create draft",
  bcAudienceLine: "Audience {audience} · Attempted {attempted}",
  bcSending: "Sending…",
  bcSend: "Send",
  bcNone: "No campaigns.",

  emiTitle: "EMI Display",
  emiBefore: "EMI is display-only — there is no gateway and the charge amount does not change. Configuration: Admin → Settings → Payment — keys: ",
  emiAfter: ". No BNPL provider exists in the system, so BNPL is never shown anywhere.",

  campTitle: "Seasonal Campaigns & Exit-Intent Popup",
  campIntro:
    "Pick a template and fill its slots — products come from the real catalogue (category / tag / live flash sale), and the coupon code must exist in the real Coupon list. The countdown shows only when an end date is set.",
  campReasonRequired: "A reason is required to save.",
  campSaved: "Saved. It will appear on the storefront at /campaign/<slug> (while active).",
  campHeadlineBnLabel: "Headline (Bangla, empty = default: “{headline}”)",
  campHeadlineEnLabel: "Headline (English, optional)",
  campSubBnLabel: "Sub-text (Bangla, optional)",
  campSourceLabel: "Product source",
  campSourceCategory: "Category",
  campSourceTag: "Product tag",
  campSourceFlash: "Live flash sale",
  campSourceValueLabel: "Source value",
  campTagPlaceholder: "e.g. eid",
  campFlashNote: "Whichever flash sale is live then",
  campCouponLabel: "Coupon code (optional, must exist)",
  campCouponPlaceholder: "e.g. EID10",
  campCouponWarning: "Warning: this code is currently {reason} — it will not be shown on the page.",
  campEndsLabel: "End date (optional — for the countdown)",
  exitTitle: "Exit-Intent Popup",
  exitIntro:
    "On desktop at the exit gesture, on mobile after 60 seconds — at most once per session, and not again for 7 days once closed. Never on checkout/account pages.",
  exitHeadlineLabel: "Headline (Bangla)",
  exitBodyLabel: "Body text (Bangla)",
  exitCouponPlaceholder: "e.g. WELCOME10",
  reasonLabel: "Reason for change (required, kept in the audit log)",
  reasonPlaceholder: "e.g. Launching the Eid campaign",
  saveAll: "Save all",
};

export const MECHANICS_STRINGS: Record<Locale, MechanicsStrings> = { bn, en };
