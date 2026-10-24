/**
 * Legal + info page content — Agent 29 (Storefront Legal + Info Pages).
 *
 * ⚠️ DRAFT TEMPLATE CONTENT — NOT LEGAL ADVICE.
 * Every text in this file is a draft template written for a typical
 * Bangladesh ecommerce store. The store owner MUST have all legal pages
 * reviewed (ideally by a qualified lawyer) and must replace every
 * PLACEHOLDER before the site goes live. Do not treat this content as
 * legal advice or as a final policy.
 *
 * Structure: Bangla (bn) is the default/primary locale, English (en) is
 * the fallback, matching the platform i18n rule (bn default, en fallback).
 * Pages render from this file only — when the CMS is wired, this content
 * moves into CmsPage rows with the same shape.
 */
import { formatBdt } from "@advance-ecommerce/validators";

export type LegalLocale = "bn" | "en";

export interface LegalSection {
  heading: string;
  paragraphs: string[];
}

export interface LegalPageContent {
  slug: string;
  title: string;
  description: string;
  /** Fixed draft date string (ISO date). Owner updates it on review. */
  lastUpdatedDraft: string;
  /** Always true for this template file — pages show a DRAFT badge. */
  isDraft: true;
  sections: LegalSection[];
}

/** Fixed draft "last updated" date for every legal page in this file. */
export const LEGAL_LAST_UPDATED_DRAFT = "2026-10-24";

/**
 * Shipping charges come from the seeded shipping zones (seed.ts):
 * Inside Dhaka 6000 poisha, Outside Dhaka 12000 poisha.
 * NEVER hardcode a different amount in page text — change the zone /
 * this config instead, so the policy page can never conflict with
 * checkout.
 */
export const SHIPPING_ZONE_CONFIG = {
  insideDhakaPoisha: 6000,
  outsideDhakaPoisha: 12000,
  insideDhakaDeliveryDaysBn: "১–২ কর্মদিবস",
  insideDhakaDeliveryDaysEn: "1–2 working days",
  outsideDhakaDeliveryDaysBn: "২–৫ কর্মদিবস",
  outsideDhakaDeliveryDaysEn: "2–5 working days",
} as const;

/**
 * Contact placeholders — the owner MUST replace these before live.
 * The phone is deliberately NOT a real-looking number.
 */
export const CONTACT_PLACEHOLDERS = {
  phoneDisplay: "01XXX-XXXXXX",
  emailDisplay: "PLACEHOLDER — shop@example.com",
  addressDisplayBn: "PLACEHOLDER — দোকানের ঠিকানা এখানে বসাতে হবে",
  addressDisplayEn: "PLACEHOLDER — shop address goes here",
  hoursBn: "PLACEHOLDER — সকাল ৯টা – রাত ৯টা (উদাহরণ)",
  hoursEn: "PLACEHOLDER — 9 AM – 9 PM (example)",
} as const;

/** Return window used by the refund policy — keep in sync with the
 *  order flow: DELIVERED -> RETURN_REQUESTED (orders/state-machine.ts). */
export const RETURN_POLICY_CONFIG = {
  returnRequestWindowDays: 7,
  inspectionDaysBn: "২–৩ কর্মদিবস",
  inspectionDaysEn: "2–3 working days",
  refundProcessingDaysBn: "৩–৭ কর্মদিবস",
  refundProcessingDaysEn: "3–7 working days",
} as const;

// ------------------------------------------------------------------
// Privacy Policy
// ------------------------------------------------------------------

export const PRIVACY_CONTENT: Record<LegalLocale, LegalPageContent> = {
  bn: {
    slug: "privacy",
    title: "গোপনীয়তা নীতি",
    description:
      "আমরা আপনার কোন তথ্য সংগ্রহ করি, কেন করি এবং আপনার অধিকার কী — গোপনীয়তা নীতি।",
    lastUpdatedDraft: LEGAL_LAST_UPDATED_DRAFT,
    isDraft: true,
    sections: [
      {
        heading: "আমরা যেসব তথ্য সংগ্রহ করি",
        paragraphs: [
          "অর্ডার করার সময় আমরা আপনার নাম, মোবাইল নম্বর এবং ডেলিভারি ঠিকানা (বিভাগ, জেলা, উপজেলা ও বিস্তারিত ঠিকানা) সংগ্রহ করি। ইমেইল দেওয়া ঐচ্ছিক — মোবাইল নম্বরই প্রধান যোগাযোগের মাধ্যম।",
          "পেমেন্টের ক্ষেত্রে আমরা শুধু লেনদেনের তথ্য (ট্রান্সাকশন আইডি, পরিমাণ, মাধ্যম) রাখি। আপনার bKash/Nagad পিন বা ব্যাংক পাসওয়ার্ড আমরা কখনোই সংগ্রহ বা সংরক্ষণ করি না — পেমেন্ট সরাসরি পেমেন্ট গেটওয়ের মাধ্যমে হয়।",
          "ওয়েবসাইট ব্যবহারের সময় ডিভাইস ও ব্রাউজারের কিছু কারিগরি তথ্য (যেমন IP ঠিকানা, ব্রাউজারের ধরন) স্বয়ংক্রিয়ভাবে রেকর্ড হতে পারে।",
        ],
      },
      {
        heading: "মোবাইল নম্বর ও ঠিকানা কীভাবে ব্যবহার হয়",
        paragraphs: [
          "আপনার মোবাইল নম্বর ব্যবহার হয় অর্ডার নিশ্চিত করতে, ডেলিভারির জন্য কল/SMS করতে এবং অর্ডারের আপডেট জানাতে। কুরিয়ার কোম্পানিকে ডেলিভারির জন্য প্রয়োজনীয় নাম, নম্বর ও ঠিকানা দেওয়া হয় — এর বাইরে তৃতীয় পক্ষের কাছে বিক্রি করা হয় না।",
          "আমাদের টিমের ড্যাশবোর্ডে আপনার পুরো নম্বর শুধুমাত্র অনুমতিপ্রাপ্ত কর্মীরাই দেখতে পারেন; বাকি জায়গায় নম্বর আংশিক লুকানো (masked) থাকে।",
        ],
      },
      {
        heading: "ট্র্যাকিং, কুকি ও বিজ্ঞাপন পরিমাপ",
        paragraphs: [
          "আপনার সম্মতি থাকলে আমরা ওয়েবসাইটের ব্যবহার বুঝতে এবং বিজ্ঞাপনের ফল মাপতে Meta Pixel ও সার্ভার-সাইড Conversions API (CAPI) ব্যবহার করি। ব্রাউজার ও সার্ভার একই ইভেন্ট পাঠালে ডুপ্লিকেট এড়াতে একটি অভিন্ন event ID ব্যবহার হয়।",
          "CAPI-তে পাঠানোর আগে আপনার ফোন নম্বর ও ইমেইল SHA-256 হ্যাশ করা হয় — কাঁচা (plain) নম্বর বা ইমেইল বিজ্ঞাপন প্ল্যাটফর্মে পাঠানো হয় না।",
          "সম্মতি না দিলে মার্কেটিং ট্র্যাকিং বন্ধ থাকে; শুধুমাত্র সাইট চালানোর জন্য অত্যাবশ্যক কারিগরি তথ্য প্রক্রিয়া হয়। আপনি যেকোনো সময় কুকি ব্যানার থেকে সম্মতি বদলাতে পারেন।",
        ],
      },
      {
        heading: "তথ্য সংরক্ষণ ও নিরাপত্তা",
        paragraphs: [
          "অর্ডার ও লেনদেনের রেকর্ড হিসাব ও আইনি প্রয়োজনে নির্ধারিত সময় পর্যন্ত সংরক্ষণ করা হয়। তৃতীয় পক্ষের সেবার (পেমেন্ট, SMS, স্টোরেজ) গোপন তথ্য এনক্রিপ্ট করে সংরক্ষণ করা হয় এবং কর্মীদের প্রবেশাধিকার ভূমিকা (role) অনুযায়ী সীমিত।",
        ],
      },
      {
        heading: "আপনার অধিকার",
        paragraphs: [
          "আপনি আপনার তথ্য দেখতে, ভুল থাকলে সংশোধন করতে এবং আইন অনুযায়ী প্রযোজ্য ক্ষেত্রে মুছে ফেলার অনুরোধ করতে পারেন। অনুরোধ করতে যোগাযোগ পেজের মাধ্যমে বা আমাদের দেওয়া যোগাযোগের মাধ্যমে জানান — আমরা যাচাই করে প্রয়োজনীয় ব্যবস্থা নেব।",
          "বিপণন SMS/বার্তা পেতে না চাইলে যেকোনো সময় আমাদের জানালে তা বন্ধ করা হবে।",
        ],
      },
      {
        heading: "যোগাযোগ",
        paragraphs: [
          "গোপনীয়তা সংক্রান্ত যেকোনো প্রশ্নে যোগাযোগ পেজ (/contact) ব্যবহার করুন। এই পেজে দেওয়া ফোন/ইমেইল বর্তমানে PLACEHOLDER — লাইভ হওয়ার আগে দোকানের আসল যোগাযোগের তথ্য বসানো হবে।",
        ],
      },
    ],
  },
  en: {
    slug: "privacy",
    title: "Privacy Policy",
    description:
      "What information we collect, why we collect it, and your rights — our privacy policy.",
    lastUpdatedDraft: LEGAL_LAST_UPDATED_DRAFT,
    isDraft: true,
    sections: [
      {
        heading: "Information we collect",
        paragraphs: [
          "When you order, we collect your name, mobile number and delivery address (division, district, upazila and full address line). Email is optional — your mobile number is the primary contact.",
          "For payments we keep only transaction data (transaction ID, amount, method). We never collect or store your bKash/Nagad PIN or bank password — payments happen directly through the payment gateway.",
          "Some technical data (such as IP address and browser type) may be recorded automatically while you use the website.",
        ],
      },
      {
        heading: "How your phone number and address are used",
        paragraphs: [
          "Your mobile number is used to confirm orders, to call/SMS about delivery, and to send order updates. The courier receives the name, number and address needed for delivery only — your data is never sold to third parties.",
          "In our team dashboard, your full number is visible only to staff with permission; everywhere else it stays masked.",
        ],
      },
      {
        heading: "Tracking, cookies and ad measurement",
        paragraphs: [
          "With your consent, we use Meta Pixel and the server-side Conversions API (CAPI) to understand website usage and measure advertising. Browser and server events share one event ID so duplicates are removed.",
          "Before anything is sent to CAPI, your phone number and email are SHA-256 hashed — raw (plain) numbers or emails are never sent to ad platforms.",
          "If you decline, marketing tracking stays off; only strictly necessary technical processing continues. You can change your choice anytime from the cookie banner.",
        ],
      },
      {
        heading: "Storage and security",
        paragraphs: [
          "Order and transaction records are kept for the period required for accounting and legal purposes. Third-party service credentials are stored encrypted, and staff access is limited by role.",
        ],
      },
      {
        heading: "Your rights",
        paragraphs: [
          "You may see your information, correct mistakes, and — where the law applies — request deletion. Reach us through the contact page and we will verify and act on your request.",
          "Tell us anytime if you no longer want marketing SMS/messages and we will stop.",
        ],
      },
      {
        heading: "Contact",
        paragraphs: [
          "For any privacy question, use the contact page (/contact). The phone/email shown there are currently PLACEHOLDER values and will be replaced with the shop's real contact details before launch.",
        ],
      },
    ],
  },
};

// ------------------------------------------------------------------
// Terms & Conditions
// ------------------------------------------------------------------

export const TERMS_CONTENT: Record<LegalLocale, LegalPageContent> = {
  bn: {
    slug: "terms",
    title: "শর্তাবলি",
    description: "এই ওয়েবসাইটে কেনাকাটার শর্তাবলি — অর্ডার, মূল্য, COD ও অ্যাকাউন্ট।",
    lastUpdatedDraft: LEGAL_LAST_UPDATED_DRAFT,
    isDraft: true,
    sections: [
      {
        heading: "অর্ডার করা",
        paragraphs: [
          "অর্ডার করতে সঠিক নাম, সচল মোবাইল নম্বর ও পূর্ণ ডেলিভারি ঠিকানা দিন। ভুল তথ্যের কারণে ডেলিভারি ব্যর্থ হলে তার দায়ভার ক্রেতার।",
          "অর্ডার দেওয়ার পর আমাদের টিম ফোনে নিশ্চিত করতে পারেন। স্টক শেষ হয়ে গেলে বা মূল্যে ভুল থাকলে আমরা ফোন করে জানিয়ে অর্ডার পরিবর্তন বা বাতিলের প্রস্তাব দেব — আপনার সম্মতি ছাড়া মূল্য বদলানো হবে না।",
          "অগ্রিম পেমেন্ট ছাড়া বড় অর্ডার বা ঝুঁকিপূর্ণ মনে হলে আমরা আংশিক অগ্রিম চাইতে পারি; রাজি না হলে অর্ডার বাতিল হবে।",
        ],
      },
      {
        heading: "মূল্য ও মুদ্রা",
        paragraphs: [
          "সব মূল্য বাংলাদেশি টাকায় (BDT/৳) দেখানো হয়। পণ্যের মূল্যের সঙ্গে ডেলিভারি চার্জ আলাদা যোগ হয়, যা চেকআউটে পরিষ্কারভাবে দেখানো হয়।",
          "অফার/কুপনের শর্ত প্রতিটি অফারের সঙ্গে প্রযোজ্য; একটি অর্ডারে একাধিক কুপন একসঙ্গে ব্যবহার নাও হতে পারে।",
        ],
      },
      {
        heading: "ক্যাশ অন ডেলিভারি (COD) ও পেমেন্ট",
        paragraphs: [
          "ক্যাশ অন ডেলিভারিতে পণ্য হাতে পেয়ে ডেলিভারি কর্মীকে মূল্য পরিশোধ করুন। পণ্য নেওয়ার আগে প্যাকেজের বাইরের অবস্থা দেখে নিন।",
          "মোবাইল ব্যাংকিং (bKash/Nagad/Rocket/Upay) বা গেটওয়ের মাধ্যমে পেমেন্ট করলে ট্রান্সাকশন আইডি সংরক্ষণ করুন — যাচাইয়ে কাজে লাগতে পারে।",
        ],
      },
      {
        heading: "অ্যাকাউন্ট",
        paragraphs: [
          "অ্যাকাউন্ট খুললে আপনার লগইন তথ্যের গোপনীয়তা রক্ষার দায়িত্ব আপনার। অ্যাকাউন্ট দিয়ে করা অর্ডার আপনার অর্ডার হিসেবে গণ্য হবে।",
          "অতিথি (guest) হিসেবেও অর্ডার করা যায় — সেক্ষেত্রে অর্ডার ট্র্যাকিংয়ে অর্ডার নম্বর ও মোবাইল নম্বর লাগবে।",
        ],
      },
      {
        heading: "বাতিল, রিটার্ন ও রিফান্ড",
        paragraphs: [
          "পণ্য পাঠানোর (SHIPPED) আগে পর্যন্ত ফোন করে অর্ডার বাতিল করা যায়। রিটার্ন ও রিফান্ডের বিস্তারিত নিয়ম রিফান্ড নীতিতে (/refund-policy) দেওয়া আছে, যা এই শর্তাবলির অংশ।",
        ],
      },
      {
        heading: "দায়বদ্ধতার সীমা ও পরিবর্তন",
        paragraphs: [
          "কুরিয়ার বা অনিবার্য কারণে ডেলিভারিতে দেরি হতে পারে; আমরা সর্বোচ্চ চেষ্টা করব জানিয়ে দিতে। এই শর্তাবলি সময়ে সময়ে হালনাগাদ হতে পারে — হালনাগাদের তারিখ এই পেজে দেখানো হবে।",
        ],
      },
    ],
  },
  en: {
    slug: "terms",
    title: "Terms & Conditions",
    description: "Terms for shopping on this website — orders, pricing, COD and accounts.",
    lastUpdatedDraft: LEGAL_LAST_UPDATED_DRAFT,
    isDraft: true,
    sections: [
      {
        heading: "Ordering",
        paragraphs: [
          "Provide a correct name, an active mobile number and a full delivery address. Failed delivery due to wrong information is the buyer's responsibility.",
          "Our team may call to confirm your order. If an item is out of stock or a price was wrong, we will call and propose a change or cancellation — the price will never be changed without your agreement.",
          "For large orders, or orders that look risky, we may ask for a partial advance; if you decline, the order is cancelled.",
        ],
      },
      {
        heading: "Prices and currency",
        paragraphs: [
          "All prices are in Bangladeshi Taka (BDT/৳). Delivery charge is added separately and shown clearly at checkout.",
          "Offer/coupon terms apply per offer; multiple coupons may not combine on one order.",
        ],
      },
      {
        heading: "Cash on Delivery (COD) and payments",
        paragraphs: [
          "With Cash on Delivery, pay the delivery person when you receive the product. Please check the outer condition of the package before accepting.",
          "If you pay by mobile banking (bKash/Nagad/Rocket/Upay) or a gateway, keep the transaction ID — it may be needed for verification.",
        ],
      },
      {
        heading: "Accounts",
        paragraphs: [
          "If you open an account, keeping your login details secret is your responsibility. Orders placed from your account count as your orders.",
          "You can also order as a guest — order tracking then needs your order number and mobile number.",
        ],
      },
      {
        heading: "Cancellation, returns and refunds",
        paragraphs: [
          "You can cancel by phone any time before the order is SHIPPED. Return and refund rules are in the Refund Policy (/refund-policy), which is part of these terms.",
        ],
      },
      {
        heading: "Liability and changes",
        paragraphs: [
          "Delivery may be delayed by the courier or unavoidable causes; we will do our best to inform you. These terms may be updated from time to time — the update date is shown on this page.",
        ],
      },
    ],
  },
};

// ------------------------------------------------------------------
// Refund / Return Policy — aligned with orders/state-machine.ts:
// DELIVERED -> RETURN_REQUESTED -> RETURNING -> RETURNED -> REFUNDED
// (or EXCHANGED). The return request must be raised while the order is
// in DELIVERED state, within RETURN_POLICY_CONFIG.returnRequestWindowDays.
// ------------------------------------------------------------------

export const REFUND_POLICY_CONTENT: Record<LegalLocale, LegalPageContent> = {
  bn: {
    slug: "refund-policy",
    title: "রিটার্ন ও রিফান্ড নীতি",
    description:
      "পণ্য ফেরত দেওয়া ও টাকা ফেরত পাওয়ার নিয়ম — সময়সীমা, শর্ত ও রিফান্ডের মাধ্যম।",
    lastUpdatedDraft: LEGAL_LAST_UPDATED_DRAFT,
    isDraft: true,
    sections: [
      {
        heading: "রিটার্নের অনুরোধ করার সময়সীমা",
        paragraphs: [
          `পণ্য ডেলিভারি পাওয়ার (DELIVERED) পর ${RETURN_POLICY_CONFIG.returnRequestWindowDays} দিনের মধ্যে রিটার্নের অনুরোধ করতে হবে। সময়সীমা পেরিয়ে গেলে রিটার্ন গ্রহণ করা যাবে না, তবে ওয়ারেন্টিযুক্ত পণ্যের ক্ষেত্রে ওয়ারেন্টির শর্ত প্রযোজ্য হবে।`,
          "অনুরোধ করতে অর্ডার নম্বরসহ আমাদের ফোন করুন বা যোগাযোগ পেজে জানান। অনুরোধ গৃহীত হলে কুরিয়ার/রাইডার পণ্য সংগ্রহ করবে (RETURNING), পণ্য আমাদের কাছে পৌঁছালে (RETURNED) যাচাই শুরু হবে।",
        ],
      },
      {
        heading: "যেসব কারণে রিটার্ন গ্রহণ করা হয়",
        paragraphs: [
          "ভুল পণ্য, ভুল সাইজ/রং (অর্ডারের সঙ্গে মিল না থাকলে), ক্ষতিগ্রস্ত বা ত্রুটিপূর্ণ পণ্য, এবং বিজ্ঞাপনের বিবরণের সঙ্গে গুরুতর অমিল — এসব ক্ষেত্রে রিটার্ন ও পূর্ণ রিফান্ড প্রযোজ্য।",
          "মন বদলের কারণে রিটার্নও কিছু পণ্যে সম্ভব, তবে পণ্য অবশ্যই অব্যবহৃত, অক্ষত ও মূল প্যাকেজিংসহ থাকতে হবে; এ ক্ষেত্রে ফেরত পাঠানোর ডেলিভারি চার্জ ক্রেতাকে বহন করতে হতে পারে।",
          "ব্যক্তিগত যত্নের পণ্য, অন্তর্বাস, খোলা/ব্যবহৃত পণ্য এবং ডিজিটাল পণ্য (সক্রিয় হয়ে গেলে) স্বাস্থ্য ও নিরাপত্তার কারণে ফেরত নেওয়া হয় না — পণ্যের পেজে ব্যতিক্রম থাকলে সেটাই প্রযোজ্য।",
        ],
      },
      {
        heading: "যাচাই ও সিদ্ধান্ত",
        paragraphs: [
          `ফেরত আসা পণ্য যাচাই করতে ${RETURN_POLICY_CONFIG.inspectionDaysBn} লাগতে পারে। যাচাইয়ে শর্ত পূরণ হলে রিফান্ড অনুমোদিত হবে, অথবা আপনি চাইলে একই মূল্যের অন্য পণ্য দিয়ে বদলি (EXCHANGED) করা যাবে।`,
          "শর্ত পূরণ না হলে পণ্য আপনার ঠিকানায় ফেরত পাঠানো হবে এবং কারণ জানিয়ে দেওয়া হবে।",
        ],
      },
      {
        heading: "রিফান্ডের মাধ্যম ও সময়",
        paragraphs: [
          `অনুমোদনের পর ${RETURN_POLICY_CONFIG.refundProcessingDaysBn}-এর মধ্যে রিফান্ড দেওয়া হয়। COD অর্ডারের রিফান্ড আপনার পছন্দের মাধ্যমে দেওয়া হয় — bKash, Nagad অথবা ব্যাংক অ্যাকাউন্ট। যে মাধ্যমে অগ্রিম পেমেন্ট করেছিলেন, সাধারণত সেই মাধ্যমেই রিফান্ড যায়।`,
          "রিফান্ডের পরিমাণ = ফেরত পণ্যের মূল্য। আমরা দোষী না হলে ডেলিভারি চার্জ ফেরতযোগ্য নয়; আমাদের ভুলে রিটার্ন হলে ডেলিভারি চার্জসহ পূর্ণ টাকা ফেরত দেওয়া হবে।",
        ],
      },
      {
        heading: "অর্ডার বাতিলের রিফান্ড",
        paragraphs: [
          "পণ্য পাঠানোর আগে বাতিল করলে অগ্রিম পেমেন্টের সম্পূর্ণ টাকা একই মাধ্যমে ফেরত দেওয়া হবে। পেমেন্ট গেটওয়ের প্রক্রিয়াকরণের কারণে ব্যাংক রিফান্ডে অতিরিক্ত সময় লাগতে পারে।",
        ],
      },
    ],
  },
  en: {
    slug: "refund-policy",
    title: "Return & Refund Policy",
    description:
      "Rules for returning products and getting refunds — windows, conditions and refund methods.",
    lastUpdatedDraft: LEGAL_LAST_UPDATED_DRAFT,
    isDraft: true,
    sections: [
      {
        heading: "Return request window",
        paragraphs: [
          `You must request a return within ${RETURN_POLICY_CONFIG.returnRequestWindowDays} days of delivery (order status DELIVERED). After the window, returns cannot be accepted, though warranty terms still apply to warranted products.`,
          "To request, call us or use the contact page with your order number. Once accepted, a courier/rider collects the product (RETURNING); inspection starts when it reaches us (RETURNED).",
        ],
      },
      {
        heading: "Accepted return reasons",
        paragraphs: [
          "Wrong item, wrong size/colour (not matching the order), damaged or faulty products, and serious mismatch with the product description qualify for a return and full refund.",
          "Change-of-mind returns are possible for some products if the item is unused, intact and in original packaging; the return delivery charge may be borne by the buyer.",
          "For health and safety reasons, personal-care items, innerwear, opened/used items and activated digital goods cannot be returned — unless the product page states otherwise.",
        ],
      },
      {
        heading: "Inspection and decision",
        paragraphs: [
          `Inspection of a returned item can take ${RETURN_POLICY_CONFIG.inspectionDaysEn}. If the conditions are met, the refund is approved — or, if you prefer, the item is exchanged (EXCHANGED) for another of the same value.`,
          "If conditions are not met, the item is sent back to your address and we will explain why.",
        ],
      },
      {
        heading: "Refund method and time",
        paragraphs: [
          `Approved refunds are paid within ${RETURN_POLICY_CONFIG.refundProcessingDaysEn}. COD order refunds go to your choice of bKash, Nagad or bank account. Advance payments are normally refunded to the same method used to pay.`,
          "Refund amount = the price of the returned item. The delivery charge is not refundable unless the return was our fault — in that case the full amount including delivery charge is refunded.",
        ],
      },
      {
        heading: "Cancellation refunds",
        paragraphs: [
          "If you cancel before the order is shipped, any advance payment is refunded in full to the same method. Bank refunds may take extra time due to gateway processing.",
        ],
      },
    ],
  },
};

// ------------------------------------------------------------------
// Shipping Policy — charges come from SHIPPING_ZONE_CONFIG (seed zones).
// ------------------------------------------------------------------

export const SHIPPING_POLICY_CONTENT: Record<LegalLocale, LegalPageContent> = {
  bn: {
    slug: "shipping-policy",
    title: "ডেলিভারি নীতি",
    description: "ডেলিভারি চার্জ, সময় ও প্রক্রিয়া — ঢাকার ভিতরে ও বাইরে।",
    lastUpdatedDraft: LEGAL_LAST_UPDATED_DRAFT,
    isDraft: true,
    sections: [
      {
        heading: "ডেলিভারি চার্জ ও সময়",
        paragraphs: [
          `ঢাকার ভিতরে ডেলিভারি চার্জ ${formatBdt(SHIPPING_ZONE_CONFIG.insideDhakaPoisha)}, আনুমানিক সময় ${SHIPPING_ZONE_CONFIG.insideDhakaDeliveryDaysBn}। ঢাকার বাইরে (সারাদেশ) ডেলিভারি চার্জ ${formatBdt(SHIPPING_ZONE_CONFIG.outsideDhakaPoisha)}, আনুমানিক সময় ${SHIPPING_ZONE_CONFIG.outsideDhakaDeliveryDaysBn}।`,
          "ওজন/আকারের কারণে কিছু বড় পণ্যে অতিরিক্ত চার্জ লাগতে পারে — সেক্ষেত্রে চেকআউটে বা ফোনে আগেই জানিয়ে দেওয়া হবে, কখনোই লুকানো চার্জ যোগ হবে না। অফার চলাকালে কিছু অর্ডারে ফ্রি ডেলিভারি প্রযোজ্য হতে পারে।",
        ],
      },
      {
        heading: "ডেলিভারি প্রক্রিয়া",
        paragraphs: [
          "অর্ডার নিশ্চিত হওয়ার পর পণ্য প্যাক করে কুরিয়ারে দেওয়া হয় (Steadfast, Pathao, RedX, eCourier প্রভৃতি) অথবা ঢাকার ভিতরে আমাদের নিজস্ব রাইডার ডেলিভারি করতে পারে।",
          "ডেলিভারির সময় ডেলিভারি কর্মী ফোন করবেন — ফোন সচল রাখুন। ঠিকানায় পৌঁছে যোগাযোগ না পাওয়া গেলে পণ্য ফেরত আসতে পারে এবং পুনরায় পাঠাতে অতিরিক্ত চার্জ লাগতে পারে।",
          "অর্ডার নম্বর ও মোবাইল নম্বর দিয়ে /track পেজে যেকোনো সময় অর্ডারের অবস্থা দেখা যায়।",
        ],
      },
      {
        heading: "দেরি ও সমস্যা",
        paragraphs: [
          "আবহাওয়া, যানজট, কুরিয়ারের সমস্যা বা অনিবার্য কারণে ডেলিভারিতে দেরি হতে পারে। অতিরিক্ত দেরি হলে আমরা ফোন/SMS-এ জানিয়ে দেব।",
          "প্যাকেজ ক্ষতিগ্রস্ত অবস্থায় পেলে ডেলিভারি কর্মীর সামনেই ছবি তুলে আমাদের জানান — রিটার্ন ও রিফান্ড নীতি অনুযায়ী ব্যবস্থা নেওয়া হবে।",
        ],
      },
    ],
  },
  en: {
    slug: "shipping-policy",
    title: "Shipping Policy",
    description: "Delivery charges, times and process — inside and outside Dhaka.",
    lastUpdatedDraft: LEGAL_LAST_UPDATED_DRAFT,
    isDraft: true,
    sections: [
      {
        heading: "Delivery charges and times",
        paragraphs: [
          `Inside Dhaka the delivery charge is ${formatBdt(SHIPPING_ZONE_CONFIG.insideDhakaPoisha)}, estimated time ${SHIPPING_ZONE_CONFIG.insideDhakaDeliveryDaysEn}. Outside Dhaka (nationwide) the charge is ${formatBdt(SHIPPING_ZONE_CONFIG.outsideDhakaPoisha)}, estimated time ${SHIPPING_ZONE_CONFIG.outsideDhakaDeliveryDaysEn}.`,
          "Some large items may carry an extra charge for weight/size — it is always shown at checkout or confirmed by phone beforehand; hidden charges are never added. Some orders may qualify for free delivery during offers.",
        ],
      },
      {
        heading: "Delivery process",
        paragraphs: [
          "After confirmation, the order is packed and handed to a courier (Steadfast, Pathao, RedX, eCourier, etc.), or delivered by our own rider inside Dhaka.",
          "The delivery person will call you — please keep your phone reachable. If you cannot be reached at the address, the parcel may return and re-delivery may cost extra.",
          "You can check your order status anytime on the /track page with your order number and mobile number.",
        ],
      },
      {
        heading: "Delays and problems",
        paragraphs: [
          "Weather, traffic, courier issues or unavoidable causes may delay delivery. We will inform you by phone/SMS if a delay is significant.",
          "If a package arrives damaged, take a photo in front of the delivery person and tell us — the Return & Refund Policy will be applied.",
        ],
      },
    ],
  },
};

// ------------------------------------------------------------------
// About — PLACEHOLDER brand story, owner must replace.
// ------------------------------------------------------------------

export const ABOUT_CONTENT: Record<LegalLocale, LegalPageContent> = {
  bn: {
    slug: "about",
    title: "আমাদের সম্পর্কে",
    description: "আমাদের দোকান ও গল্প — PLACEHOLDER, মালিককে নিজের গল্প দিয়ে বদলাতে হবে।",
    lastUpdatedDraft: LEGAL_LAST_UPDATED_DRAFT,
    isDraft: true,
    sections: [
      {
        heading: "PLACEHOLDER — আমাদের গল্প",
        paragraphs: [
          "PLACEHOLDER: এই জায়গায় দোকানের আসল গল্প বসাতে হবে — কবে শুরু, কী বিক্রি হয়, কেন ক্রেতা আস্থা রাখবেন। নিচের লেখাটি শুধু উদাহরণ কাঠামো।",
          "আমরা বাংলাদেশের ক্রেতাদের জন্য মানসম্মত পণ্য সঠিক দামে পৌঁছে দিতে কাজ করি। প্রতিটি অর্ডার যত্নে প্যাক করা হয়, ফোনে নিশ্চিত করা হয় এবং ডেলিভারি পর্যন্ত আপডেট দেওয়া হয়।",
        ],
      },
      {
        heading: "PLACEHOLDER — কেন আমাদের থেকে কিনবেন",
        paragraphs: [
          "PLACEHOLDER: নিজের শক্তির জায়গাগুলো এখানে লিখতে হবে। উদাহরণ: সারা দেশে ক্যাশ অন ডেলিভারি, সহজ রিটার্ন, ফোনে অর্ডার সাপোর্ট, যাচাই করা পণ্য।",
        ],
      },
    ],
  },
  en: {
    slug: "about",
    title: "About Us",
    description: "Our shop and story — PLACEHOLDER, the owner must replace with their real story.",
    lastUpdatedDraft: LEGAL_LAST_UPDATED_DRAFT,
    isDraft: true,
    sections: [
      {
        heading: "PLACEHOLDER — Our story",
        paragraphs: [
          "PLACEHOLDER: Replace this with the shop's real story — when it started, what it sells, and why buyers can trust it. The text below is only a structural example.",
          "We work to deliver quality products at fair prices to buyers across Bangladesh. Every order is packed with care, confirmed by phone and updated until delivery.",
        ],
      },
      {
        heading: "PLACEHOLDER — Why buy from us",
        paragraphs: [
          "PLACEHOLDER: Write your real strengths here. Example: nationwide Cash on Delivery, easy returns, phone order support, verified products.",
        ],
      },
    ],
  },
};

// ------------------------------------------------------------------
// Contact — placeholders only; form submits nowhere (demo outline).
// ------------------------------------------------------------------

export interface ContactContent {
  title: string;
  description: string;
  intro: string;
  phoneLabel: string;
  emailLabel: string;
  addressLabel: string;
  hoursLabel: string;
  formTitle: string;
  formNote: string;
  nameLabel: string;
  phoneFieldLabel: string;
  messageLabel: string;
  submitLabel: string;
  submitDemoNotice: string;
}

export const CONTACT_CONTENT: Record<LegalLocale, ContactContent> = {
  bn: {
    title: "যোগাযোগ",
    description: "আমাদের সঙ্গে যোগাযোগ করুন — ফোন, ইমেইল বা বার্তা পাঠান।",
    intro:
      "অর্ডার, ডেলিভারি বা রিটার্ন নিয়ে যেকোনো প্রশ্নে আমাদের জানান। নিচের ফোন/ইমেইল/ঠিকানা বর্তমানে PLACEHOLDER — লাইভ হওয়ার আগে দোকানের আসল তথ্য বসানো হবে।",
    phoneLabel: "ফোন",
    emailLabel: "ইমেইল",
    addressLabel: "ঠিকানা",
    hoursLabel: "সময়",
    formTitle: "বার্তা পাঠান",
    formNote:
      "এই ফর্মটি এখন ডেমো — বার্তা কোথাও পাঠানো হয় না। জরুরি প্রয়োজনে উপরের নম্বরে ফোন করুন।",
    nameLabel: "আপনার নাম",
    phoneFieldLabel: "মোবাইল নম্বর",
    messageLabel: "বার্তা",
    submitLabel: "পাঠান",
    submitDemoNotice: "ডেমো ফর্ম — বার্তাটি পাঠানো হয়নি। (ফর্মটি এখন কোথাও সাবমিট হয় না।)",
  },
  en: {
    title: "Contact Us",
    description: "Get in touch with us — by phone, email or message.",
    intro:
      "Tell us about any question on orders, delivery or returns. The phone/email/address below are currently PLACEHOLDER values and will be replaced with the shop's real details before launch.",
    phoneLabel: "Phone",
    emailLabel: "Email",
    addressLabel: "Address",
    hoursLabel: "Hours",
    formTitle: "Send a message",
    formNote:
      "This form is a demo for now — messages are not sent anywhere. For urgent needs, please call the number above.",
    nameLabel: "Your name",
    phoneFieldLabel: "Mobile number",
    messageLabel: "Message",
    submitLabel: "Send",
    submitDemoNotice: "Demo form — your message was not sent. (This form does not submit anywhere yet.)",
  },
};

// ------------------------------------------------------------------
// FAQ — 10 questions (bn primary, en fallback).
// ------------------------------------------------------------------

export interface FaqItem {
  question: string;
  answer: string;
  linkHref?: string;
  linkLabel?: string;
}

export interface FaqContent {
  title: string;
  description: string;
  intro: string;
  items: FaqItem[];
}

export const FAQ_CONTENT: Record<LegalLocale, FaqContent> = {
  bn: {
    title: "সাধারণ জিজ্ঞাসা (FAQ)",
    description: "ক্রেতাদের সাধারণ প্রশ্নের উত্তর — COD, ডেলিভারি, রিটার্ন, পেমেন্ট ও ট্র্যাকিং।",
    intro: "সবচেয়ে বেশি জিজ্ঞাসা করা ১০টি প্রশ্নের উত্তর এখানে দেওয়া হলো। আরও জানতে যোগাযোগ পেজে বার্তা দিন।",
    items: [
      {
        question: "ক্যাশ অন ডেলিভারি (COD) আছে কি?",
        answer:
          "হ্যাঁ, সারা দেশে ক্যাশ অন ডেলিভারি আছে। পণ্য হাতে পেয়ে ডেলিভারি কর্মীকে টাকা দিলেই হবে। কিছু বড় বা ঝুঁকিপূর্ণ অর্ডারে আংশিক অগ্রিম লাগতে পারে — সেক্ষেত্রে ফোনে আগেই জানিয়ে দেওয়া হবে।",
      },
      {
        question: "ডেলিভারি পেতে কতদিন লাগবে?",
        answer: `ঢাকার ভিতরে আনুমানিক ${SHIPPING_ZONE_CONFIG.insideDhakaDeliveryDaysBn} এবং ঢাকার বাইরে ${SHIPPING_ZONE_CONFIG.outsideDhakaDeliveryDaysBn}। অর্ডার নিশ্চিত হওয়ার সময় থেকে এই সময় গণনা হয়।`,
      },
      {
        question: "ডেলিভারি চার্জ কত?",
        answer: `ঢাকার ভিতরে ${formatBdt(SHIPPING_ZONE_CONFIG.insideDhakaPoisha)} এবং ঢাকার বাইরে ${formatBdt(SHIPPING_ZONE_CONFIG.outsideDhakaPoisha)}। চার্জ চেকআউটে পরিষ্কারভাবে দেখানো হয়, কোনো লুকানো চার্জ নেই।`,
        linkHref: "/shipping-policy",
        linkLabel: "ডেলিভারি নীতি দেখুন",
      },
      {
        question: "পণ্য পছন্দ না হলে বা সমস্যা থাকলে ফেরত দিতে পারব?",
        answer: `হ্যাঁ। ডেলিভারির ${RETURN_POLICY_CONFIG.returnRequestWindowDays} দিনের মধ্যে রিটার্নের অনুরোধ করা যায়। ভুল/ক্ষতিগ্রস্ত/ত্রুটিপূর্ণ পণ্যে পূর্ণ রিফান্ড পাওয়া যাবে। বিস্তারিত শর্ত রিফান্ড নীতিতে আছে।`,
        linkHref: "/refund-policy",
        linkLabel: "রিটার্ন ও রিফান্ড নীতি দেখুন",
      },
      {
        question: "রিফান্ড কীভাবে ও কতদিনে পাব?",
        answer: `রিটার্ন করা পণ্য যাচাইয়ের পর অনুমোদন হলে ${RETURN_POLICY_CONFIG.refundProcessingDaysBn}-এর মধ্যে bKash, Nagad বা ব্যাংক অ্যাকাউন্টে রিফান্ড দেওয়া হয়। অগ্রিম পেমেন্টের ক্ষেত্রে সাধারণত একই মাধ্যমে ফেরত যায়।`,
      },
      {
        question: "কোন কোন মাধ্যমে পেমেন্ট করা যায়?",
        answer:
          "ক্যাশ অন ডেলিভারি ছাড়াও bKash, Nagad, Rocket, Upay এবং পেমেন্ট গেটওয়ের মাধ্যমে কার্ড/ব্যাংক পেমেন্ট করা যায় (যেগুলো চেকআউটে চালু থাকে)। পেমেন্টের সময় ট্রান্সাকশন আইডি সংরক্ষণ করুন।",
      },
      {
        question: "আমার অর্ডার কোথায় আছে, কীভাবে দেখব?",
        answer:
          "অর্ডার নম্বর ও অর্ডারের মোবাইল নম্বর দিয়ে ট্র্যাকিং পেজে অবস্থা দেখা যায় — কনফার্ম হয়েছে কিনা, কুরিয়ারে গেছে কিনা, ডেলিভারি হয়েছে কিনা।",
        linkHref: "/track",
        linkLabel: "অর্ডার ট্র্যাক করুন",
      },
      {
        question: "অর্ডার বাতিল বা পরিবর্তন করতে চাইলে কী করব?",
        answer:
          "পণ্য পাঠানোর (SHIPPED) আগে পর্যন্ত ফোন করে অর্ডার বাতিল বা পরিবর্তন করা যায়। পাঠানো হয়ে গেলে ডেলিভারি প্রত্যাখ্যান করলে কুরিয়ার চার্জ প্রযোজ্য হতে পারে।",
      },
      {
        question: "অর্ডার করতে কি অ্যাকাউন্ট খুলতেই হবে?",
        answer:
          "না। অতিথি হিসেবেও অর্ডার করা যায় — শুধু নাম, মোবাইল নম্বর ও ঠিকানা লাগে। অ্যাকাউন্ট থাকলে আগের অর্ডার ও ঠিকানা সহজে পাওয়া যায়।",
      },
      {
        question: "সাইজ/রং বদলাতে (exchange) পারব কি?",
        answer: `হ্যাঁ, স্টক থাকলে ডেলিভারির ${RETURN_POLICY_CONFIG.returnRequestWindowDays} দিনের মধ্যে অব্যবহৃত পণ্য সাইজ/রং বদলানো যায়। ফোন করে জানালে আমরা বদলির ব্যবস্থা করে দেব; মূল্যের পার্থক্য থাকলে তা সমন্বয় করা হবে।`,
      },
    ],
  },
  en: {
    title: "Frequently Asked Questions (FAQ)",
    description: "Answers to common buyer questions — COD, delivery, returns, payments and tracking.",
    intro: "Answers to the 10 most-asked questions. For anything else, message us from the contact page.",
    items: [
      {
        question: "Do you offer Cash on Delivery (COD)?",
        answer:
          "Yes, COD is available nationwide. Pay the delivery person when you receive the product. Some large or risky orders may need a partial advance — we will always tell you by phone first.",
      },
      {
        question: "How long does delivery take?",
        answer: `About ${SHIPPING_ZONE_CONFIG.insideDhakaDeliveryDaysEn} inside Dhaka and ${SHIPPING_ZONE_CONFIG.outsideDhakaDeliveryDaysEn} outside Dhaka, counted from order confirmation.`,
      },
      {
        question: "How much is the delivery charge?",
        answer: `${formatBdt(SHIPPING_ZONE_CONFIG.insideDhakaPoisha)} inside Dhaka and ${formatBdt(SHIPPING_ZONE_CONFIG.outsideDhakaPoisha)} outside Dhaka. The charge is shown clearly at checkout — there are no hidden charges.`,
        linkHref: "/shipping-policy",
        linkLabel: "See the shipping policy",
      },
      {
        question: "Can I return a product I don't like or that has a problem?",
        answer: `Yes. Returns can be requested within ${RETURN_POLICY_CONFIG.returnRequestWindowDays} days of delivery. Wrong, damaged or faulty items get a full refund. See the refund policy for full conditions.`,
        linkHref: "/refund-policy",
        linkLabel: "See the return & refund policy",
      },
      {
        question: "How and when do I get my refund?",
        answer: `After the returned item is inspected and approved, refunds are paid within ${RETURN_POLICY_CONFIG.refundProcessingDaysEn} to bKash, Nagad or a bank account. Advance payments are normally refunded to the same method.`,
      },
      {
        question: "Which payment methods can I use?",
        answer:
          "Besides Cash on Delivery, you can pay with bKash, Nagad, Rocket, Upay, and card/bank via the payment gateway (whichever is enabled at checkout). Keep your transaction ID after paying.",
      },
      {
        question: "Where is my order? How can I check?",
        answer:
          "Use your order number and the mobile number from the order on the tracking page to see the status — confirmed, with courier, or delivered.",
        linkHref: "/track",
        linkLabel: "Track your order",
      },
      {
        question: "How do I cancel or change my order?",
        answer:
          "Call us any time before the order is SHIPPED to cancel or change it. After shipping, refusing delivery may incur the courier charge.",
      },
      {
        question: "Do I have to open an account to order?",
        answer:
          "No. You can order as a guest — only your name, mobile number and address are needed. An account makes past orders and addresses easier to reuse.",
      },
      {
        question: "Can I exchange size or colour?",
        answer: `Yes, if stock is available, unused items can be exchanged within ${RETURN_POLICY_CONFIG.returnRequestWindowDays} days of delivery. Call us and we will arrange it; any price difference will be adjusted.`,
      },
    ],
  },
};

/** Default locale helper — bn is the platform default. */
export const DEFAULT_LEGAL_LOCALE: LegalLocale = "bn";
