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
import {
  OVERRIDABLE_EMAIL_KEYS,
  loadEmailOverrides,
  loadInvoiceOverrides,
} from "@/templates/overrides";
import { loadOrderRules } from "@/checkout/order-rules";
import { loadDeliverySlots } from "@/checkout/delivery-slots";
import { getEmailTransportStatus } from "@/email/config";
import { getMaintenanceConfig } from "@/privacy/maintenance";
import { getRequestLocale } from "@/i18n/server";
import { interpolate, isLocale, pick, type Locale } from "@/i18n/locale";
import { SETTINGS_STRINGS, type SettingsStrings } from "./strings";
import { StoreNameCard } from "./store-name-card";
import { DefaultLanguageCard } from "./default-language-card";

// Settings index — landing page for Admin > Settings.
// The card statuses are REAL (2026-10-25; previously labelled demo
// booleans): each card probes the same sources the Settings API uses —
// getIntegrationStatus() over the encrypted Settings store (a provider
// counts as "configured" when a credential row exists; the value is
// NEVER read onto this page), Settings values for tracking IDs, and
// mere env PRESENCE for infra keys (REDIS_URL, MEILISEARCH_HOST,
// WEB_PUSH_VAPID_*) — presence only, values never exposed. A probe
// that cannot run (e.g. DB unreachable) renders the unverifiable label
// instead of a fake tick.

export const dynamic = "force-dynamic";

type StatusTone = "success" | "warning" | "neutral";

interface CardStatus {
  tone: StatusTone;
  label: string;
  detail: string;
}

function unverifiable(s: SettingsStrings): CardStatus {
  return { tone: "neutral", label: s.stUnverifiable, detail: s.stUnverifiableDetail };
}

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

function providerStatus(statuses: IntegrationStatus[], s: SettingsStrings, exclude: string[] = []): CardStatus {
  const { configured, enabled, total } = providerSummary(statuses, exclude);
  if (configured.length === 0) {
    return {
      tone: "warning",
      label: s.stNotConfigured,
      detail: interpolate(s.provNoneDetail, { total }),
    };
  }
  return {
    tone: "success",
    label: s.stConfigured,
    detail: interpolate(s.provDetail, {
      configured: configured.join(", "),
      enabled: enabled.length > 0 ? enabled.join(", ") : s.stNoneAtAll,
      total,
      count: configured.length,
    }),
  };
}

async function probe(fn: () => Promise<CardStatus>, s: SettingsStrings): Promise<CardStatus> {
  try {
    return await fn();
  } catch {
    return unverifiable(s);
  }
}

function envPresent(name: string): boolean {
  const v = process.env[name];
  return v !== undefined && v !== "";
}

interface SettingsCardInfo {
  href: string;
  icon: ReactNode;
  title: string;
  description: string;
  status: CardStatus;
}

export default async function AdminSettingsPage() {
  const reqLocale: Locale = await getRequestLocale();
  const s = pick(reqLocale, SETTINGS_STRINGS);
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
  const storeLocale = publicSettings["general.locale"] ?? SETTING_DEFAULTS["general.locale"]!.value;
  const currency = publicSettings["general.currency"] ?? SETTING_DEFAULTS["general.currency"]!.value;
  const timezone = publicSettings["general.timezone"] ?? SETTING_DEFAULTS["general.timezone"]!.value;
  const storeName = publicSettings["general.store_name"] ?? SETTING_DEFAULTS["general.store_name"]!.value;

  const payments = await probe(async () => {
    const statuses = await getIntegrationStatus("payment", PAYMENT_PROVIDERS);
    // COD needs no credential, so it is excluded from the credential
    // count and noted in the detail instead of skewing the verdict.
    const base = providerStatus(statuses, s, ["cod"]);
    return { ...base, detail: `${base.detail}${s.payCodNote}` };
  }, s);

  const courier = await probe(async () =>
    providerStatus(await getIntegrationStatus("courier", COURIER_PROVIDERS), s),
  s);

  const notifications = await probe(async () => {
    const sms = providerSummary(await getIntegrationStatus("sms", SMS_PROVIDERS));
    const email = providerSummary(await getIntegrationStatus("email", EMAIL_PROVIDERS));
    const anyConfigured = sms.configured.length + email.configured.length > 0;
    const fmt = (label: string, sum: typeof sms) =>
      interpolate(s.notifFmt, {
        label,
        configured: sum.configured.length > 0 ? sum.configured.join(", ") : s.stNone,
        enabled: sum.enabled.length > 0 ? sum.enabled.join(", ") : s.stNone,
      });
    // ADV-3: the email TRANSPORT verdict is stricter than a credential
    // row existing — it is exactly what src/email/config.ts resolves
    // at send time (provider + api_key + from_address). Booleans and a
    // machine reason only; no credential value is read onto this page.
    const transport = await getEmailTransportStatus();
    const transportText = transport.configured
      ? interpolate(s.transportReady, { provider: transport.provider })
      : interpolate(s.transportNotReady, { provider: transport.provider, reason: transport.reason ?? "unknown" });
    return {
      tone: anyConfigured ? "success" : "warning",
      label: anyConfigured ? s.stConfigured : s.stNotConfigured,
      detail: `${fmt("SMS", sms)}। ${fmt(s.idxEmailLabel, email)}। ${transportText}`,
    } satisfies CardStatus;
  }, s);

  const integrations = await probe(async () => {
    const storage = providerSummary(await getIntegrationStatus("storage", STORAGE_PROVIDERS));
    const redis = envPresent("REDIS_URL");
    const meili = envPresent("MEILISEARCH_HOST");
    const push =
      envPresent("WEB_PUSH_VAPID_PUBLIC_KEY") && envPresent("WEB_PUSH_VAPID_PRIVATE_KEY");
    const storageConfigured = storage.configured.length > 0;
    return {
      tone: storageConfigured ? "success" : "warning",
      label: storageConfigured ? s.stStorageConfigured : s.stStorageNotConfigured,
      detail: interpolate(s.storageDetail, {
        storage: storage.configured.length > 0 ? storage.configured.join(", ") : s.stNone,
        redis: redis ? s.stSet : s.stNotSet,
        meili: meili ? s.stSet : s.stNotSet,
        push: push ? s.stSet : s.stNotSet,
      }),
    } satisfies CardStatus;
  }, s);

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
        label: s.stNotConfigured,
        detail: s.trackingNoneDetail,
      } satisfies CardStatus;
    }
    return {
      tone: "success",
      label: s.stConfigured,
      detail: interpolate(s.trackingDetail, {
        ids: setIds.length > 0 ? setIds.join(", ") : s.stNone,
        token: capiToken ? s.tokenPresent : s.stNone,
      }),
    } satisfies CardStatus;
  }, s);

  // Accounting / VAT: the effective rate, parsed with the same rule
  // the order flow uses — blank/invalid means no VAT split is recorded.
  const accounting = await probe(async () => {
    const raw = await getSetting("accounting.vat_rate_bps");
    if (raw === null || raw.trim() === "") {
      return {
        tone: "neutral",
        label: s.vatOffLabel,
        detail: s.vatOffDetail,
      } satisfies CardStatus;
    }
    const bps = Number.parseInt(raw, 10);
    if (Number.isInteger(bps) && bps > 0 && bps <= 10000) {
      return {
        tone: "success",
        label: s.vatOnLabel,
        detail: interpolate(s.vatOnDetail, { pct: formatBpsAsPercent(bps), bps }),
      } satisfies CardStatus;
    }
    return {
      tone: "warning",
      label: s.vatInvalidLabel,
      detail: s.vatInvalidDetail,
    } satisfies CardStatus;
  }, s);

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
      label: activeRules > 0 ? interpolate(s.ordersActiveLabel, { count: activeRules }) : s.ordersNoneLabel,
      detail: interpolate(s.ordersDetail, {
        min: rules.minOrderPoisha > 0 ? s.stOn : s.stOff,
        adv: rules.advanceRequiredAbovePoisha > 0 ? s.stOn : s.stOff,
        districts: rules.codDisabledDistricts.length,
        categories: rules.codDisabledCategories.length,
        slots: slots.length,
      }),
    } satisfies CardStatus;
  }, s);

  // Checkout fields (doc 28): whether the merchant has saved a
  // custom field config in the Setting doc `checkout.fields`. No
  // saved doc = the built-in default form runs, which is a healthy
  // state, so it reads neutral rather than as a gap.
  const checkoutFields = await probe(async () => {
    const saved = await getSetting("checkout.fields");
    return saved
      ? {
          tone: "success",
          label: s.cfCustomLabel,
          detail: s.cfCustomDetail,
        } satisfies CardStatus
      : {
          tone: "neutral",
          label: s.cfDefaultLabel,
          detail: s.cfDefaultDetail,
        } satisfies CardStatus;
  }, s);

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
      label: s.ccLabel,
      detail: interpolate(s.ccDetail, { confirm: slaConfirm, rescue: slaRescue, start: startHour, end: endHour, retention }),
    } satisfies CardStatus;
  }, s);

  // Privacy & maintenance (ADV-29): the effective maintenance state
  // through the same reader the storefront gate resolves with.
  const privacy = await probe(async () => {
    const cfg = await getMaintenanceConfig();
    return cfg.enabled
      ? {
          tone: "warning",
          label: s.privOnLabel,
          detail: s.privOnDetail,
        } satisfies CardStatus
      : {
          tone: "success",
          label: s.privOffLabel,
          detail: s.privOffDetail,
        } satisfies CardStatus;
  }, s);

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
      interpolate(s.connFmt, { name: c.name, state: c.enabled ? s.stOn : s.stOff, ready: c.ready ? s.connPresent : s.stNone });
    return {
      tone: live.length > 0 ? "success" : "neutral",
      label: live.length > 0 ? interpolate(s.connLiveLabel, { names: live.join(", ") }) : s.connNoneLabel,
      detail: `${channels.map(fmt).join(" · ")}।`,
    } satisfies CardStatus;
  }, s);

  // Template designer (ADV-29): how many of the four override
  // documents (invoice + 3 email keys) actually carry merchant
  // copy — read through the same loaders the renderers resolve.
  const templates = await probe(async () => {
    const invoice = await loadInvoiceOverrides();
    let emailCount = 0;
    for (const key of OVERRIDABLE_EMAIL_KEYS) {
      if ((await loadEmailOverrides(key)) !== null) emailCount += 1;
    }
    const custom = (invoice !== null ? 1 : 0) + emailCount;
    return {
      tone: custom > 0 ? "success" : "neutral",
      label: custom > 0 ? interpolate(s.tplCustomLabel, { count: custom }) : s.tplDefaultLabel,
      detail: interpolate(s.tplDetail, {
        invoice: invoice !== null ? s.stCustom : s.stBuiltin,
        count: emailCount,
      }),
    } satisfies CardStatus;
  }, s);

  const cards: SettingsCardInfo[] = [
    {
      href: "/admin/settings/payments",
      icon: <Icon name="credit-card" size={22} />,
      title: s.cardPaymentsTitle,
      description: s.cardPaymentsDesc,
      status: payments,
    },
    {
      href: "/admin/settings/shipping",
      icon: <Icon name="truck" size={22} />,
      title: s.cardShippingTitle,
      description: s.cardShippingDesc,
      status: courier,
    },
    {
      href: "/admin/settings/notifications",
      icon: <Icon name="bell" size={22} />,
      title: s.cardNotificationsTitle,
      description: s.cardNotificationsDesc,
      status: notifications,
    },
    {
      href: "/admin/settings/integrations",
      icon: <Icon name="settings" size={22} />,
      title: s.cardIntegrationsTitle,
      description: s.cardIntegrationsDesc,
      status: integrations,
    },
    {
      href: "/admin/settings/connectors",
      icon: <Icon name="sparkles" size={22} />,
      title: s.cardConnectorsTitle,
      description: s.cardConnectorsDesc,
      status: connectors,
    },
    {
      href: "/admin/settings/tracking",
      icon: <Icon name="chart" size={22} />,
      title: s.cardTrackingTitle,
      description: s.cardTrackingDesc,
      status: tracking,
    },
    {
      href: "/admin/settings/accounting",
      icon: <Icon name="banknote" size={22} />,
      title: s.cardAccountingTitle,
      description: s.cardAccountingDesc,
      status: accounting,
    },
    {
      href: "/admin/settings/orders",
      icon: <Icon name="cart" size={22} />,
      title: s.cardOrdersTitle,
      description: s.cardOrdersDesc,
      status: orders,
    },
    {
      href: "/admin/settings/checkout-fields",
      icon: <Icon name="package" size={22} />,
      title: s.cardCheckoutTitle,
      description: s.cardCheckoutDesc,
      status: checkoutFields,
    },
    {
      href: "/admin/settings/call-center",
      icon: <Icon name="phone" size={22} />,
      title: s.cardCallCenterTitle,
      description: s.cardCallCenterDesc,
      status: callCenter,
    },
    {
      href: "/admin/settings/privacy",
      icon: <Icon name="shield" size={22} />,
      title: s.cardPrivacyTitle,
      description: s.cardPrivacyDesc,
      status: privacy,
    },
    {
      href: "/admin/settings/templates",
      icon: <Icon name="tag" size={22} />,
      title: s.cardTemplatesTitle,
      description: s.cardTemplatesDesc,
      status: templates,
    },
  ];

  return (
    <main>
      <PageHeader
        title={s.idxTitle}
        description={s.idxDesc}
        breadcrumb={s.idxBreadcrumb}
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={s.idxStatLang} value={storeLocale === "bn" ? s.idxStatLangBn : storeLocale} delta={s.idxStatLangDelta} icon={<span className="text-base font-bold">{reqLocale === "bn" ? "বাং" : "En"}</span>} />
        <StatCard label={s.idxStatCurrency} value={`${currency} (৳)`} delta={s.idxStatCurrencyDelta} icon={<Icon name="banknote" size={22} />} />
        <StatCard label={s.idxStatTz} value={timezone} delta={s.idxStatTzDelta} icon={<Icon name="clock" size={22} />} />
        <StatCard label={s.idxStatSubpages} value={String(cards.length)} delta={s.idxStatSubpagesDelta} icon={<Icon name="grid" size={22} />} />
      </div>

      <Card className="mb-6">
        <h2 className="mb-1 font-semibold">{s.idxSummaryTitle}</h2>
        <dl className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-text-muted">{s.idxStoreNameKey} — <code>general.store_name</code></dt>
            <dd className="font-semibold">{storeName.trim() !== "" ? storeName : s.idxStoreNameUnset}</dd>
          </div>
          <div>
            <dt className="text-text-muted">{s.idxDefaultLangKey} — <code>general.locale</code></dt>
            <dd className="font-semibold">{storeLocale === "bn" ? s.idxDefaultLangBn : storeLocale}</dd>
          </div>
          <div>
            <dt className="text-text-muted">{s.idxCurrencyKey} — <code>general.currency</code></dt>
            <dd className="font-semibold">{interpolate(s.idxCurrencyDetail, { currency })}</dd>
          </div>
          <div>
            <dt className="text-text-muted">{s.idxTzKey} — <code>general.timezone</code></dt>
            <dd className="font-semibold">{timezone}</dd>
          </div>
        </dl>
        <p className="mt-3 text-sm text-text-muted">
          {dbReady ? s.idxSummaryDbReady : s.idxSummaryDbDown}
          {s.idxSummarySecret}
        </p>
      </Card>

      <div className="mb-6">
        <StoreNameCard initial={storeName} dbReady={dbReady} />
      </div>

      <div className="mb-6">
        <DefaultLanguageCard initial={isLocale(storeLocale) ? storeLocale : "bn"} dbReady={dbReady} />
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
            <h3 className="mt-3 font-semibold">{card.title}</h3>
            <p className="mt-1 text-sm text-text-muted">{card.description}</p>
            <p className="mt-2 text-sm text-text-muted">{card.status.detail}</p>
            <a href={card.href} className="mt-3 inline-block text-sm font-medium text-brand-700">
              {s.idxOpen}
            </a>
          </Card>
        ))}
      </div>

      <p className="mt-6 text-sm text-text-muted">
        {s.idxFooterA}<code>enabled</code>{s.idxFooterB}
      </p>
    </main>
  );
}
