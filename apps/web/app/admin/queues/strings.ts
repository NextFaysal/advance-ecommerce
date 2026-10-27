/**
 * Admin queue monitor — UI dictionary (doc 30 unified language system).
 * bn typed once, en typed as the mapped type — parity is compile-checked.
 * Queue DATA (names, handler names, unblock steps from the catalogue
 * builder) is never translated; queue purposes arrive as a {Bn, En}
 * pair from the catalogue and are selected by locale.
 */
import type { Locale } from "@/i18n/locale";

const bn = {
  title: "কিউ মনিটর",
  description: "ব্যাকগ্রাউন্ড জব সিস্টেমের কনফিগার করা অবস্থা (লাইভ কাউন্ট এখনো পাওয়া যাচ্ছে না)",
  breadcrumb: "সিস্টেম / কিউ মনিটর",
  workerStatus: "ওয়ার্কার স্ট্যাটাস",
  daemonBadge: "✕ ডেমন চলছে না (daemon: not_running)",
  reasonBadge: "কারণ: bullmq_not_installed",
  workerBody1: " এখন শুধু wiring + policy layer — ",
  workerBody2: "/",
  workerBody3:
    " ইনস্টল করা নেই এবং কোনো worker entrypoint নেই। তাই কোনো ডেমন চলছে না এবং লাইভ জব কাউন্ট পড়া যাচ্ছে না (",
  workerBody4: ") — এই পেজে কোনো উদ্ভাবিত সংখ্যা দেখানো হয় না।",
  unblockHeading: "চালু করতে যা লাগবে (workers.ts অনুযায়ী)",
  caption: "কনফিগার করা কিউ — মোট {count}টি (নীতি: src/jobs/queues.ts + workers.ts)",
  colQueue: "কিউ",
  colPurpose: "উদ্দেশ্য",
  colRetry: "রিট্রাই নীতি",
  colConcurrency: "Concurrency",
  colHandler: "হ্যান্ডলার",
  retryTemplate: "{attempts} বার চেষ্টা · {backoff} সে. ব্যবধান (exponential)",
  payloadTitle: "পেলোড নিরাপত্তা",
  payloadBody1: "প্রতিটি জবের পেলোডে শুধু ID আর masked reference থাকে —",
  payloadBody2:
    "-এর নিয়ম অনুযায়ী পেলোড বা লগে কোনো secret অথবা পুরো ফোন নম্বর plain text-এ রাখা নিষেধ। হ্যান্ডলাররা শুধু id, template key, provider-এর নাম আর masked ref লগ করে (",
  payloadBody3: ")।",
  recentTitle: "সাম্প্রতিক জব",
  recentDesc: "লাইভ ডেটা নেই — worker চালু হলে এখানে job দেখা যাবে",
};

export type QueuesStrings = { [K in keyof typeof bn]: string };

const en: QueuesStrings = {
  title: "Queue Monitor",
  description: "Configured state of the background job system (live counts are not available yet)",
  breadcrumb: "System / Queue Monitor",
  workerStatus: "Worker Status",
  daemonBadge: "✕ Daemon not running (daemon: not_running)",
  reasonBadge: "Reason: bullmq_not_installed",
  workerBody1: " is currently only a wiring + policy layer — ",
  workerBody2: "/",
  workerBody3:
    " are not installed and there is no worker entrypoint. So no daemon is running and no live job counts can be read (",
  workerBody4: ") — no invented numbers are shown on this page.",
  unblockHeading: "What is needed to start it (per workers.ts)",
  caption: "Configured queues — {count} in total (policy: src/jobs/queues.ts + workers.ts)",
  colQueue: "Queue",
  colPurpose: "Purpose",
  colRetry: "Retry policy",
  colConcurrency: "Concurrency",
  colHandler: "Handler",
  retryTemplate: "{attempts} attempts · {backoff}s interval (exponential)",
  payloadTitle: "Payload Safety",
  payloadBody1: "Every job payload carries only IDs and masked references — under the rules in",
  payloadBody2:
    ", no secret or full phone number may be kept in plain text in a payload or log. Handlers log only the id, template key, provider name and masked ref (",
  payloadBody3: ").",
  recentTitle: "Recent Jobs",
  recentDesc: "No live data — jobs will appear here once the worker is running",
};

export const QUEUES_STRINGS: Record<Locale, QueuesStrings> = { bn, en };
