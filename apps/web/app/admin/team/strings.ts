/**
 * Admin team ops — UI dictionary (doc 30 unified language system).
 * bn typed once, en typed as the mapped type — parity is compile-checked.
 * Staff names, shift names, chat bodies and other DATA are never
 * translated; only UI copy lives here. The digest preview text itself
 * (textBn from the API) is generated content, rendered verbatim.
 */
import type { Locale } from "@/i18n/locale";

const bn = {
  // ---- Page shell (server) ----
  title: "টিম",
  description:
    "স্টাফদের উপস্থিতি, শিফট, মাসিক লক্ষ্য (টার্গেট) ও দৈনিক ডাইজেস্ট। উপস্থিতির হিসাব আসে রেকর্ড করা চেক-ইন/চেক-আউট জোড়া থেকে; টার্গেটের অগ্রগতি আসে আসল অর্ডার ইতিহাস থেকে — অনুমান করা কোনো সংখ্যা এখানে নেই।",

  // ---- Attendance + shifts (team-client) ----
  loadFailed: "তথ্য আনা যায়নি।",
  networkError: "নেটওয়ার্ক ত্রুটি।",
  shiftSaveFailed: "শিফট সংরক্ষণ হয়নি।",
  attendanceTitle: "উপস্থিতি — মাসের সারসংক্ষেপ",
  monthLabel: "মাস",
  colStaff: "স্টাফ",
  colDays: "দিন",
  colTotalTime: "মোট সময়",
  cellTitle: "{sessions}টি সেশন · {duration}",
  cellOpenSuffix: " · এখনো খোলা",
  cellAbsent: "অনুপস্থিত",
  minutesOnly: "{m} মিনিট",
  hoursMinutes: "{h}ঘ {m}মি",
  hoursOnly: "{h} ঘণ্টা",
  openBadge: "খোলা {count}",
  gridNote:
    "ঘরের সংখ্যা = ঐ দিনের কাজের ঘণ্টা (বন্ধ হওয়া চেক-ইন/চেক-আউট জোড়া থেকে)। ● = সেশন এখনো খোলা (বন্ধ না হওয়া পর্যন্ত সময় ০ ধরা হয়)। ফাঁকা = কোনো এন্ট্রি নেই।",
  shiftsTitle: "শিফট",
  shiftsNote:
    "শিফট শুধু তথ্যের জন্য — কারো চেক-ইন তার শিফটের সময়ের মধ্যে পড়লে এন্ট্রিতে শিফটের নাম recorded থাকে। বেতন/লেট-জরিমানার কোনো হিসাব এখানে করা হয় না।",
  shiftStaffCount: "· {count} জন স্টাফ",
  editBtn: "সম্পাদনা",
  deleteBtn: "মুছুন",
  shiftNameLabel: "শিফটের নাম",
  shiftNamePlaceholder: "সকালের শিফট",
  shiftStartLabel: "শুরু",
  shiftEndLabel: "শেষ",
  shiftUpdateBtn: "শিফট আপডেট করুন",
  shiftAddBtn: "শিফট যোগ করুন",
  rosterLegend: "এই শিফটে যারা আছেন",

  // ---- Targets panel ----
  targetsLoadFailed: "টার্গেটের তথ্য আনা যায়নি।",
  targetsSaveFailed: "সংরক্ষণ হয়নি।",
  targetsSaved: "টার্গেট সংরক্ষিত হয়েছে।",
  targetsTitle: "মাসিক টার্গেট ও অগ্রগতি",
  colOrdersTarget: "অর্ডার টার্গেট",
  colOrdersProgress: "অগ্রগতি (কনফার্ম করা অর্ডার)",
  colRevenueTarget: "রাজস্ব টার্গেট (৳)",
  colRevenueProgress: "অগ্রগতি (ডেলিভারি করা রাজস্ব)",
  noTargetActual: "টার্গেট নেই · প্রকৃত: {actual}",
  ordersFormat: "{n}টি অর্ডার",
  deliveredPrefix: "ডেলিভারি: ",
  saveTargetsBtn: "টার্গেট সংরক্ষণ করুন",
  replaceAllNote: "সংরক্ষণে পুরো মাসের তালিকা একসাথে যায় — ফাঁকা রাখা স্টাফের টার্গেট মুছে যাবে।",

  // ---- Digest panel ----
  digestLoadFailed: "ডাইজেস্ট আনা যায়নি।",
  digestSaveFailed: "সংরক্ষণ হয়নি।",
  recipientsSaved: "প্রাপকের তালিকা সংরক্ষিত হয়েছে।",
  sendFailed: "পাঠানোর চেষ্টা ব্যর্থ হয়েছে।",
  digestTitle: "দৈনিক ডাইজেস্ট (ইমেইল)",
  dateLabel: "তারিখ",
  recipientsLabel: "প্রাপকদের ইমেইল (প্রতি লাইনে একটি)",
  saveRecipientsBtn: "প্রাপক সংরক্ষণ করুন",
  digestHonestyBefore: "পাঠানো মানে ইমেইল কিউতে (Redis) জব জমা দেওয়া — ",
  digestHonestyStrong: "queued মানে পাঠানো হয়েছে নয়",
  digestHonestyAfter:
    "। আসল ডেলিভারির জন্য worker প্রসেস ও কনফিগার করা email transport দরকার (production-এ worker এখনো চালু হয়নি)। Telegram/Slack চ্যানেল এখানে নেই — codebase-এ কোনো notify service নেই, তাই ভুয়া অপশন দেখানো হয়নি।",
  sendNowBtn: "এখন পাঠান (কিউতে)",
  resultLabel: "ফলাফল: ",
  resultQueued: "সব প্রাপকের জন্য কিউতে জমা হয়েছে (পাঠানো হয়নি)",
  resultNoRecipients: "কোনো প্রাপক নেই — আগে প্রাপক যোগ করুন",
  resultNotQueued: "কিউতে জমা দেওয়া যায়নি",

  // ---- Chat panel ----
  chatLoadFailed: "বার্তা আনা যায়নি।",
  chatSendFailed: "বার্তা পাঠানো যায়নি।",
  chatTitle: "টিম চ্যাট",
  chatNote:
    "প্রতি ১৫ সেকেন্ডে হালনাগাদ হয় (polling — realtime নয়)। সর্বশেষ ১০০টি বার্তা দেখানো হচ্ছে; প্রতি মাসে সর্বোচ্চ ১,০০০টি বার্তা থাকে, পুরনোগুলো মুছে যায় — স্থায়ী রেকর্ডের জন্য অর্ডার নোট/টিকিট ব্যবহার করুন।",
  chatEmpty: "এখনো কোনো বার্তা নেই — প্রথম বার্তাটি লিখুন।",
  chatYou: "আপনি",
  chatStaffFallback: "স্টাফ",
  chatInputLabel: "চ্যাট বার্তা",
  chatPlaceholder: "টিমের জন্য বার্তা লিখুন…",
  chatSendBtn: "পাঠান",
};

export type TeamStrings = { [K in keyof typeof bn]: string };

const en: TeamStrings = {
  title: "Team",
  description:
    "Staff attendance, shifts, monthly targets and the daily digest. Attendance is computed from recorded check-in/check-out pairs; target progress comes from real order history — no figure here is estimated.",

  loadFailed: "Could not load the data.",
  networkError: "Network error.",
  shiftSaveFailed: "The shift could not be saved.",
  attendanceTitle: "Attendance — Monthly Summary",
  monthLabel: "Month",
  colStaff: "Staff",
  colDays: "Days",
  colTotalTime: "Total time",
  cellTitle: "{sessions} sessions · {duration}",
  cellOpenSuffix: " · still open",
  cellAbsent: "Absent",
  minutesOnly: "{m} min",
  hoursMinutes: "{h}h {m}m",
  hoursOnly: "{h} hours",
  openBadge: "{count} open",
  gridNote:
    "The number in a cell = that day's worked hours (from closed check-in/check-out pairs). ● = session still open (counts as 0 until closed). Blank = no entry.",
  shiftsTitle: "Shifts",
  shiftsNote:
    "Shifts are informational only — when a check-in falls within a shift's hours, the shift name is recorded on the entry. No payroll or late-penalty calculation happens here.",
  shiftStaffCount: "· {count} staff",
  editBtn: "Edit",
  deleteBtn: "Delete",
  shiftNameLabel: "Shift name",
  shiftNamePlaceholder: "Morning shift",
  shiftStartLabel: "Start",
  shiftEndLabel: "End",
  shiftUpdateBtn: "Update shift",
  shiftAddBtn: "Add shift",
  rosterLegend: "Staff on this shift",

  targetsLoadFailed: "Target data could not be loaded.",
  targetsSaveFailed: "Could not save.",
  targetsSaved: "Targets saved.",
  targetsTitle: "Monthly Targets & Progress",
  colOrdersTarget: "Orders target",
  colOrdersProgress: "Progress (confirmed orders)",
  colRevenueTarget: "Revenue target (৳)",
  colRevenueProgress: "Progress (delivered revenue)",
  noTargetActual: "No target · Actual: {actual}",
  ordersFormat: "{n} orders",
  deliveredPrefix: "Delivered: ",
  saveTargetsBtn: "Save targets",
  replaceAllNote: "Saving sends the whole month's list at once — staff left blank will have their target cleared.",

  digestLoadFailed: "The digest could not be loaded.",
  digestSaveFailed: "Could not save.",
  recipientsSaved: "Recipient list saved.",
  sendFailed: "The send attempt failed.",
  digestTitle: "Daily Digest (Email)",
  dateLabel: "Date",
  recipientsLabel: "Recipient emails (one per line)",
  saveRecipientsBtn: "Save recipients",
  digestHonestyBefore: "Sending means submitting a job to the email queue (Redis) — ",
  digestHonestyStrong: "queued does not mean sent",
  digestHonestyAfter:
    ". Real delivery needs a worker process and a configured email transport (the worker is not running in production yet). There are no Telegram/Slack channels here — the codebase has no notify service, so no fake options are shown.",
  sendNowBtn: "Send now (to queue)",
  resultLabel: "Result: ",
  resultQueued: "Queued for all recipients (not sent)",
  resultNoRecipients: "No recipients — add recipients first",
  resultNotQueued: "Could not be queued",

  chatLoadFailed: "Messages could not be loaded.",
  chatSendFailed: "The message could not be sent.",
  chatTitle: "Team Chat",
  chatNote:
    "Refreshes every 15 seconds (polling — not realtime). Showing the latest 100 messages; at most 1,000 messages are kept per month and older ones are deleted — use order notes/tickets for a permanent record.",
  chatEmpty: "No messages yet — write the first one.",
  chatYou: "You",
  chatStaffFallback: "Staff",
  chatInputLabel: "Chat message",
  chatPlaceholder: "Write a message for the team…",
  chatSendBtn: "Send",
};

export const TEAM_STRINGS: Record<Locale, TeamStrings> = { bn, en };
