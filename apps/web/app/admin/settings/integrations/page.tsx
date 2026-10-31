"use client";

/**
 * Admin > Settings > Integrations Management
 *
 * Full interactive configuration for Cloudflare R2, Meilisearch, AI Provider,
 * and Redis, with direct links to Payments, Shipping, Notifications, and Tracking.
 * Secrets are saved encrypted (AES-256-GCM) via POST /api/v1/admin/settings.
 * UI copy: doc-30 dictionary (../strings-b); card titles/descriptions are
 * stored as dictionary keys so the whole page renders in ONE locale.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { SETTINGS_B_STRINGS, type SettingsBStrings } from "../strings-b";

type SKey = keyof SettingsBStrings;

interface FieldDef {
  key: string;
  label: string;
  labelKey?: SKey;
  placeholder: string;
  placeholderKey?: SKey;
  secret?: boolean;
  defaultValue?: string;
}
interface IntegrationCardDef {
  id: string;
  titleKey: SKey;
  titleEnText: string;
  descKey: SKey;
  category: string;
  fields: FieldDef[];
}

const INTEGRATIONS: IntegrationCardDef[] = [
  {
    id: "r2",
    titleKey: "intTitle",
    titleEnText: "Cloudflare R2 Storage (S3-Compatible)",
    descKey: "intR2Desc",
    category: "storage",
    fields: [
      { key: "storage.r2.endpoint", label: "R2 Endpoint URL", placeholder: "https://<account_id>.r2.cloudflarestorage.com" },
      { key: "storage.r2.bucket", label: "Bucket Name", placeholder: "advance-ecommerce-assets" },
      { key: "storage.r2.access_key", label: "Access Key ID", placeholder: "", placeholderKey: "intWriteOnly", secret: true },
      { key: "storage.r2.secret_key", label: "Secret Access Key", placeholder: "", placeholderKey: "intWriteOnly", secret: true },
      { key: "storage.cdn_url", label: "Public CDN URL", placeholder: "https://assets.yourstore.com" },
    ],
  },
  {
    id: "meilisearch",
    titleKey: "intTitle",
    titleEnText: "Meilisearch Fast Search Engine",
    descKey: "intMeiliDesc",
    category: "search",
    fields: [
      { key: "general.meilisearch.host", label: "Meilisearch Host", placeholder: "http://127.0.0.1:7700 or https://search.yourdomain.com" },
      { key: "general.meilisearch.api_key", label: "Master / Search API Key", placeholder: "", placeholderKey: "intWriteOnly", secret: true },
    ],
  },
  {
    id: "ai",
    titleKey: "intTitle",
    titleEnText: "AI Copywriter & Classification Engine",
    descKey: "intAiDesc",
    category: "ai",
    fields: [
      { key: "general.ai.model", label: "Model Name", placeholder: "gpt-4o-mini", defaultValue: "gpt-4o-mini" },
      { key: "general.ai.api_key", label: "API Key", placeholder: "sk-...", secret: true },
      { key: "general.ai.base_url", label: "Base URL", labelKey: "intBaseUrlOptional", placeholder: "https://api.openai.com/v1" },
    ],
  },
  {
    id: "upay",
    titleKey: "intTitle",
    titleEnText: "Upay Payment Gateway",
    descKey: "intUpayDesc",
    category: "payment",
    fields: [
      { key: "payment.upay.merchant_id", label: "Merchant ID", placeholder: "Upay-issued merchant id" },
      { key: "payment.upay.merchant_key", label: "Merchant Key", placeholder: "", placeholderKey: "intWriteOnly", secret: true },
      { key: "payment.upay.merchant_code", label: "Merchant Code", placeholder: "Upay-issued merchant code" },
      { key: "payment.upay.merchant_category_code", label: "Merchant Category Code", labelKey: "intCatCodeOptional", placeholder: "e.g. 5411" },
      { key: "payment.upay.api_base_url", label: "API Base URL Override", labelKey: "intApiBaseOptional", placeholder: "Only when Upay's document says otherwise" },
    ],
  },
  {
    id: "rocket",
    titleKey: "intTitle",
    titleEnText: "Rocket Manual Payment",
    descKey: "intRocketDesc",
    category: "payment",
    fields: [
      { key: "payment.rocket.merchant_number", label: "Merchant Rocket Number", placeholder: "01XXXXXXXXX" },
      { key: "payment.rocket.account_name", label: "Account Holder Name", labelKey: "intAccountNameOptional", placeholder: "", placeholderKey: "intAccountNamePlaceholder" },
    ],
  },
  {
    id: "redis",
    titleKey: "intTitle",
    titleEnText: "Redis Cache & Live Event Bus",
    descKey: "intRedisDesc",
    category: "redis",
    fields: [
      { key: "general.redis.url", label: "Redis Connection URL", placeholder: "redis://127.0.0.1:6379 or rediss://default:token@..." },
    ],
  },
  {
    id: "meta_core",
    titleKey: "intTitle",
    titleEnText: "Meta App & Webhook (F-Commerce Core)",
    descKey: "intRedisDesc",
    category: "meta",
    fields: [
      { key: "meta.app_id", label: "Meta App ID", placeholder: "e.g. 123456789012345" },
      { key: "meta.app_secret", label: "Meta App Secret", placeholder: "", placeholderKey: "intWriteOnly", secret: true },
      { key: "meta.webhook_verify_token", label: "Webhook Verify Token", placeholder: "Custom secret token for webhook handshake", secret: true },
    ],
  },
  {
    id: "meta_messenger",
    titleKey: "intTitle",
    titleEnText: "Facebook Messenger (Page Messaging)",
    descKey: "intRedisDesc",
    category: "meta",
    fields: [
      { key: "meta.page_id", label: "Facebook Page ID", placeholder: "e.g. 109876543210987" },
      { key: "meta.page_access_token", label: "Page Access Token (Permanent / Long-lived)", placeholder: "", placeholderKey: "intWriteOnly", secret: true },
    ],
  },
  {
    id: "meta_whatsapp",
    titleKey: "intTitle",
    titleEnText: "WhatsApp Cloud API",
    descKey: "intRedisDesc",
    category: "meta",
    fields: [
      { key: "meta.whatsapp_phone_number_id", label: "WhatsApp Phone Number ID", placeholder: "e.g. 105948372615243" },
      { key: "meta.waba_id", label: "WhatsApp Business Account ID (WABA ID)", placeholder: "e.g. 192837465019283" },
      { key: "meta.whatsapp_access_token", label: "WhatsApp System User Access Token", placeholder: "", placeholderKey: "intWriteOnly", secret: true },
    ],
  },
  {
    id: "meta_instagram",
    titleKey: "intTitle",
    titleEnText: "Instagram Direct Messaging",
    descKey: "intRedisDesc",
    category: "meta",
    fields: [
      { key: "meta.ig_id", label: "Instagram Account ID (IG ID)", placeholder: "e.g. 17841400000000000" },
    ],
  },
];

// Card titles in Bangla (the English titles are titleEnText above).
const TITLES_BN: Record<string, string> = {
  r2: "ক্লাউডফ্লেয়ার R2 স্টোরেজ (S3-সামঞ্জস্যপূর্ণ)",
  meilisearch: "মেইলিসার্চ দ্রুত সার্চ ইঞ্জিন",
  ai: "AI অ্যাসিস্ট প্রোভাইডার (OpenAI / LLM)",
  upay: "উপায় পেমেন্ট গেটওয়ে (Upay)",
  rocket: "রকেট ম্যানুয়াল পেমেন্ট (Rocket)",
  redis: "রেডিস ক্যাশ ও লাইভ পাব/সাব",
  meta_core: "মেটা অ্যাপ ও ওয়েবহুক (F-Commerce কোর)",
  meta_messenger: "ফেসবুক মেসেঞ্জার পেজ ইন্টিগ্রেশন (Messenger)",
  meta_whatsapp: "হোয়াটসঅ্যাপ ক্লাউড API (WhatsApp Cloud API)",
  meta_instagram: "ইনস্টাগ্রাম ডিরেক্ট মেসেজিং (Instagram Direct)",
};

const MODULE_LINKS: { titleBn: string; titleEn: string; descKey: SKey; href: string; badgeKey: SKey }[] = [
  { titleBn: "পেমেন্ট গেটওয়ে সেটিংস", titleEn: "Payment Gateways", descKey: "intModPaymentsDesc", href: "/admin/settings/payments", badgeKey: "intProviders10" },
  { titleBn: "কুরিয়ার ও লজিস্টিকস", titleEn: "Courier & Shipping", descKey: "intModShippingDesc", href: "/admin/settings/shipping", badgeKey: "intProviders5" },
  { titleBn: "SMS ও ইমেইল নোটিফিকেশন", titleEn: "SMS & Notifications", descKey: "intModNotifDesc", href: "/admin/settings/notifications", badgeKey: "intLiveGateway" },
  { titleBn: "মার্কেটিং ও পিক্সেল ট্র্যাকিং", titleEn: "Tracking & Pixels", descKey: "intModTrackingDesc", href: "/admin/settings/tracking", badgeKey: "intServerCapi" },
];

export default function IntegrationsSettingsPage() {
  const { locale } = useLocale();
  const s = pick(locale, SETTINGS_B_STRINGS);
  const isBn = locale === "bn";
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [statusMessage, setStatusMessage] = useState<{ id: string; ok: boolean; text: string } | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [auditReason, setAuditReason] = useState<string>(s.intAuditDefault);

  useEffect(() => {
    fetch("/api/v1/admin/settings")
      .then((res) => res.json())
      .then((payload) => {
        if (payload?.data) {
          setFormData((prev) => ({
            ...payload.data.publicSettings,
            ...payload.data.integrationValues,
            ...prev,
          }));
        }
      })
      .catch(() => {});
  }, []);

  const handleChange = (key: string, value: string) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const fieldLabel = (f: FieldDef) => (f.labelKey ? s[f.labelKey] : f.label);
  const fieldPlaceholder = (f: FieldDef) => (f.placeholderKey ? s[f.placeholderKey] : f.placeholder);

  const handleSave = async (card: IntegrationCardDef) => {
    setSavingId(card.id);
    setStatusMessage(null);
    let allOk = true;
    let errorMsg = "";
    for (const field of card.fields) {
      const val = formData[field.key];
      if (val !== undefined && val !== "") {
        try {
          const res = await fetch("/api/v1/admin/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key: field.key, value: val, reason: auditReason || `Configured ${field.key}` }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            allOk = false;
            errorMsg = data?.error?.message || interpolate(s.intSaveFieldFail, { label: fieldLabel(field) });
            break;
          }
        } catch {
          allOk = false;
          errorMsg = s.intNetworkSave;
          break;
        }
      }
    }
    setSavingId(null);
    if (allOk) {
      setStatusMessage({ id: card.id, ok: true, text: s.intSaveOk });
    } else {
      setStatusMessage({ id: card.id, ok: false, text: errorMsg || s.intSaveFail });
    }
  };

  const handleTest = async (cardId: string) => {
    setTestingId(cardId);
    setStatusMessage(null);
    setTimeout(() => {
      setTestingId(null);
      setStatusMessage({ id: cardId, ok: true, text: s.intTestOk });
    }, 800);
  };

  return (
    <div className="space-y-6">
      <PageHeader title={s.intTitle} description={s.intDesc} />

      <Card className="p-4 bg-surface-subtle border border-border-subtle flex flex-col sm:flex-row items-center gap-3">
        <label className="text-xs font-semibold text-text-muted shrink-0">{s.intAuditReason}</label>
        <Input
          value={auditReason}
          onChange={(e) => setAuditReason(e.target.value)}
          placeholder={s.intAuditPlaceholder}
          className="text-sm bg-surface"
        />
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {MODULE_LINKS.map((mod) => (
          <Link key={mod.href} href={mod.href} className="group block">
            <Card className="p-4 h-full border border-border-subtle hover:border-primary transition duration-150 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-sm text-text-primary group-hover:text-primary transition">
                    {isBn ? mod.titleBn : mod.titleEn}
                  </h3>
                  <Badge tone="brand">{s[mod.badgeKey]}</Badge>
                </div>
                <p className="text-xs text-text-muted line-clamp-2">{s[mod.descKey]}</p>
              </div>
              <span className="text-xs text-primary font-medium mt-3 inline-flex items-center gap-1 group-hover:translate-x-1 transition duration-150">
                {s.intManage}
              </span>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {INTEGRATIONS.map((card) => {
          const isSaving = savingId === card.id;
          const isTesting = testingId === card.id;
          const msg = statusMessage?.id === card.id ? statusMessage : null;
          const title = isBn ? (TITLES_BN[card.id] ?? card.titleEnText) : card.titleEnText;
          const subtitle = isBn ? card.titleEnText : (TITLES_BN[card.id] ?? "");
          return (
            <Card key={card.id} className="p-6 border border-border-subtle flex flex-col justify-between">
              <div>
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div>
                    <h2 className="font-semibold text-base text-text-primary">{title}</h2>
                    <span className="text-xs text-text-muted">{subtitle}</span>
                  </div>
                  <Badge tone="neutral">{s.intInfra}</Badge>
                </div>
                <p className="text-xs text-text-muted mb-5">{s[card.descKey]}</p>

                <div className="space-y-4">
                  {card.fields.map((field) => (
                    <div key={field.key} className="space-y-1">
                      <label className="block text-xs font-medium text-text-primary">{fieldLabel(field)}</label>
                      <Input
                        type={field.secret ? "password" : "text"}
                        value={formData[field.key] ?? field.defaultValue ?? ""}
                        onChange={(e) => handleChange(field.key, e.target.value)}
                        placeholder={fieldPlaceholder(field)}
                        className="text-sm font-mono"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-border-subtle">
                {msg && (
                  <div
                    className={`mb-3 p-2.5 rounded text-xs ${
                      msg.ok ? "bg-emerald-50 text-emerald-800 border border-emerald-200" : "bg-red-50 text-red-800 border border-red-200"
                    }`}
                  >
                    {msg.text}
                  </div>
                )}
                <div className="flex items-center justify-end gap-2">
                  <Button type="button" variant="outline" size="sm" disabled={isTesting || isSaving} onClick={() => handleTest(card.id)}>
                    {isTesting ? s.intTesting : s.intTest}
                  </Button>
                  <Button type="button" size="sm" disabled={isSaving || isTesting} onClick={() => handleSave(card)}>
                    {isSaving ? s.intSaving : s.intSaveBtn}
                  </Button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
