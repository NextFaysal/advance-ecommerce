/**
 * Unified language system (doc 30) — INVENTORY dictionary (slice L5-D).
 *
 * Covers app/admin/inventory/** (page, depth panel, purchase-orders
 * panel). Contract typing: the `bn` object is written once, `en` is
 * typed as the mapped type so any missing/extra key fails compilation
 * (parity guarantee). NEVER `as const` the bn object. Templates use
 * {placeholder} + interpolate() from src/i18n/locale.ts.
 */
import type { Locale } from "@/i18n/locale";

const bn = {
  // ---- Page (server) ----
  title: "ইনভেন্টরি",
  description:
    "স্টক লেজার থেকে আসল ডেটা — মোট {count}টি আইটেম (ভ্যারিয়েন্ট × গুদাম)। সরাসরি সংখ্যা বদলানো যায় না; স্টক বদলায় শুধু মুভমেন্টে।",
  totalValueCost: "মোট মূল্য (কস্ট)",
  missingCostNote: "{count}টি আইটেমের কস্ট নেই — মূল্যায়নে ধরা হয়নি",
  totalItems: "মোট আইটেম",
  itemsCaption: "ভ্যারিয়েন্ট × গুদাম হিসেবে",
  lowStockAlerts: "কম স্টক সতর্কতা",
  lowStockCaption: "প্রতিটি পণ্যের নিজস্ব থ্রেশহোল্ড; না থাকলে ডিফল্ট {threshold}",
  emptyTitle: "ইনভেন্টরিতে কোনো আইটেম নেই",
  emptyBody: "পণ্যের ভ্যারিয়েন্টে স্টক মুভমেন্ট এলেই এখানে আইটেম দেখা যাবে।",
  breakdownTitle: "গুদাম অনুযায়ী বিবরণ (সেকেন্ডারি)",
  breakdownNoteBefore:
    "প্রতি গুদামের লেজার হিসাব নিচে — কিন্তু অর্ডার/চেকআউট যে সংখ্যা দেখে বিক্রি করে, তা হলো",
  breakdownNoteEmphasis: "\"মোট উপলব্ধ (অর্ডারের হিসাব)\"",
  breakdownNoteAfter:
    "কলামের সংখ্যা (ভ্যারিয়েন্টের ক্যাশ স্টক)। রিজার্ভ করা অর্ডারের কারণে গুদামের \"উপলব্ধ\" যোগফল এর চেয়ে কম দেখাতে পারে।",
  colVariant: "ভ্যারিয়েন্ট",
  colWarehouse: "গুদাম",
  colOnHand: "হাতে আছে",
  colReserved: "রিজার্ভ",
  colAvailableHere: "এই গুদামে উপলব্ধ",
  colTotalAvailable: "মোট উপলব্ধ (অর্ডারের হিসাব)",
  badgeLowStock: "কম স্টক",
  badgeOk: "ঠিক আছে",
  productsCount: "{count}টি পণ্য",
  lowStockNone:
    "কম স্টকের কোনো পণ্য নেই — সব ভ্যারিয়েন্টের মোট উপলব্ধ স্টক নিজ নিজ থ্রেশহোল্ডের উপরে।",
  thresholdText: "থ্রেশহোল্ড: {threshold}",
  sourceProduct: "পণ্যের নিজস্ব",
  sourceSettings: "সেটিংস",
  sourceDefault: "ডিফল্ট",
  availableBadge: "উপলব্ধ {count}",
  poSectionTitle: "ক্রয় আদেশ ও পণ্য গ্রহণ",
  poSectionBody:
    "সাপ্লায়ারের চালান এলে এখান থেকে রিসিভ করুন — প্রতিটি রিসিভ স্টক লেজারে PURCHASE_RECEIVE মুভমেন্ট হিসেবে জমা হয় (অর্ডারের রেফারেন্সসহ), আংশিক রিসিভ বারবার করা যায়, আর অর্ডারের বেশি রিসিভ সিস্টেম নেবে না। অর্ডার সম্পূর্ণ রিসিভ হলে ERP জার্নালে ক্রয়-প্রাপ্তির পোস্টিং হয় (module.erp_lite চালু থাকলে)।",
  depthSectionTitle: "গভীর বিশ্লেষণ",
  depthSectionBody:
    "ব্যাচ/লট ও মেয়াদ, সিরিয়াল/IMEI হিসাব, ABC আয়-বিশ্লেষণ, ডেড স্টক এবং অটো রি-অর্ডার — সব সংখ্যা আসল রেকর্ড থেকে হিসাব করা। ব্যাচ ছাড়া রিসিভ করা স্টক এই বিশ্লেষণে আসে না (অনট্র্যাকড — শূন্য ধরা হয় না)।",
  footerNote:
    "ডাটাবেস থেকে — API: GET/POST /api/v1/admin/inventory, POST /api/v1/admin/inventory/purchase-orders, GET /api/v1/admin/purchase-orders/[id], POST /api/v1/admin/purchase-orders/[id]/receive (RBAC + ledger, Prisma)। Adjustment-এর জন্য কারণ লাগে; স্টক বদলায় শুধু মুভমেন্টে।",

  // ---- Depth panel (client) ----
  reportLoadFailed: "রিপোর্ট লোড করা যায়নি",
  depthLoadFailed: "গভীর বিশ্লেষণ লোড করা যায়নি: {error}",
  analysisLoading: "বিশ্লেষণ লোড হচ্ছে…",
  serialLabel: "সিরিয়াল / IMEI:",
  serialInStock: "স্টকে {count}টি",
  serialSold: "বিক্রি {count}টি",
  serialReturned: "ফেরত (নষ্ট) {count}টি",
  serialTotalNote: "মোট রেকর্ড {count}টি — শুধু রিসিভে ধরা পড়া সিরিয়ালই গণনায় আসে।",
  abcTitle: "ABC বিশ্লেষণ (আয় অনুযায়ী)",
  abcNote: "A = প্রথম ৭০% আয় · B = পরের ২০% · C = বাকি · মোট আয় {total}",
  rangeLabel: "সময়সীমা:",
  daysOption: "{days} দিন",
  abcBadge: "{count}টি ভ্যারিয়েন্ট",
  abcNoSales: "এই সময়সীমায় কোনো বিক্রি নেই।",
  colClass: "শ্রেণি",
  colProduct: "পণ্য",
  colUnitsSold: "বিক্রি (টি)",
  colRevenue: "আয়",
  colShare: "অংশ",
  expiringTitle: "মেয়াদ শেষ হতে চলেছে (আগামী {days} দিনে)",
  expiringNone: "এই সময়ে মেয়াদ শেষ হওয়ার মতো কোনো ব্যাচ স্টকে নেই।",
  binText: "বিন {bin}",
  onHandText: "হাতে {count}টি",
  expiredBadge: "মেয়াদ শেষ ({days} দিন আগে)",
  daysLeftBadge: "আর {days} দিন",
  noExpiryBadge: "মেয়াদ নেই",
  deadTitle: "ডেড স্টক ({days} দিনে বিক্রি হয়নি, তবু স্টক আছে)",
  deadCostMasked:
    "কস্ট প্রাইস আপনার অনুমতিতে নেই (products.edit_cost_price লাগে) — তাই আটকে থাকা মূল্য \"—\" দেখাচ্ছে।",
  deadNone: "ডেড স্টক নেই — স্টক থাকা সব ভ্যারিয়েন্টের সাম্প্রতিক বিক্রি আছে।",
  colStock: "স্টক",
  colStuckValue: "আটকে থাকা মূল্য",
  colLastSale: "শেষ বিক্রি",
  colWarehouseBin: "গুদাম / বিন",
  noCost: "কস্ট নেই",
  neverSold: "কখনো বিক্রি হয়নি",
  binParen: "(বিন {bin})",
  batchTitle: "ব্যাচ / লট (স্টকে আছে এমন)",
  batchNone:
    "কোনো ব্যাচ রেকর্ড নেই — রিসিভের সময় ব্যাচ কোড দিলে এখানে দেখা যাবে। ব্যাচ ছাড়া রিসিভ করা স্টক এই তালিকায় আসে না (তা অনট্র্যাকড, শূন্য নয়)।",
  expiryText: "মেয়াদ {date}",
  noExpiryRecord: "মেয়াদ রেকর্ড নেই",
  reorderTitle: "অটো রি-অর্ডার",
  reorderNote:
    "রি-অর্ডার পয়েন্টে পৌঁছানো ভ্যারিয়েন্টের জন্য শুধু খসড়া (DRAFT) ক্রয় আদেশ তৈরি হয় — সাপ্লায়ারের কাছে কিছুই পাঠানো হয় না। রুল: সেটিংস inventory.reorder.*",
  reorderRunFailed: "রি-অর্ডার চালানো যায়নি",
  runNow: "এখন চালান",
  reorderSummary:
    "বিবেচনায় এসেছে {considered}টি ভ্যারিয়েন্ট · তৈরি হয়েছে {created}টি খসড়া PO · বাদ গেছে {skipped}টি",
  draftPoCreated:
    "খসড়া PO তৈরি: {supplier} — {lines}টি লাইন ({id}) — উপরের ক্রয় আদেশ তালিকা থেকে রিভিউ করুন।",
  skipOpenPo: "খোলা PO আগেই আছে",
  skipNoSupplier: "সাপ্লায়ার ঠিক নেই",
  skipSupplierNotFound: "সাপ্লায়ার পাওয়া যায়নি",
  skipNoCost: "কস্ট জানা নেই",
  skipInvalidRule: "রুল অসম্পূর্ণ",
  skipNoWarehouse: "গুদাম নেই",
  skipCreateFailed: "তৈরি ব্যর্থ",

  // ---- Purchase orders panel (client) ----
  poStatusDraft: "খসড়া",
  poStatusOrdered: "অর্ডার করা",
  poStatusPartial: "আংশিক গৃহীত",
  poStatusReceived: "সম্পূর্ণ গৃহীত",
  poStatusCancelled: "বাতিল",
  listLoadFailed: "তালিকা লোড করা যায়নি",
  poListLoadFailed: "ক্রয় আদেশ লোড করা যায়নি: {error}",
  poListLoading: "ক্রয় আদেশ লোড হচ্ছে…",
  detailLoadFailed: "বিস্তারিত লোড করা যায়নি",
  poEmpty:
    "কোনো ক্রয় আদেশ নেই। API দিয়ে তৈরি করা যায়: POST /api/v1/admin/inventory/purchase-orders (সাপ্লায়ার + গুদাম + ভ্যারিয়েন্ট লাইন)। তৈরি হলেই এখানে রিসিভ করা যাবে।",
  totalText: "মোট",
  receiveDetail: "রিসিভ / বিস্তারিত",
  warehouseText: "গুদাম:",
  defaultWarehouseNote: "(ডিফল্ট গুদাম — এই অর্ডারে গুদাম নির্দিষ্ট করা নেই)",
  receivedValueText: "এখন পর্যন্ত গৃহীত মূল্য:",
  costMaskedNote: "(কস্ট প্রাইস আপনার অনুমতিতে নেই — products.edit_cost_price লাগে)",
  colOrdered: "অর্ডার",
  colReceived: "গৃহীত",
  colRemaining: "বাকি",
  colReceiveNow: "এবার গ্রহণ",
  costText: "কস্ট",
  maxPlaceholder: "সর্বোচ্চ {max}",
  receiveQtyAria: "{name} — এবার গ্রহণের পরিমাণ",
  errAtLeastOne: "অন্তত একটি লাইনে গৃহীত পরিমাণ লিখুন।",
  errOverReceive:
    "অতিরিক্ত রিসিভ — এই লাইনে বাকি আছে মাত্র {remaining}টি। পুরো রিসিভটাই বাতিল হয়েছে, কিছুই জমা হয়নি।",
  errSerialMismatch:
    "সিরিয়াল সংখ্যা গৃহীত পরিমাণের সমান হতে হবে — প্রতিটি পণ্যের একটি করে সিরিয়াল/IMEI দিন। পুরো রিসিভটাই বাতিল হয়েছে।",
  errDuplicateSerial:
    "এই সিরিয়ালটি আগেই রেকর্ড করা আছে (একই ভ্যারিয়েন্টে এক সিরিয়াল দুবার নয়)। পুরো রিসিভটাই বাতিল হয়েছে।",
  errDepthDisabled:
    "ব্যাচ/সিরিয়াল রেকর্ড করতে module.inventory_depth ফিচারটি চালু থাকতে হবে — সেটিংস → ফিচার ফ্ল্যাগ থেকে চালু করুন, অথবা ব্যাচ/সিরিয়াল ছাড়া রিসিভ করুন।",
  errReceiveFailed: "রিসিভ করা যায়নি।",
  noticeReplay: "এই রিসিভটি আগেই জমা হয়েছিল — নতুন করে কিছু যোগ হয়নি।",
  noticeReceived:
    "রিসিভ জমা হয়েছে — এই চালানে {amount} মূল্যের পণ্য স্টকে যোগ হয়েছে। অবস্থা: {status}।",
  erpPosted: " ERP জার্নালে ক্রয়-প্রাপ্তি পোস্ট হয়েছে।",
  erpNotPosted: " ERP পোস্টিং হয়নি ({status}{reason}) — স্টক ঠিকই জমা হয়েছে।",
  erpReasonPrefix: ": {reason}",
  networkError:
    "নেটওয়ার্ক সমস্যা — আবার চেষ্টা করুন। একই বোতামে আবার চাপ দিলে একই রিসিভ দুবার জমা হবে না (idempotency key সক্রিয়)।",
  depthToggle: "ব্যাচ / সিরিয়াল (ঐচ্ছিক) — {name}",
  batchPlaceholder: "ব্যাচ / লট কোড (যেমন LOT-2026-01)",
  batchAria: "ব্যাচ কোড",
  expiryAria: "মেয়াদ শেষের তারিখ",
  binPlaceholder: "বিন / শেলফ (যেমন A-01)",
  binAria: "বিন / শেলফ",
  serialsPlaceholder:
    "সিরিয়াল / IMEI — প্রতিটি লাইনে একটি (সংখ্যা গৃহীত পরিমাণের সমান হতে হবে)",
  serialsAria: "সিরিয়াল / IMEI তালিকা",
  submitReceive: "রিসিভ জমা দিন",
  submitNote:
    "জমা দিলেই স্টক লেজারে PURCHASE_RECEIVE মুভমেন্ট যুক্ত হবে — সংখ্যা শুধু এখানে যা লিখবেন তাই।",
  historyTitle: "রিসিভ ইতিহাস",
  historyNone: "এখনো কোনো রিসিভ হয়নি।",
  historyLine: "{date} · {variantId} · +{delta} (রিসিভের পর হাতে {after})",
  batchesTitle: "এই অর্ডারে রেকর্ড করা ব্যাচ",
  batchSkuText: "SKU: {sku}",
  batchExpiryText: "মেয়াদ: {date}",
  batchNoExpiry: "মেয়াদ রেকর্ড নেই",
  batchBinText: "বিন: {bin}",
  batchSerialText: "সিরিয়াল: {count}টি",
  batchesNote:
    "ব্যাচ ছাড়া রিসিভ করা সিরিয়াল এই অর্ডারের সঙ্গে যুক্ত থাকে না — সেগুলো গভীর বিশ্লেষণে গণনা হয়, এখানে দেখানো যায় না।",
};

export type InventoryStrings = { [K in keyof typeof bn]: string };

const en: InventoryStrings = {
  title: "Inventory",
  description:
    "Real data from the stock ledger — {count} items in total (variant × warehouse). Quantities cannot be edited directly; stock changes only through movements.",
  totalValueCost: "Total value (cost)",
  missingCostNote: "{count} items have no cost recorded — excluded from the valuation",
  totalItems: "Total items",
  itemsCaption: "Counted as variant × warehouse",
  lowStockAlerts: "Low-stock alerts",
  lowStockCaption: "Each product's own threshold; otherwise the default {threshold}",
  emptyTitle: "No items in inventory",
  emptyBody: "Items will appear here as soon as a stock movement lands on a product variant.",
  breakdownTitle: "Breakdown by warehouse (secondary)",
  breakdownNoteBefore:
    "The per-warehouse ledger figures are below — but the number orders/checkout sell against is the",
  breakdownNoteEmphasis: "\"Total available (order figures)\"",
  breakdownNoteAfter:
    "column figure (the variant's cached stock). Because of reserved orders, a warehouse's \"available\" sum can read lower than that.",
  colVariant: "Variant",
  colWarehouse: "Warehouse",
  colOnHand: "On hand",
  colReserved: "Reserved",
  colAvailableHere: "Available in this warehouse",
  colTotalAvailable: "Total available (order figures)",
  badgeLowStock: "Low stock",
  badgeOk: "OK",
  productsCount: "{count} products",
  lowStockNone:
    "No low-stock products — every variant's total available stock is above its own threshold.",
  thresholdText: "Threshold: {threshold}",
  sourceProduct: "Product's own",
  sourceSettings: "Settings",
  sourceDefault: "Default",
  availableBadge: "Available {count}",
  poSectionTitle: "Purchase orders & goods receiving",
  poSectionBody:
    "When a supplier delivery arrives, receive it here — every receive is booked into the stock ledger as a PURCHASE_RECEIVE movement (with the order reference), partial receives can be repeated, and the system will not accept receiving more than was ordered. When an order is fully received, a purchase-receipt posting goes to the ERP journal (when module.erp_lite is on).",
  depthSectionTitle: "In-depth analysis",
  depthSectionBody:
    "Batches/lots and expiry, serial/IMEI accounting, ABC revenue analysis, dead stock and auto-reorder — every figure computed from real records. Stock received without a batch does not enter this analysis (untracked — not counted as zero).",
  footerNote:
    "From the database — API: GET/POST /api/v1/admin/inventory, POST /api/v1/admin/inventory/purchase-orders, GET /api/v1/admin/purchase-orders/[id], POST /api/v1/admin/purchase-orders/[id]/receive (RBAC + ledger, Prisma). Adjustments require a reason; stock changes only through movements.",

  reportLoadFailed: "Could not load the report",
  depthLoadFailed: "Could not load the in-depth analysis: {error}",
  analysisLoading: "Loading analysis…",
  serialLabel: "Serial / IMEI:",
  serialInStock: "{count} in stock",
  serialSold: "{count} sold",
  serialReturned: "{count} returned (damaged)",
  serialTotalNote: "{count} records in total — only serials captured at receive are counted.",
  abcTitle: "ABC analysis (by revenue)",
  abcNote: "A = first 70% of revenue · B = next 20% · C = the rest · Total revenue {total}",
  rangeLabel: "Range:",
  daysOption: "{days} days",
  abcBadge: "{count} variants",
  abcNoSales: "No sales in this range.",
  colClass: "Class",
  colProduct: "Product",
  colUnitsSold: "Sold (units)",
  colRevenue: "Revenue",
  colShare: "Share",
  expiringTitle: "Expiring soon (within the next {days} days)",
  expiringNone: "No batch in stock expires in this window.",
  binText: "Bin {bin}",
  onHandText: "{count} on hand",
  expiredBadge: "Expired ({days} days ago)",
  daysLeftBadge: "{days} days left",
  noExpiryBadge: "No expiry",
  deadTitle: "Dead stock (not sold in {days} days, but still in stock)",
  deadCostMasked:
    "Cost prices are outside your permission (products.edit_cost_price required) — so the tied-up value shows \"—\".",
  deadNone: "No dead stock — every stocked variant has a recent sale.",
  colStock: "Stock",
  colStuckValue: "Tied-up value",
  colLastSale: "Last sale",
  colWarehouseBin: "Warehouse / Bin",
  noCost: "No cost",
  neverSold: "Never sold",
  binParen: "(bin {bin})",
  batchTitle: "Batches / lots (currently in stock)",
  batchNone:
    "No batch records — give a batch code at receive time and it will show here. Stock received without a batch does not appear in this list (it is untracked, not zero).",
  expiryText: "Expiry {date}",
  noExpiryRecord: "No expiry recorded",
  reorderTitle: "Auto-reorder",
  reorderNote:
    "For variants that have reached their reorder point, only DRAFT purchase orders are created — nothing is sent to the supplier. Rules: settings inventory.reorder.*",
  reorderRunFailed: "Could not run the reorder",
  runNow: "Run now",
  reorderSummary:
    "{considered} variants considered · {created} draft POs created · {skipped} skipped",
  draftPoCreated:
    "Draft PO created: {supplier} — {lines} lines ({id}) — review it in the purchase-order list above.",
  skipOpenPo: "An open PO already exists",
  skipNoSupplier: "No supplier set",
  skipSupplierNotFound: "Supplier not found",
  skipNoCost: "Cost unknown",
  skipInvalidRule: "Rule incomplete",
  skipNoWarehouse: "No warehouse",
  skipCreateFailed: "Creation failed",

  poStatusDraft: "Draft",
  poStatusOrdered: "Ordered",
  poStatusPartial: "Partially received",
  poStatusReceived: "Fully received",
  poStatusCancelled: "Cancelled",
  listLoadFailed: "Could not load the list",
  poListLoadFailed: "Could not load purchase orders: {error}",
  poListLoading: "Loading purchase orders…",
  detailLoadFailed: "Could not load the details",
  poEmpty:
    "No purchase orders. They can be created via the API: POST /api/v1/admin/inventory/purchase-orders (supplier + warehouse + variant lines). Once created, they can be received here.",
  totalText: "Total",
  receiveDetail: "Receive / Details",
  warehouseText: "Warehouse:",
  defaultWarehouseNote: "(default warehouse — this order names no warehouse)",
  receivedValueText: "Value received so far:",
  costMaskedNote: "(cost prices are outside your permission — products.edit_cost_price required)",
  colOrdered: "Ordered",
  colReceived: "Received",
  colRemaining: "Remaining",
  colReceiveNow: "Receive now",
  costText: "Cost",
  maxPlaceholder: "Max {max}",
  receiveQtyAria: "{name} — quantity to receive now",
  errAtLeastOne: "Enter a received quantity on at least one line.",
  errOverReceive:
    "Over-receive — only {remaining} left on this line. The whole receive was cancelled; nothing was booked.",
  errSerialMismatch:
    "The serial count must equal the received quantity — give one serial/IMEI per item. The whole receive was cancelled.",
  errDuplicateSerial:
    "This serial is already recorded (the same serial cannot appear twice on one variant). The whole receive was cancelled.",
  errDepthDisabled:
    "Recording batches/serials requires the module.inventory_depth feature to be on — enable it in Settings → Feature Flags, or receive without batch/serial.",
  errReceiveFailed: "Could not complete the receive.",
  noticeReplay: "This receive was already submitted — nothing new was added.",
  noticeReceived:
    "Receive submitted — goods worth {amount} from this delivery were added to stock. Status: {status}.",
  erpPosted: " The purchase receipt was posted to the ERP journal.",
  erpNotPosted: " The ERP posting did not happen ({status}{reason}) — the stock was still booked.",
  erpReasonPrefix: ": {reason}",
  networkError:
    "Network problem — please try again. Pressing the same button again will not book the same receive twice (the idempotency key is active).",
  depthToggle: "Batch / serial (optional) — {name}",
  batchPlaceholder: "Batch / lot code (e.g. LOT-2026-01)",
  batchAria: "Batch code",
  expiryAria: "Expiry date",
  binPlaceholder: "Bin / shelf (e.g. A-01)",
  binAria: "Bin / shelf",
  serialsPlaceholder: "Serial / IMEI — one per line (the count must equal the received quantity)",
  serialsAria: "Serial / IMEI list",
  submitReceive: "Submit receive",
  submitNote:
    "Submitting adds a PURCHASE_RECEIVE movement to the stock ledger — only the quantities you type here.",
  historyTitle: "Receive history",
  historyNone: "No receive has happened yet.",
  historyLine: "{date} · {variantId} · +{delta} (on hand after receive: {after})",
  batchesTitle: "Batches recorded on this order",
  batchSkuText: "SKU: {sku}",
  batchExpiryText: "Expiry: {date}",
  batchNoExpiry: "No expiry recorded",
  batchBinText: "Bin: {bin}",
  batchSerialText: "Serials: {count}",
  batchesNote:
    "Serials received without a batch are not linked to this order — they are counted in the in-depth analysis, but cannot be shown here.",
};

export const INVENTORY_STRINGS: Record<Locale, InventoryStrings> = { bn, en };
