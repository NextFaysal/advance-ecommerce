import type { ReactNode } from "react";
import { prisma } from "@advance-ecommerce/db";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import {
  COURIER_PROVIDERS,
  EMAIL_PROVIDERS,
  PAYMENT_PROVIDERS,
  SETTING_DEFAULTS,
  SMS_PROVIDERS,
  STORAGE_PROVIDERS,
  getIntegrationStatus,
  getPublicSettings,
  getSetting,
  type IntegrationStatus,
} from "@/lib/settings";
import { TRACKING_SETTING_KEYS } from "@/tracking/settings";
import { loadOrderRules } from "@/checkout/order-rules";
import { loadDeliverySlots } from "@/checkout/delivery-slots";
import { getEmailTransportStatus } from "@/email/config";
import { getMaintenanceConfig } from "@/privacy/maintenance";
import { StoreNameCard } from "./store-name-card";

// Settings index — landing page for Admin > Settings.
// The card statuses are REAL (2026-10-25; previously labelled demo
// booleans): each card probes the same sources the Settings API uses —
// getIntegrationStatus() over the encrypted Settings store (a provider
// counts as "configured" when a credential row exists; the value is
// NEVER read onto this page), Settings values for tracking IDs, and
// mere env PRESENCE for infra keys (REDIS_URL, MEILISEARCH_HOST,
// WEB_PUSH_VAPID_*) — presence only, values never exposed. A probe
// that cannot run (e.g. DB unreachable) renders "যাচাই করা যায়নি"
// instead of a fake tick.

export const dynamic = "force-dynamic";

type StatusTone = "success" | "warning" | "neutral";

interface CardStatus {
  tone: StatusTone;
  label: string;
  detail: string;
}

const UNVERIFIABLE: CardStatus = {
  tone: "neutral",
  label: "যাচাই করা যায়নি",
  detail: "ডাটাবেস পাওয়া যাচ্ছে না — অবস্থা পড়া যায়নি।",
};

/** bps -> percent text without trailing zeros: 1500 -> "15", 1550 -> "15.5", 1505 -> "15.05". */
function formatBpsAsPercent(bps: number): string {
  const whole = Math.floor(bps / 100);
  const frac = bps % 100;
  if (frac === 0) return String(whole);
  return `${whole}.${String(frac).padStart(2, "0").replace(/0$/, "")}`;
}

function providerSummary(statuses: IntegrationStatus[], exclude: string[] = []): {
  configured: string[];
  enabled: string[];
  total: number;
} {
  const relevant = statuses.filter((s) => !exclude.includes(s.provider));
  return {
    configured: relevant.filter((s) => s.configured).map((s) => s.provider),
    enabled: relevant.filter((s) => s.enabled).map((s) => s.provider),
    total: relevant.length,
  };
}

function providerStatus(statuses: IntegrationStatus[], exclude: string[] = []): CardStatus {
  const { configured, enabled, total } = providerSummary(statuses, exclude);
  if (configured.length === 0) {
    return {
      tone: "warning",
      label: "কনফিগার হয়নি",
      detail: `কোনো প্রোভাইডারের ক্রেডেনশিয়াল সংরক্ষিত নেই (মোট ${total}টি প্রোভাইডার)।`,
    };
  }
  return {
    tone: "success",
    label: "কনফিগার হয়েছে",
    detail: `ক্রেডেনশিয়াল আছে: ${configured.join(", ")} · চালু: ${enabled.length > 0 ? enabled.join(", ") : "কোনোটিই নয়"} (${total}টির মধ্যে ${configured.length}টি কনফিগার)।`,
  };
}

async function probe(fn: () => Promise<CardStatus>): Promise<CardStatus> {
  try {
    return await fn();
  } catch {
    return UNVERIFIABLE;
  }
}

function envPresent(name: string): boolean {
  const v = process.env[name];
  return v !== undefined && v !== "";
}

interface SettingsCardInfo {
  href: string;
  icon: ReactNode;
  titleBn: string;
  titleEn: string;
  description: string;
  status: CardStatus;
}

export default async function AdminSettingsPage() {
  // General summary: real public settings (DB values over defaults),
  // with the same fallback the Settings API GET uses when the DB is
  // unreachable — defaults are then labelled as defaults, not DB data.
  let publicSettings: Record<string, string> = {};
  let dbReady = true;
  try {
    publicSettings = await getPublicSettings();
  } catch {
    dbReady = false;
    for (const [key, def] of Object.entries(SETTING_DEFAULTS)) {
      if (def.isPublic) publicSettings[key] = def.value;
    }
  }
  const locale = publicSettings["general.locale"] ?? SETTING_DEFAULTS["general.locale"]!.value;
  const currency = publicSettings["general.currency"] ?? SETTING_DEFAULTS["general.currency"]!.value;
  const timezone = publicSettings["general.timezone"] ?? SETTING_DEFAULTS["general.timezone"]!.value;
  const storeName = publicSettings["general.store_name"] ?? SETTING_DEFAULTS["general.store_name"]!.value;

  const payments = await probe(async () => {
    const statuses = await getIntegrationStatus("payment", PAYMENT_PROVIDERS);
    // COD needs no credential, so it is excluded from the credential
    // count and noted in the detail instead of skewing the verdict.
    const base = providerStatus(statuses, ["cod"]);
    return { ...base, detail: `${base.detail} COD-তে ক্রেডেনশিয়াল লাগে না।` };
  });

  const courier = await probe(async () =>
    providerStatus(await getIntegrationStatus("courier", COURIER_PROVIDERS)),
  );

  const notifications = await probe(async () => {
    const sms = providerSummary(await getIntegrationStatus("sms", SMS_PROVIDERS));
    const email = providerSummary(await getIntegrationStatus("email", EMAIL_PROVIDERS));
    const anyConfigured = sms.configured.length + email.configured.length > 0;
    const fmt = (label: string, s: typeof sms) =>
      `${label}: ক্রেডেনশিয়াল ${s.configured.length > 0 ? s.configured.join(", ") : "নেই"} · চালু ${s.enabled.length > 0 ? s.enabled.join(", ") : "নেই"}`;
    // ADV-3: the email TRANSPORT verdict is stricter than a credential
    // row existing — it is exactly what src/email/config.ts resolves
    // at send time (provider + api_key + from_address). Booleans and a
    // machine reason only; no credential value is read onto this page.
    const transport = await getEmailTransportStatus();
    const transportText = transport.configured
      ? `ইমেইল ট্রান্সপোর্ট (${transport.provider}): প্রস্তুত — অর্ডার নিশ্চিতকরণ ও স্টাফ আমন্ত্রণ ইমেইল কিউ থেকে পাঠানো যাবে (ওয়ার্কার চালু থাকলে)।`
      : `ইমেইল ট্রান্সপোর্ট (${transport.provider}): প্রস্তুত নয় — ${transport.reason ?? "unknown"}। কিউতে থাকা ইমেইল SKIP হবে, পাঠানো হয়েছে বলে দেখানো হবে না।`;
    return {
      tone: anyConfigured ? "success" : "warning",
      label: anyConfigured ? "কনফিগার হয়েছে" : "কনফিগার হয়নি",
      detail: `${fmt("SMS", sms)}। ${fmt("ইমেইল", email)}। ${transportText}`,
    } satisfies CardStatus;
  });

  const integrations = await probe(async () => {
    const storage = providerSummary(await getIntegrationStatus("storage", STORAGE_PROVIDERS));
    const redis = envPresent("REDIS_URL");
    const meili = envPresent("MEILISEARCH_HOST");
    const push =
      envPresent("WEB_PUSH_VAPID_PUBLIC_KEY") && envPresent("WEB_PUSH_VAPID_PRIVATE_KEY");
    const storageConfigured = storage.configured.length > 0;
    return {
      tone: storageConfigured ? "success" : "warning",
      label: storageConfigured ? "স্টোরেজ কনফিগার হয়েছে" : "স্টোরেজ কনফিগার হয়নি",
      detail:
        `স্টোরেজ (R2/S3) ক্রেডেনশিয়াল: ${storage.configured.length > 0 ? storage.configured.join(", ") : "নেই"} · ` +
        `Redis (env REDIS_URL): ${redis ? "সেট আছে" : "সেট নেই"} · ` +
        `Meilisearch (env MEILISEARCH_HOST): ${meili ? "সেট আছে" : "সেট নেই"} · ` +
        `Web Push (env VAPID key): ${push ? "সেট আছে" : "সেট নেই"}। env মান কখনো দেখানো হয় না — শুধু আছে/নেই।`,
    } satisfies CardStatus;
  });

  const tracking = await probe(async () => {
    const ids: { name: string; value: string | null }[] = [
      { name: "Meta Pixel", value: await getSetting(TRACKING_SETTING_KEYS.metaPixelId) },
      { name: "GA4", value: await getSetting(TRACKING_SETTING_KEYS.ga4MeasurementId) },
      { name: "TikTok Pixel", value: await getSetting(TRACKING_SETTING_KEYS.tiktokPixelId) },
      { name: "GTM", value: await getSetting(TRACKING_SETTING_KEYS.gtmContainerId) },
    ];
    const setIds = ids.filter((i) => i.value !== null && i.value !== "").map((i) => i.name);
    // Secret tokens: presence of the encrypted row only — the value is
    // never decrypted or read onto this page.
    let capiToken = false;
    const tokenRow = await prisma.setting.findUnique({
      where: { key: TRACKING_SETTING_KEYS.metaAccessToken },
    });
    capiToken = tokenRow !== null && tokenRow.value !== "";
    if (setIds.length === 0 && !capiToken) {
      return {
        tone: "warning",
        label: "কনফিগার হয়নি",
        detail: "কোনো পিক্সেল আইডি (Meta/GA4/TikTok/GTM) বা CAPI টোকেন সংরক্ষিত নেই।",
      } satisfies CardStatus;
    }
    return {
      tone: "success",
      label: "কনফিগার হয়েছে",
      detail: `আইডি আছে: ${setIds.length > 0 ? setIds.join(", ") : "নেই"} · Meta CAPI টোকেন: ${capiToken ? "আছে (এনক্রিপ্ট করা)" : "নেই"}।`,
    } satisfies CardStatus;
  });

  // Accounting / VAT: the effective rate, parsed with the same rule
  // the order flow uses — blank/invalid means no VAT split is recorded.
  const accounting = await probe(async () => {
    const raw = await getSetting("accounting.vat_rate_bps");
    if (raw === null || raw.trim() === "") {
      return {
        tone: "neutral",
        label: "VAT বন্ধ",
        detail: "কোনো VAT হার সেট করা নেই — নতুন অর্ডারে VAT বিভাজন সংরক্ষিত হয় না। হার সেট করতে কার্ডটি খুলুন।",
      } satisfies CardStatus;
    }
    const bps = Number.parseInt(raw, 10);
    if (Number.isInteger(bps) && bps > 0 && bps <= 10000) {
      return {
        tone: "success",
        label: "VAT চালু",
        detail: `বর্তমান হার ${formatBpsAsPercent(bps)}% (${bps} bps) — প্রতিটি নতুন অর্ডারে VAT বিভাজন সংরক্ষিত হয়; মাসিক রিপোর্ট ERP পেজে।`,
      } satisfies CardStatus;
    }
    return {
      tone: "warning",
      label: "হার অবৈধ",
      detail: "সেভ করা মানটি বৈধ VAT হার নয় — বন্ধ হিসেবে ধরা হচ্ছে। কার্ডটি খুলে সঠিক হার সেভ করুন।",
    } satisfies CardStatus;
  });

  // Order rules + delivery slots (doc 18 F2-1): the effective state is
  // what the checkout loaders compute — the same fail-open parse the
  // order flow enforces, not the raw stored strings.
  const orders = await probe(async () => {
    const rules = await loadOrderRules();
    const slots = await loadDeliverySlots();
    const activeRules =
      (rules.minOrderPoisha > 0 ? 1 : 0) +
      (rules.advanceRequiredAbovePoisha > 0 ? 1 : 0) +
      (rules.codDisabledDistricts.length > 0 ? 1 : 0) +
      (rules.codDisabledCategories.length > 0 ? 1 : 0);
    return {
      tone: activeRules > 0 ? "success" : "neutral",
      label: activeRules > 0 ? `${activeRules}টি নিয়ম চালু` : "সব নিয়ম বন্ধ",
      detail:
        `সর্বনিম্ন অর্ডার ${rules.minOrderPoisha > 0 ? "চালু" : "বন্ধ"} · অগ্রিম নিয়ম ${rules.advanceRequiredAbovePoisha > 0 ? "চালু" : "বন্ধ"} · ` +
        `COD বন্ধ: জেলা ${rules.codDisabledDistricts.length}টি, ক্যাটাগরি ${rules.codDisabledCategories.length}টি · ডেলিভারি স্লট ${slots.length}টি।`,
    } satisfies CardStatus;
  });

  // Call-center timings (doc 21, G3-17): the effective values of the
  // seven call_center.* keys — getSetting() resolves DB row -> env ->
  // built-in default, the same resolution the consumers read live.
  const callCenter = await probe(async () => {
    const intOf = async (key: string): Promise<number> => {
      const raw = await getSetting(key);
      const parsed = raw === null ? NaN : Number.parseInt(raw, 10);
      return Number.isInteger(parsed)
        ? parsed
        : Number.parseInt(SETTING_DEFAULTS[key]!.value, 10);
    };
    const [slaConfirm, slaRescue, startHour, endHour, retention] = await Promise.all([
      intOf("call_center.sla_confirm_minutes"),
      intOf("call_center.sla_rescue_minutes"),
      intOf("call_center.calling_start_hour"),
      intOf("call_center.calling_end_hour"),
      intOf("call_center.log_retention_months"),
    ]);
    return {
      tone: "neutral",
      label: "সম্পাদনাযোগ্য",
      detail: `SLA: কনফার্ম ${slaConfirm} মিনিট · রেসকিউ ${slaRescue} মিনিট · কলিং উইন্ডো ${startHour}:00–${endHour}:00 (ঢাকা) · কল-লগ সংরক্ষণ ${retention} মাস।`,
    } satisfies CardStatus;
  });

  // Privacy & maintenance (ADV-29): the effective maintenance state
  // through the same reader the storefront gate resolves with.
  const privacy = await probe(async () => {
    const cfg = await getMaintenanceConfig();
    return cfg.enabled
      ? {
          tone: "warning",
          label: "মেইনটেন্যান্স চালু",
          detail: "স্টোরফ্রন্টে 503 পেজ দেখাচ্ছে; অ্যাডমিন প্যানেল চালু আছে। বন্ধ করতে কার্ডটি খুলুন।",
        } satisfies CardStatus
      : {
          tone: "success",
          label: "মেইনটেন্যান্স বন্ধ",
          detail: "স্টোরফ্রন্ট সবার জন্য খোলা। সম্মতি লগ, ডেটা এক্সপোর্ট ও অ্যাকাউন্ট মুছে ফেলার লেজার কার্ডের ভেতরে।",
        } satisfies CardStatus;
  });

  // Outbound connectors (ADV-25 part 2): per-channel enabled +
  // credential presence, resolved exactly as the fan-out resolves
  // them at send time (src/connectors/config.ts). Presence is read
  // from getSetting() and reduced to booleans here — no credential
  // value is rendered on this page.
  const connectors = await probe(async () => {
    const present = async (key: string) => ((await getSetting(key)) ?? "").trim() !== "";
    const channels: { name: string; enabled: boolean; ready: boolean }[] = [
      {
        name: "Slack",
        enabled: ((await getSetting("connectors.slack.enabled")) ?? "").trim() === "true",
        ready: await present("connectors.slack.webhook_url"),
      },
      {
        name: "Telegram",
        enabled: ((await getSetting("connectors.telegram.enabled")) ?? "").trim() === "true",
        ready:
          (await present("connectors.telegram.bot_token")) &&
          (await present("connectors.telegram.chat_id")),
      },
      {
        name: "Google Sheets",
        enabled: ((await getSetting("connectors.sheets.enabled")) ?? "").trim() === "true",
        ready:
          (await present("connectors.sheets.service_account_json")) &&
          (await present("connectors.sheets.spreadsheet_id")),
      },
    ];
    const live = channels.filter((c) => c.enabled && c.ready).map((c) => c.name);
    const fmt = (c: (typeof channels)[number]) =>
      `${c.name}: ${c.enabled ? "চালু" : "বন্ধ"} · ক্রেডেনশিয়াল ${c.ready ? "আছে" : "নেই"}`;
    return {
      tone: live.length > 0 ? "success" : "neutral",
      label: live.length > 0 ? `${live.join(", ")} লাইভ` : "কোনো চ্যানেল লাইভ নয়",
      detail: `${channels.map(fmt).join(" · ")}।`,
    } satisfies CardStatus;
  });

  const cards: SettingsCardInfo[] = [
    {
      href: "/admin/settings/payments",
      icon: <Icon name="credit-card" size={22} />,
      titleBn: "পেমেন্ট",
      titleEn: "Payments",
      description: "COD, bKash, Nagad, Rocket, Upay, SSLCommerz, AamarPay, ShurjoPay — পদ্ধতি চালু/বন্ধ, sandbox/live মোড।",
      status: payments,
    },
    {
      href: "/admin/settings/shipping",
      icon: <Icon name="truck" size={22} />,
      titleBn: "কুরিয়ার / শিপিং",
      titleEn: "Courier / Shipping",
      description: "Steadfast, Pathao, RedX, Paperfly, eCourier — জোন ও চার্জ, কুরিয়ার অ্যাকাউন্ট সংযোগ।",
      status: courier,
    },
    {
      href: "/admin/settings/notifications",
      icon: <Icon name="bell" size={22} />,
      titleBn: "নোটিফিকেশন",
      titleEn: "Notifications",
      description: "SMS (BulkSMSBD, SSL Wireless, Greenweb) ও ইমেইল (Resend + SMTP) প্রোভাইডার এবং টেমপ্লেট।",
      status: notifications,
    },
    {
      href: "/admin/settings/integrations",
      icon: <Icon name="settings" size={22} />,
      titleBn: "ইন্টিগ্রেশন",
      titleEn: "Integrations",
      description: "স্টোরেজ (Cloudflare R2), সার্চ (Meilisearch), Redis ও Web Push — সংযোগ অবস্থা (env আছে/নেই)।",
      status: integrations,
    },
    {
      href: "/admin/settings/connectors",
      icon: <Icon name="sparkles" size={22} />,
      titleBn: "কানেক্টর",
      titleEn: "Connectors",
      description: "Slack, Telegram ও Google Sheets — অর্ডার/স্টক ইভেন্টের আউটবাউন্ড অ্যালার্ট ও Sheets অর্ডার লগ (connectors.*)।",
      status: connectors,
    },
    {
      href: "/admin/settings/tracking",
      icon: <Icon name="chart" size={22} />,
      titleBn: "ট্র্যাকিং",
      titleEn: "Tracking",
      description: "Meta Pixel + CAPI, GA4, TikTok — পিক্সেল আইডি ও সার্ভার-সাইড ইভেন্ট সেটিংস।",
      status: tracking,
    },
    {
      href: "/admin/settings/accounting",
      icon: <Icon name="banknote" size={22} />,
      titleBn: "হিসাব / VAT",
      titleEn: "Accounting / VAT",
      description: "বিক্রয়ের VAT হার (accounting.vat_rate_bps) — সেট থাকলে প্রতিটি অর্ডারে VAT বিভাজন সংরক্ষিত হয়; রিপোর্ট ERP পেজে।",
      status: accounting,
    },
    {
      href: "/admin/settings/orders",
      icon: <Icon name="cart" size={22} />,
      titleBn: "অর্ডার নিয়ম ও স্লট",
      titleEn: "Order Rules & Slots",
      description: "সর্বনিম্ন অর্ডার, অগ্রিমের সীমা ও হার, COD বন্ধের জেলা/ক্যাটাগরি (orders.rules.*) এবং ডেলিভারি স্লট (orders.delivery_slots)।",
      status: orders,
    },
    {
      href: "/admin/settings/call-center",
      icon: <Icon name="phone" size={22} />,
      titleBn: "কল সেন্টার",
      titleEn: "Call Center",
      description: "সুপারভাইজার SLA সীমা, ফলো-আপ অটোমেশন SMS-এর সময়, কলিং উইন্ডো ও কল-লগ সংরক্ষণের মেয়াদ (call_center.*)।",
      status: callCenter,
    },
    {
      href: "/admin/settings/privacy",
      icon: <Icon name="shield" size={22} />,
      titleBn: "গোপনীয়তা ও মেইনটেন্যান্স",
      titleEn: "Privacy & Maintenance",
      description: "কাস্টমার ডেটা এক্সপোর্ট/মুছে ফেলার লেজার, মার্কেটিং সম্মতির লগ এবং স্টোরফ্রন্ট মেইনটেন্যান্স মোড (site.maintenance)।",
      status: privacy,
    },
  ];

  return (
    <main>
      <PageHeader
        title="সেটিংস"
        description="সব ইন্টিগ্রেশন অ্যাডমিন থেকেই কনফিগার করা যায়: env শুধু ডিফল্ট/ফলব্যাক, DB-তে এনক্রিপ্ট করা Settings মানই চূড়ান্ত (override)। (Settings)"
        breadcrumb="Admin / System"
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="ভাষা (ডিফল্ট)" value={locale === "bn" ? "বাংলা (bn)" : locale} delta="fallback: English" icon={<span className="text-base font-bold">বাং</span>} />
        <StatCard label="মুদ্রা" value={`${currency} (৳)`} delta="পয়সা (integer) হিসাব" icon={<Icon name="banknote" size={22} />} />
        <StatCard label="সময় অঞ্চল" value={timezone} delta="সব তারিখ/সময়" icon={<Icon name="clock" size={22} />} />
        <StatCard label="সাব-পেজ" value={String(cards.length)} delta="নিচে কার্ড আকারে" icon={<Icon name="grid" size={22} />} />
      </div>

      <Card className="mb-6">
        <h2 className="mb-1 font-semibold">সাধারণ সেটিংস সারাংশ</h2>
        <dl className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-text-muted">স্টোরের নাম — <code>general.store_name</code></dt>
            <dd className="font-semibold">{storeName.trim() !== "" ? storeName : "সেট হয়নি (ইনভয়েস/পে পেজে নাম দেখায় না)"}</dd>
          </div>
          <div>
            <dt className="text-text-muted">ডিফল্ট ভাষা — <code>general.locale</code></dt>
            <dd className="font-semibold">{locale === "bn" ? "bn (বাংলা), fallback en" : locale}</dd>
          </div>
          <div>
            <dt className="text-text-muted">মুদ্রা — <code>general.currency</code></dt>
            <dd className="font-semibold">{currency} — সব টাকা integer পয়সায় সংরক্ষিত</dd>
          </div>
          <div>
            <dt className="text-text-muted">সময় অঞ্চল — <code>general.timezone</code></dt>
            <dd className="font-semibold">{timezone}</dd>
          </div>
        </dl>
        <p className="mt-3 text-sm text-text-muted">
          {dbReady
            ? "উপরের মানগুলো আসল Settings স্টোর থেকে পড়া (DB মান না থাকলে বিল্ট-ইন ডিফল্ট)। "
            : "ডাটাবেস পাওয়া যাচ্ছে না — উপরে বিল্ট-ইন ডিফল্ট দেখানো হচ্ছে, DB-র মান নয়। "}
          গোপন মান (API key, পাসওয়ার্ড) কখনো এই পেজে দেখানো হয় না — কার্ডগুলোতে শুধু
          কনফিগার হয়েছে/হয়নি (boolean) অবস্থা থাকে।
        </p>
      </Card>

      <div className="mb-6">
        <StoreNameCard initial={storeName} dbReady={dbReady} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <Card key={card.href}>
            <div className="flex items-start justify-between">
              <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-[14px] bg-brand-50 text-brand-600 shadow-sm">
                {card.icon}
              </span>
              <Badge tone={card.status.tone}>{card.status.label}</Badge>
            </div>
            <h3 className="mt-3 font-semibold">
              {card.titleBn} <span className="text-sm font-normal text-text-muted">· {card.titleEn}</span>
            </h3>
            <p className="mt-1 text-sm text-text-muted">{card.description}</p>
            <p className="mt-2 text-sm text-text-muted">{card.status.detail}</p>
            <a href={card.href} className="mt-3 inline-block text-sm font-medium text-brand-700">
              খুলুন →
            </a>
          </Card>
        ))}
      </div>

      <p className="mt-6 text-sm text-text-muted">
        নোট: কার্ডের অবস্থা এখন আসল — Settings স্টোরে ক্রেডেনশিয়াল সারি আছে কিনা এবং
        সার্ভার env-তে চাবি আছে কিনা দেখে নির্ধারিত (শুধু boolean; কোনো credential মান
        কখনো এই পেজে আসে না)। "চালু" মানে সংশ্লিষ্ট <code>enabled</code> সেটিং true।
      </p>
    </main>
  );
}
