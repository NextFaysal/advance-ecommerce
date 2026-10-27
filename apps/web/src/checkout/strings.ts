/**
 * Checkout UI strings — doc 30 unified language system, slice L3b.
 *
 * EVERY static UI-chrome string on the checkout page
 * (app/(store)/checkout/page.tsx) and the Rocket manual-payment
 * panel lives here as a {bn, en} pair, selected by the resolved
 * locale (useLocale() on the client). The rule: en → everything
 * English, bn → everything Bangla, no mixed lines.
 *
 * NOT here (deliberately):
 * - Dynamic checkout-field labels/placeholders — merchant content
 *   from the `checkout.fields` config (src/checkout/fields.ts);
 *   the page selects labelBn/labelEn by the resolved locale.
 * - Delivery-slot labels — admin config carrying labelBn/labelEn;
 *   the page renders only the active locale's label.
 * - Server/API error messages and the shared Zod validation
 *   messages (src/checkout/validation.ts) — server/schema content,
 *   unchanged by this slice.
 * - Product/merchant data (item names, pickup-point names, geo
 *   dataset names) — content, not UI chrome. Geo option labels
 *   pick nameBn/nameEn from the dataset by locale at render time.
 *
 * Dictionary typing follows the doc-30 contract: the `bn` object
 * is written plainly (NOT `as const`) and `en` is typed as the
 * mapped CheckoutStrings, so a missing/extra key fails compile.
 */
import type { Locale } from "../i18n/locale";

const bn = {
  // Page frame / states
  pageTitle: "চেকআউট — এক পেজেই অর্ডার",
  cartLoading: "কার্ট লোড হচ্ছে…",
  checkoutIntro:
    "ফোন নম্বর আবশ্যক, ইমেইল ঐচ্ছিক। ঠিকানা দিন ধাপে ধাপে: বিভাগ › জেলা › উপজেলা › ইউনিয়ন (ঐচ্ছিক)।",
  stepsAria: "চেকআউটের ধাপ",
  stepInfo: "তথ্য",
  stepAddress: "ঠিকানা",
  stepDelivery: "ডেলিভারি",
  stepPayment: "পেমেন্ট",

  // Empty cart
  emptyCartAria: "কার্ট খালি",
  emptyCartTitle: "আপনার কার্ট খালি",
  emptyCartBody:
    "চেকআউট করতে আগে কার্টে পণ্য যোগ করুন — পছন্দের পণ্য বেছে কার্টে যোগ করলেই এখানে অর্ডার করা যাবে।",
  goToShop: "দোকানে যান",

  // Order summary rail
  yourCart: "আপনার কার্ট",
  estimatedSuffix: "(আনুমানিক)",
  rentalDepositLine: "ভাড়ার জামানত (ফেরতযোগ্য)",
  grandTotal: "সর্বমোট",
  shippingNote:
    "ডেলিভারি চার্জ আনুমানিক — চূড়ান্ত চার্জ সার্ভারে জেলা ও ওজন অনুযায়ী নির্ধারিত হবে। কুপনের ছাড় থাকলে তা অর্ডারের মোটে কমে যাবে।",
  stockProblem: "স্টক সমস্যা: {items}",
  stockProblemItem: "{name} (চেয়েছেন {requested}টি, স্টকে আছে {available}টি)",

  // Step 1 — info
  step1Aria: "ধাপ ১: আপনার তথ্য",
  step1Title: "আপনার তথ্য",

  // Step 2 — address
  step2Aria: "ধাপ ২: ঠিকানা",
  pasteAddressLabel: "সম্পূর্ণ ঠিকানা একসাথে লিখুন (ঐচ্ছিক)",
  pasteAddressPlaceholder: "যেমন: বাসা ১২, রোড ৫, মিরপুর ১০, ঢাকা",
  suggestionPrompt: "আপনি কি {label} বোঝাতে চেয়েছেন?",
  districtWord: "জেলা",
  upazilaWord: "উপজেলা",
  yesUseIt: "হ্যাঁ, ব্যবহার করুন",
  chooseDivision: "বিভাগ বেছে নিন",
  chooseDistrict: "জেলা বেছে নিন",
  chooseUpazila: "উপজেলা বেছে নিন",
  geoLoading: "এলাকার তালিকা লোড হচ্ছে…",
  divisionFallback: "বিভাগ *",
  districtFallback: "জেলা *",
  upazilaFallback: "উপজেলা *",

  // Step 3 — delivery
  step3Aria: "ধাপ ৩: ডেলিভারি",
  deliveryMethodLabel: "ডেলিভারি মাধ্যম",
  homeDelivery: "হোম ডেলিভারি",
  insideDhaka: "ঢাকার ভিতরে",
  outsideDhaka: "ঢাকার বাইরে",
  zoneAutoSuffix: "(জেলা অনুযায়ী স্বয়ংক্রিয়)",
  pickupOption: "পিকআপ (নিজে এসে নেবেন)",
  pickupPointQuestion: "কোন পয়েন্ট থেকে নেবেন?",
  openHoursPrefix: "খোলা: {hours}",
  pickupNoPoints:
    "পিকআপের ঠিকানা ও সময় অর্ডারের পর আমাদের টিম ফোনে জানিয়ে দেবে।",
  slotLegend: "ডেলিভারির সময় (ঐচ্ছিক)",
  anyTime: "যেকোনো সময়",
  giftToggle: "এটি একটি উপহার 🎁",
  giftMessagePlaceholder: "উপহারের বার্তা (ঐচ্ছিক) — যেমন: শুভ জন্মদিন!",
  giftMessageAria: "উপহারের বার্তা",

  // Restaurant fulfilment
  fulfilmentQuestion: "খাবার কীভাবে নেবেন?",
  dineIn: "ডাইন-ইন",
  dineInDesc: "রেস্টুরেন্টে বসে খাবেন — টেবিল বেছে নিন",
  takeaway: "টেকঅওয়ে",
  takeawayDesc: "প্যাক করে নিয়ে যাবেন",
  tableSelectLabel: "টেবিল",
  chooseTable: "— টেবিল বেছে নিন —",

  // Service booking
  bookingLegend: "সেবার তারিখ ও সময় (বুকিং আবশ্যক)",
  bookingQtyNote:
    "বুকিংয়ের জন্য এই সেবাটির পরিমাণ ঠিক ১ রাখুন — কার্ট থেকে পরিমাণ বদলে আবার চেষ্টা করুন।",
  bookingClosed: "এই দিনে সেবা বন্ধ থাকে — অন্য তারিখ বেছে নিন।",
  bookingPast: "এই তারিখটি ইতিমধ্যে পার হয়ে গেছে।",
  bookingBeyond: "সর্বোচ্চ {days} দিন আগে পর্যন্ত বুকিং করা যায়।",
  bookingUnavailable: "এই তারিখে বুকিং নেওয়া যাচ্ছে না।",
  slotPast: "অতীত",
  slotFull: "পূর্ণ",
  slotsLoading: "সময়ের তালিকা লোড হচ্ছে…",

  // Rental
  rentalLegend: "ভাড়ার তারিখ (আবশ্যক)",
  rentalQtyNote:
    "ভাড়ার জন্য এই আইটেমটির পরিমাণ ঠিক ১ রাখুন — কার্ট থেকে পরিমাণ বদলে আবার চেষ্টা করুন।",
  startDate: "শুরুর তারিখ",
  returnDate: "ফেরতের তারিখ",
  availabilityChecking: "প্রাপ্যতা যাচাই হচ্ছে…",
  rentalTooLong: "একবারে সর্বোচ্চ {days} দিনের জন্য ভাড়া নেওয়া যায়।",
  rentalUnavailableDate: "এই তারিখের জন্য ভাড়া নেওয়া যাচ্ছে না।",
  rentalAvailableUnits: "এই সময়ের জন্য {count}টি ইউনিট পাওয়া যাচ্ছে।",
  rentalAllBooked:
    "এই তারিখের জন্য সব ইউনিট ইতিমধ্যে ভাড়া হয়ে গেছে — অন্য তারিখ বেছে নিন।",
  rentalDepositNote:
    "ভাড়ার জামানত (ফেরতযোগ্য): {amount} — অর্ডারের মোট মূল্যে যোগ হবে এবং ফেরতের সময় ফেরত দেওয়া হবে।",
  rentalPickDates: "শুরুর ও ফেরতের তারিখ বেছে নিন — সর্বোচ্চ {days} দিন।",

  // Print on demand
  podLegend: "কাস্টম প্রিন্ট (আবশ্যক)",
  printTextLabel: "ছাপানোর লেখা — {name}",
  printTextPlaceholder: "যেমন: আপনার নাম বা প্রিয় লাইন",
  printCharCount:
    "{count}/{max} অক্ষর — ঠিক এই লেখাটিই ছাপা হবে, বানান যাচাই করে লিখুন।",
  printColorLabel: "প্রিন্টের রঙ (ঐচ্ছিক)",
  storeDefault: "দোকানের ডিফল্ট",
  printFeePerItem: "প্রিন্ট ফি: প্রতি আইটেমে {fee}",
  printFeeTotalPart: "— এই অর্ডারে মোট {total} অর্ডারের মোট মূল্যে যোগ হবে।",

  // Step 4 — payment
  step4Aria: "ধাপ ৪: পেমেন্ট",
  paymentMethodLegend: "পেমেন্ট মাধ্যম",
  manualVerification: "ম্যানুয়াল যাচাই",
  paymentNoteWithGateways:
    "নিরাপদ পেমেন্ট: পণ্য হাতে পেয়ে টাকা দিন (ক্যাশ অন ডেলিভারি), অথবা অনলাইনে পরিশোধ করুন।",
  paymentNoteCodOnly: "পণ্য হাতে পেয়ে টাকা দিন (ক্যাশ অন ডেলিভারি)।",
  couponLabel: "কুপন কোড (ঐচ্ছিক)",
  giftCardLabel: "গিফট কার্ড কোড (ঐচ্ছিক)",
  giftCardNote:
    "গিফট কার্ডের ব্যালেন্স থেকে অর্ডারের মূল্য পরিশোধ হবে (সর্বোচ্চ অর্ডারের মোট মূল্য পর্যন্ত); অবশিষ্ট ব্যালেন্স কার্ডেই থেকে যাবে।",

  // Prescription (Rx)
  rxLegend: "💊 প্রেসক্রিপশনের তথ্য আবশ্যক",
  rxIntro:
    "আপনার কার্টে প্রেসক্রিপশন-আবশ্যক ওষুধ আছে। অর্ডার করতে প্রেসক্রিপশনের তথ্য দিন — ফার্মাসিস্ট যাচাই করার পর অর্ডার নিশ্চিত হবে। এই তথ্য রেকর্ড হিসেবে থাকবে; এটি যাচাইকৃত প্রেসক্রিপশন নয়।",
  rxPrescriberName: "চিকিৎসকের নাম",
  rxRegistrationNo: "চিকিৎসকের রেজিস্ট্রেশন নম্বর",
  rxImageLabel: "প্রেসক্রিপশনের ছবির লিংক (যদি আগে থেকে অনলাইনে থাকে — ঐচ্ছিক)",
  rxAttest: "আমি নিশ্চিত করছি যে আমার কাছে এই প্রেসক্রিপশনটি আছে এবং তথ্যগুলো সঠিক।",

  // Age gate
  ageLegend: "🔞 বয়স নিশ্চিতকরণ আবশ্যক",
  ageIntro:
    "আপনার কার্টে বয়স-সীমাবদ্ধ পণ্য আছে — কেনার জন্য বয়স কমপক্ষে {minAge} বছর হতে হবে। এই নিশ্চিতকরণটি অর্ডারে রেকর্ড থাকবে। এটি একটি স্ব-ঘোষণা — আমরা কোনো পরিচয়পত্র বা জন্মতারিখ যাচাই করি না।",
  ageAttest: "আপনি নিশ্চিত করছেন আপনার বয়স কমপক্ষে {minAge} বছর।",

  // Submit / sticky bar
  submitPlacing: "অর্ডার করা হচ্ছে…",
  submitConfirm: "অর্ডার নিশ্চিত করুন",
  stickyItemsCount: "মোট {count}টি পণ্য",

  // Client-side submit-guard + failure errors
  errServiceSlot: "সেবাটির জন্য একটি তারিখ ও সময় বেছে নিন।",
  errRentalDates: "ভাড়ার জন্য শুরুর ও ফেরতের তারিখ বেছে নিন।",
  errPodText: "কাস্টম প্রিন্টের জন্য ছাপানোর লেখাটি লিখুন।",
  errPodTooLong: "ছাপানোর লেখা সর্বোচ্চ {max} অক্ষরের হতে পারবে।",
  errIdempotency:
    "এই চেকআউট প্রচেষ্টাটি আগেই একবার প্রসেস হয়েছে। নতুন করে অর্ডার করতে পেজটি রিলোড করুন।",
  errOrderFailed: "অর্ডার করা যায়নি। আবার চেষ্টা করুন।",
  errNetwork: "নেটওয়ার্ক সমস্যা — সংযোগ যাচাই করে আবার চেষ্টা করুন।",

  // Confirmation screen
  orderSuccessAria: "অর্ডার সফল",
  orderSuccessTitle: "অর্ডার সফল হয়েছে!",
  orderSuccessThanks: "ধন্যবাদ! আপনার অর্ডারটি গ্রহণ করা হয়েছে।",
  orderNumber: "অর্ডার নম্বর",
  kitchen: "রান্নাঘর",
  queuedWord: "অপেক্ষমাণ",
  tableWord: "টেবিল",
  bookingLabel: "বুকিং",
  bookedWord: "বুক করা হয়েছে",
  rentalLabel: "ভাড়া",
  rentalDays: "{days} দিন",
  rentalDepositIncluded: "জামানত {amount} মোটে অন্তর্ভুক্ত (ফেরতে ফেরতযোগ্য)",
  customPrintLabel: "কাস্টম প্রিন্ট",
  printColorPrefix: "রঙ: {color}",
  printFeeIncluded: "প্রিন্ট ফি {amount} মোটে অন্তর্ভুক্ত",
  pickupPointLabel: "পিকআপ পয়েন্ট",
  openingHours: "খোলার সময়",
  rxPendingReview:
    "💊 আপনার প্রেসক্রিপশনের তথ্য গৃহীত হয়েছে — ফার্মাসিস্ট যাচাই করে অনুমোদন দিলে অর্ডারটি নিশ্চিত হবে। যাচাই শেষ হলে আমরা ফোনে জানিয়ে দেব।",
  warrantyMonths: "{months} মাস",
  warrantyNote:
    "🛡️ ওয়ারেন্টি: {periods} — ওয়ারেন্টির মেয়াদ ডেলিভারির দিন থেকে শুরু হবে; পণ্য ডেলিভারির পর সিরিয়াল নম্বরসহ ওয়ারেন্টি কার্ড আপনার অ্যাকাউন্টে দেখা যাবে।",
  codPayOnDelivery: "পণ্য হাতে পেয়ে ডেলিভারি ম্যানকে {amount} পরিশোধ করুন।",
  onlinePaymentReady:
    "অনলাইন পেমেন্টের ধাপটি তৈরি — নিচের বোতামে গিয়ে পেমেন্ট সম্পন্ন করুন।",
  payOnlineNow: "এখনই অনলাইনে পরিশোধ করুন",
  onlinePaymentUnavailable:
    "অনলাইন পেমেন্ট এখন শুরু করা যাচ্ছে না — তবে আপনার অর্ডারটি গৃহীত হয়েছে। পেমেন্টের জন্য আমাদের টিম ফোনে যোগাযোগ করবে।",
  onlinePaymentFallback:
    "অনলাইন পেমেন্ট সম্পন্ন না হলে আমাদের টিম ফোনে যোগাযোগ করে পেমেন্টের ধাপ জানিয়ে দেবে।",
  advanceRequiredTitle: "অগ্রিম পেমেন্ট প্রয়োজন: {amount}",
  advanceLinkNote:
    "এই অর্ডারটি নিশ্চিত করতে অগ্রিম {amount} পরিশোধ করুন। এই একই লিংকটি SMS-এর মাধ্যমে আপনার ফোনে পাঠানোর জন্যও ইস্যু করা হয়েছে — তবে লিংকটি এখানে শুধু এইবারই দেখা যাবে, তাই সংরক্ষণ করে রাখুন।",
  payAdvanceNow: "এখনই অগ্রিম পরিশোধ করুন",
  copyLink: "লিংক কপি করুন",
  copied: "কপি হয়েছে ✓",
  advanceRequiredNoLink:
    "এই অর্ডারে অগ্রিম পেমেন্ট{amountPart} প্রয়োজন — পেমেন্ট লিংকটি এখানে দেখানো যাচ্ছে না, আমাদের টিম ফোনে যোগাযোগ করে লিংকটি পাঠিয়ে দেবে।",
  couponApplied: "আপনার কুপনটি প্রয়োগ হয়েছে — ছাড়সহ মোট উপরে দেখানো হয়েছে।",
  giftCardApplied:
    "গিফট কার্ড (…{last4}) দিয়ে {applied} পরিশোধ হয়েছে — কার্ডে অবশিষ্ট ব্যালেন্স {remaining}, পরের অর্ডারে ব্যবহার করা যাবে।",
  giftCardRejected:
    "গিফট কার্ডটি প্রয়োগ করা যায়নি: {reason} অর্ডারটি সম্পূর্ণ মূল্যেই সম্পন্ন হয়েছে।",
  membershipApplied: "আপনার মেম্বারশিপ টিয়ারের সুবিধা প্রয়োগ হয়েছে",
  membershipDiscountPart: "পণ্যে ছাড় {amount}",
  membershipFreeShippingPart: "ডেলিভারি চার্জ ফ্রি",

  // Rocket panel
  rocketLoading: "Rocket পেমেন্টের নির্দেশনা লোড হচ্ছে…",
  rocketUnconfigured:
    "Rocket পেমেন্টের তথ্য এখন দেখানো যাচ্ছে না — তবে আপনার অর্ডারটি গৃহীত হয়েছে। পেমেন্টের জন্য আমাদের টিম ফোনে যোগাযোগ করবে।",
  rocketSubmittedTitle: "✅ আপনার TrxID জমা হয়েছে — যাচাইয়ের অপেক্ষায়",
  rocketSubmittedBody:
    "আমাদের টিম Rocket লেনদেনটি যাচাই করে পেমেন্ট নিশ্চিত করবে। যাচাই শেষ হলে অর্ডারের পেমেন্ট অবস্থা আপডেট হবে — এই জমাটি নিজে থেকে পেমেন্ট নিশ্চিত করে না।",
  rocketTitle: "🚀 Rocket দিয়ে পরিশোধ করুন (ম্যানুয়াল যাচাই)",
  rocketStep1: "আপনার Rocket অ্যাপ থেকে এই নম্বরে {amount} পাঠান: {number}",
  rocketStep2: "পাঠানো শেষ হলে নিচে TrxID, প্রেরকের নম্বর ও পরিমাণ জমা দিন।",
  rocketStep3:
    "আমাদের টিম TrxID যাচাই করে পেমেন্ট নিশ্চিত করবে — জমা দিলেই পেমেন্ট ধরা হয় না।",
  rocketTrxIdLabel: "Rocket TrxID",
  rocketTrxIdPlaceholder: "যেমন: 7HXXXXXXX",
  rocketSenderLabel: "যে নম্বর থেকে পাঠিয়েছেন",
  rocketAmountLabel: "পরিমাণ (টাকা)",
  rocketErrTrxId: "সঠিক Rocket TrxID দিন (কমপক্ষে ৬ অক্ষর)।",
  rocketErrSender: "যে নম্বর থেকে টাকা পাঠিয়েছেন, সেটি দিন।",
  rocketErrAmount: "সঠিক পরিমাণ দিন (টাকায়)।",
  rocketErrSubmitFallback:
    "জমা দেওয়া যায়নি — আবার চেষ্টা করুন, অথবা আমাদের টিমকে ফোন করুন।",
  rocketErrNetwork: "নেটওয়ার্ক সমস্যা — জমা পাঠানো যায়নি, আবার চেষ্টা করুন।",
  rocketSubmitting: "জমা হচ্ছে…",
  rocketSubmit: "TrxID জমা দিন",
};

export type CheckoutStrings = { [K in keyof typeof bn]: string };

const en: CheckoutStrings = {
  pageTitle: "Checkout — order on one page",
  cartLoading: "Loading cart…",
  checkoutIntro:
    "A phone number is required, email is optional. Give your address step by step: Division › District › Upazila › Union (optional).",
  stepsAria: "Checkout steps",
  stepInfo: "Info",
  stepAddress: "Address",
  stepDelivery: "Delivery",
  stepPayment: "Payment",

  emptyCartAria: "Empty cart",
  emptyCartTitle: "Your cart is empty",
  emptyCartBody:
    "Add products to your cart before checking out — pick the products you like, add them to the cart, and you can place your order here.",
  goToShop: "Go to shop",

  yourCart: "Your cart",
  estimatedSuffix: "(estimated)",
  rentalDepositLine: "Rental deposit (refundable)",
  grandTotal: "Grand total",
  shippingNote:
    "The delivery charge is an estimate — the final charge is set on the server by district and weight. Any coupon discount will reduce the order total.",
  stockProblem: "Stock problem: {items}",
  stockProblemItem: "{name} (requested {requested}, in stock {available})",

  step1Aria: "Step 1: Your information",
  step1Title: "Your information",

  step2Aria: "Step 2: Address",
  pasteAddressLabel: "Write the full address at once (optional)",
  pasteAddressPlaceholder: "e.g. House 12, Road 5, Mirpur 10, Dhaka",
  suggestionPrompt: "Did you mean {label}?",
  districtWord: "District",
  upazilaWord: "Upazila",
  yesUseIt: "Yes, use it",
  chooseDivision: "Choose a division",
  chooseDistrict: "Choose a district",
  chooseUpazila: "Choose an upazila",
  geoLoading: "Loading the area list…",
  divisionFallback: "Division *",
  districtFallback: "District *",
  upazilaFallback: "Upazila *",

  step3Aria: "Step 3: Delivery",
  deliveryMethodLabel: "Delivery method",
  homeDelivery: "Home delivery",
  insideDhaka: "inside Dhaka",
  outsideDhaka: "outside Dhaka",
  zoneAutoSuffix: "(automatic by district)",
  pickupOption: "Pickup (collect it yourself)",
  pickupPointQuestion: "Which point will you collect from?",
  openHoursPrefix: "Open: {hours}",
  pickupNoPoints:
    "Our team will call you after the order with the pickup address and time.",
  slotLegend: "Delivery time (optional)",
  anyTime: "Any time",
  giftToggle: "This is a gift 🎁",
  giftMessagePlaceholder: "Gift message (optional) — e.g. Happy birthday!",
  giftMessageAria: "Gift message",

  fulfilmentQuestion: "How will you take your food?",
  dineIn: "Dine-in",
  dineInDesc: "Eat at the restaurant — pick a table",
  takeaway: "Takeaway",
  takeawayDesc: "Packed to take away",
  tableSelectLabel: "Table",
  chooseTable: "— Choose a table —",

  bookingLegend: "Service date & time (booking required)",
  bookingQtyNote:
    "For a booking, keep this service's quantity at exactly 1 — change the quantity in the cart and try again.",
  bookingClosed: "The service is closed on this day — please pick another date.",
  bookingPast: "This date has already passed.",
  bookingBeyond: "Bookings can be made up to {days} days ahead.",
  bookingUnavailable: "Bookings can't be taken for this date.",
  slotPast: "Past",
  slotFull: "Full",
  slotsLoading: "Loading time slots…",

  rentalLegend: "Rental dates (required)",
  rentalQtyNote:
    "For a rental, keep this item's quantity at exactly 1 — change the quantity in the cart and try again.",
  startDate: "Start date",
  returnDate: "Return date",
  availabilityChecking: "Checking availability…",
  rentalTooLong: "You can rent for at most {days} days at a time.",
  rentalUnavailableDate: "Rental isn't available for these dates.",
  rentalAvailableUnits: "{count} units are available for this period.",
  rentalAllBooked:
    "All units are already rented for these dates — please choose other dates.",
  rentalDepositNote:
    "Rental deposit (refundable): {amount} — it will be added to the order total and returned when you return the item.",
  rentalPickDates: "Pick the start and return dates — up to {days} days.",

  podLegend: "Custom print (required)",
  printTextLabel: "Text to print — {name}",
  printTextPlaceholder: "e.g. your name or a favourite line",
  printCharCount:
    "{count}/{max} characters — exactly this text will be printed, so check the spelling.",
  printColorLabel: "Print colour (optional)",
  storeDefault: "Store default",
  printFeePerItem: "Print fee: {fee} per item",
  printFeeTotalPart: "— a total of {total} will be added to this order's total.",

  step4Aria: "Step 4: Payment",
  paymentMethodLegend: "Payment method",
  manualVerification: "Manual verification",
  paymentNoteWithGateways:
    "Secure payment: pay when you receive your products (cash on delivery), or pay online.",
  paymentNoteCodOnly: "Pay when you receive your products (cash on delivery).",
  couponLabel: "Coupon code (optional)",
  giftCardLabel: "Gift card code (optional)",
  giftCardNote:
    "The order amount will be paid from the gift card balance (up to the order total); any remaining balance stays on the card.",

  rxLegend: "💊 Prescription details required",
  rxIntro:
    "Your cart contains a prescription-required medicine. Please give the prescription details to order — a pharmacist will verify them before the order is confirmed. These details are kept as a record; this is not a verified prescription.",
  rxPrescriberName: "Doctor's name",
  rxRegistrationNo: "Doctor's registration number",
  rxImageLabel: "Prescription image link (if it's already online — optional)",
  rxAttest: "I confirm that I have this prescription and the details are correct.",

  ageLegend: "🔞 Age confirmation required",
  ageIntro:
    "Your cart contains an age-restricted product — you must be at least {minAge} years old to buy it. This confirmation will be recorded with the order. It is a self-declaration — we do not verify any identity document or date of birth.",
  ageAttest: "I confirm I am at least {minAge} years old.",

  submitPlacing: "Placing order…",
  submitConfirm: "Confirm order",
  stickyItemsCount: "{count} items in total",

  errServiceSlot: "Please pick a date and time for the service.",
  errRentalDates: "Please pick the rental start and return dates.",
  errPodText: "Please enter the text to print.",
  errPodTooLong: "The print text can be at most {max} characters.",
  errIdempotency:
    "This checkout attempt has already been processed. Reload the page to place a new order.",
  errOrderFailed: "The order couldn't be placed. Please try again.",
  errNetwork: "Network problem — check your connection and try again.",

  orderSuccessAria: "Order successful",
  orderSuccessTitle: "Order placed successfully!",
  orderSuccessThanks: "Thank you! Your order has been received.",
  orderNumber: "Order number",
  kitchen: "Kitchen",
  queuedWord: "Queued",
  tableWord: "Table",
  bookingLabel: "Booking",
  bookedWord: "Booked",
  rentalLabel: "Rental",
  rentalDays: "{days} days",
  rentalDepositIncluded: "Deposit {amount} included in the total (refundable on return)",
  customPrintLabel: "Custom print",
  printColorPrefix: "Colour: {color}",
  printFeeIncluded: "Print fee {amount} included in the total",
  pickupPointLabel: "Pickup point",
  openingHours: "Opening hours",
  rxPendingReview:
    "💊 Your prescription details have been received — once a pharmacist reviews and approves them, your order will be confirmed. We will call you when the review is done.",
  warrantyMonths: "{months} months",
  warrantyNote:
    "🛡️ Warranty: {periods} — the warranty period starts on the delivery day; after delivery, the warranty card with the serial number will appear in your account.",
  codPayOnDelivery: "Pay {amount} to the delivery person when you receive your products.",
  onlinePaymentReady:
    "The online payment step is ready — tap the button below to complete your payment.",
  payOnlineNow: "Pay online now",
  onlinePaymentUnavailable:
    "Online payment can't be started right now — but your order has been received. Our team will contact you by phone about payment.",
  onlinePaymentFallback:
    "If the online payment isn't completed, our team will call you and guide you through the payment step.",
  advanceRequiredTitle: "Advance payment required: {amount}",
  advanceLinkNote:
    "Please pay an advance of {amount} to confirm this order. The same link has also been issued to be sent to your phone by SMS — but the link is shown here only this once, so please save it.",
  payAdvanceNow: "Pay the advance now",
  copyLink: "Copy link",
  copied: "Copied ✓",
  advanceRequiredNoLink:
    "This order requires an advance payment{amountPart} — the payment link can't be shown here, so our team will call you and send the link.",
  couponApplied: "Your coupon has been applied — the total above includes the discount.",
  giftCardApplied:
    "Paid {applied} with the gift card (…{last4}) — remaining balance on the card is {remaining}, usable on your next order.",
  giftCardRejected:
    "The gift card could not be applied: {reason} The order was completed at full price.",
  membershipApplied: "Your membership tier benefit has been applied",
  membershipDiscountPart: "Product discount {amount}",
  membershipFreeShippingPart: "Free delivery charge",

  rocketLoading: "Loading Rocket payment instructions…",
  rocketUnconfigured:
    "Rocket payment details can't be shown right now — but your order has been received. Our team will contact you by phone about payment.",
  rocketSubmittedTitle: "✅ Your TrxID has been submitted — awaiting verification",
  rocketSubmittedBody:
    "Our team will verify the Rocket transaction and confirm the payment. Once the verification is done, the order's payment status will be updated — this submission does not confirm the payment by itself.",
  rocketTitle: "🚀 Pay with Rocket (manual verification)",
  rocketStep1: "Send {amount} from your Rocket app to this number: {number}",
  rocketStep2: "After sending, submit the TrxID, the sender's number and the amount below.",
  rocketStep3:
    "Our team will verify the TrxID and confirm the payment — submitting alone does not count as payment.",
  rocketTrxIdLabel: "Rocket TrxID",
  rocketTrxIdPlaceholder: "e.g. 7HXXXXXXX",
  rocketSenderLabel: "Number you sent from",
  rocketAmountLabel: "Amount (BDT)",
  rocketErrTrxId: "Enter a valid Rocket TrxID (at least 6 characters).",
  rocketErrSender: "Enter the number you sent the money from.",
  rocketErrAmount: "Enter a valid amount (in taka).",
  rocketErrSubmitFallback: "Couldn't submit — please try again, or call our team.",
  rocketErrNetwork: "Network problem — the submission couldn't be sent, please try again.",
  rocketSubmitting: "Submitting…",
  rocketSubmit: "Submit TrxID",
};

export const CHECKOUT_STRINGS: Record<Locale, CheckoutStrings> = { bn, en };
