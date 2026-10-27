/**
 * Admin warehouse ops — UI dictionary (doc 30 unified language system).
 * bn typed once, en typed as the mapped type — parity is compile-checked.
 * Order/customer DATA (names, districts, order numbers) is never
 * translated; only UI copy lives here.
 */
import type { Locale } from "@/i18n/locale";

const bn = {
  pageTitle: "ওয়্যারহাউস",
  lockedText:
    "🔒 এই মডিউলটি এই ইনস্টলের জন্য লক করা আছে। ওয়্যারহাউস অপস একটি পেইড অ্যাড-অন — আনলক করতে Admin > Settings > Feature Flags থেকে {flag} চালু করুন।",
  pageDescription:
    "পিক → প্যাক → শিপ: কনফার্মড অর্ডারের পিক লিস্ট, প্যাক চেকলিস্ট আর স্ক্যান করে কুরিয়ারে হস্তান্তরের রেকর্ড। পিক লিস্ট সম্পন্ন করা শুধু কর্মীর নিশ্চিতকরণ — এতে স্টক নড়ে না; স্টক অর্ডার তৈরির সময়ই রিজার্ভ হয়েছে।",

  tabsAria: "ওয়্যারহাউস ধাপ",
  tabPick: "১ · পিক লিস্ট",
  tabPack: "২ · প্যাক",
  tabShip: "৩ · শিপ স্ক্যান",
  errorFallback: "ত্রুটি হয়েছে",
  pickListCreated: "পিক লিস্ট তৈরি হয়েছে — {count}টি অর্ডার।",
  pickListCompleted: "পিক লিস্ট সম্পন্ন হিসেবে চিহ্নিত হয়েছে (কর্মীর নিশ্চিতকরণ — স্টক নড়েনি)।",
  packOrderCompleted: "এই অর্ডারের প্যাক সম্পন্ন — টাইমলাইনে নোট লেখা হয়েছে।",
  scanAlreadyTicked: "“{code}” ইতিমধ্যে টিক দেওয়া হয়েছে।",
  scanNotFound: "“{code}” এই পিক লিস্টে পাওয়া যায়নি — SKU/বারকোড মিলিয়ে দেখুন।",
  queueTitle: "কনফার্মড অর্ডারের কিউ ({count})",
  selectToday: "আজকের সব কনফার্মড ({count})",
  createList: "পিক লিস্ট তৈরি ({count})",
  noConfirmed: "এখন কোনো CONFIRMED অর্ডার অপেক্ষা করছে না।",
  selectAria: "{orderNo} সিলেক্ট",
  rowMeta: "{customer} · {district} · {itemCount} আইটেম, মোট {totalQty} পিস · {total}",
  packedDoneBadge: "প্যাক সম্পন্ন",
  inPickListBadge: "পিক লিস্টে আছে",
  pickListWord: "পিক লিস্ট",
  statusOpenSuffix: "· চলমান",
  statusDoneSuffix: "· সম্পন্ন",
  packBtn: "প্যাক করুন",
  completeBtn: "সম্পন্ন করুন",
  listMetaOrders: "{count}টি অর্ডার · তৈরি: {created}",
  listMetaCompleted: " · সম্পন্ন: {date}",
  attestationNote: "সম্পন্ন করা শুধু কর্মীর নিশ্চিতকরণ — এতে স্টক নড়ে না; স্টক অর্ডার তৈরির সময়ই রিজার্ভ হয়েছে।",
  colProduct: "পণ্য",
  colSku: "SKU",
  colBin: "বিন",
  colTotal: "মোট",
  colPerOrder: "অর্ডার অনুযায়ী ভাগ",
  noLists: "এখনো কোনো পিক লিস্ট তৈরি হয়নি।",
  packListBtn: "পিক লিস্ট {id} ({count} অর্ডার)",
  noOpenList: "কোনো চলমান পিক লিস্ট নেই — আগে পিক লিস্ট ট্যাব থেকে একটি তৈরি করুন।",
  scanTickTitle: "স্ক্যান করে টিক দিন",
  scanTickDesc:
    "পণ্যের SKU বা বারকোড স্ক্যান করলেই মিলে যাওয়া প্রথম আনটিক আইটেমে টিক পড়বে — চেকবক্স দিয়েও আগের মতো টিক দেওয়া যায়।",
  packDoneNote: "প্যাক সম্পন্ন — টাইমলাইনে নোট লেখা হয়েছে",
  tickCount: "{done}/{total} টিক",
  tickLockedNote: "এই অর্ডারের টিক এখন লক — প্যাক সম্পন্নের নোট অর্ডার টাইমলাইনে স্থায়ী রেকর্ড।",

  shipScanPlaceholder: "ট্র্যাকিং কোড / অর্ডার নম্বর স্ক্যান করুন",
  shipScanAria: "ট্র্যাকিং কোড বা অর্ডার নম্বর",
  searchBtn: "খুঁজুন",
  shipNotFound: "“{code}” দিয়ে কোনো শিপমেন্ট বা অর্ডার পাওয়া যায়নি।",
  handoverAlready: "ম্যানুয়াল হস্তান্তর আগেই রেকর্ড করা আছে।",
  handoverRecorded: "কুরিয়ারে হস্তান্তর (ম্যানুয়াল) টাইমলাইনে রেকর্ড হয়েছে।",
  labelCourier: "কুরিয়ার:",
  labelOrder: "অর্ডার:",
  labelCustomer: "গ্রাহক:",
  packedRecord: "✓ এই অর্ডারের প্যাক সম্পন্ন (পিক লিস্ট {id})",
  noPackedRecord: "⚠ এই অর্ডারের প্যাক সম্পন্নের রেকর্ড নেই",
  handoverBtn: "কুরিয়ারে হস্তান্তর (ম্যানুয়াল)",
  handoverNote:
    "এটি শুধু অর্ডার টাইমলাইনে একটি ম্যানুয়াল নোট লিখবে — কুরিয়ারের সিস্টেমে কোনো ইভেন্ট পাঠানো হয় না। আসল পিক-আপ স্ট্যাটাস কুরিয়ার সিঙ্ক থেকেই আসবে।",
  handoverRecordedAt: "ম্যানুয়াল হস্তান্তর রেকর্ড আছে — {date}",
  handoverNotNeeded:
    "কুরিয়ার ইতিমধ্যে পিক করেছে বা শিপমেন্ট এগিয়ে গেছে (স্ট্যাটাস: {status}) — ম্যানুয়াল হস্তান্তর লাগবে না।",
  notBookedDesc:
    "এই অর্ডারের এখনো কোনো শিপমেন্ট বুকিং হয়নি ({customer} · {district})। বুকিং এখানে হয় না — অর্ডার ওয়ার্কস্পেসের শিপমেন্ট প্যানেল থেকে বুক করুন।",
  bookInWorkspace: "অর্ডার ওয়ার্কস্পেসে বুকিং করুন →",
};

export type WarehouseStrings = { [K in keyof typeof bn]: string };

const en: WarehouseStrings = {
  pageTitle: "Warehouse",
  lockedText:
    "🔒 This module is locked for this install. Warehouse ops is a paid add-on — enable {flag} in Admin > Settings > Feature Flags to unlock it.",
  pageDescription:
    "Pick → Pack → Ship: pick lists for confirmed orders, pack checklists, and scan-to-handover records for couriers. Completing a pick list is only a staff attestation — it moves no stock; stock was reserved when the order was created.",

  tabsAria: "Warehouse steps",
  tabPick: "1 · Pick list",
  tabPack: "2 · Pack",
  tabShip: "3 · Ship scan",
  errorFallback: "Something went wrong",
  pickListCreated: "Pick list created — {count} orders.",
  pickListCompleted: "Pick list marked complete (staff attestation — no stock moved).",
  packOrderCompleted: "Packing complete for this order — a note has been written to the timeline.",
  scanAlreadyTicked: "“{code}” has already been ticked.",
  scanNotFound: "“{code}” was not found in this pick list — check the SKU/barcode.",
  queueTitle: "Confirmed order queue ({count})",
  selectToday: "All confirmed today ({count})",
  createList: "Create pick list ({count})",
  noConfirmed: "No CONFIRMED orders are waiting right now.",
  selectAria: "Select {orderNo}",
  rowMeta: "{customer} · {district} · {itemCount} items, {totalQty} pieces in total · {total}",
  packedDoneBadge: "Packing complete",
  inPickListBadge: "In a pick list",
  pickListWord: "Pick list",
  statusOpenSuffix: "· Open",
  statusDoneSuffix: "· Completed",
  packBtn: "Pack",
  completeBtn: "Complete",
  listMetaOrders: "{count} orders · Created: {created}",
  listMetaCompleted: " · Completed: {date}",
  attestationNote: "Completing is only a staff attestation — it moves no stock; stock was reserved when the order was created.",
  colProduct: "Product",
  colSku: "SKU",
  colBin: "Bin",
  colTotal: "Total",
  colPerOrder: "Split by order",
  noLists: "No pick lists have been created yet.",
  packListBtn: "Pick list {id} ({count} orders)",
  noOpenList: "No open pick list — create one from the Pick list tab first.",
  scanTickTitle: "Scan to tick",
  scanTickDesc:
    "Scanning a product's SKU or barcode ticks the first matching unticked item — you can still tick with the checkboxes as before.",
  packDoneNote: "Packing complete — a note has been written to the timeline",
  tickCount: "{done}/{total} ticked",
  tickLockedNote: "This order's ticks are now locked — the packing-complete note is a permanent record on the order timeline.",

  shipScanPlaceholder: "Scan a tracking code / order number",
  shipScanAria: "Tracking code or order number",
  searchBtn: "Search",
  shipNotFound: "No shipment or order was found for “{code}”.",
  handoverAlready: "The manual handover is already recorded.",
  handoverRecorded: "Courier handover (manual) has been recorded on the timeline.",
  labelCourier: "Courier:",
  labelOrder: "Order:",
  labelCustomer: "Customer:",
  packedRecord: "✓ Packing is complete for this order (pick list {id})",
  noPackedRecord: "⚠ No packing-complete record for this order",
  handoverBtn: "Hand over to courier (manual)",
  handoverNote:
    "This only writes a manual note on the order timeline — no event is sent to the courier's system. The real pickup status will come from the courier sync.",
  handoverRecordedAt: "Manual handover is recorded — {date}",
  handoverNotNeeded:
    "The courier has already picked up the parcel or the shipment has moved on (status: {status}) — no manual handover is needed.",
  notBookedDesc:
    "This order has no shipment booking yet ({customer} · {district}). Bookings are not made here — book from the shipments panel in the order workspace.",
  bookInWorkspace: "Book in the order workspace →",
};

export const WAREHOUSE_STRINGS: Record<Locale, WarehouseStrings> = { bn, en };
