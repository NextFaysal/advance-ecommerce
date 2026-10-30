"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { useLocale } from "@/i18n/LocaleProvider";

interface SmsTemplate {
  id: string;
  name: string;
  category: "confirm" | "shipped" | "advance" | "delivery";
  text: string;
}

const TEMPLATES: SmsTemplate[] = [
  {
    id: "tpl_1",
    name: "অর্ডার নিশ্চিতকরণ (Order Confirmed)",
    category: "confirm",
    text: "প্রিয় {customerName}, আপনার অর্ডার #{orderNumber} নিশ্চিত করা হয়েছে। মোট মূল্য: ৳{amount} (COD)। আমাদের সাথে থাকার জন্য ধন্যবাদ! - {storeName}",
  },
  {
    id: "tpl_2",
    name: "কুরিয়ার ট্র্যাকিং কোডসহ পার্সেল বুকিং (Courier Shipped)",
    category: "shipped",
    text: "প্রিয় {customerName}, আপনার পার্সেলটি {courier}-এ পাঠানো হয়েছে। ট্র্যাকিং কোড: {trackingId}। ৩ দিনের মধ্যে ডেলিভারি পাবেন। - {storeName}",
  },
  {
    id: "tpl_3",
    name: "অগ্রিম ডেলিভারি চার্জ চাওয়ার রিকোয়েস্ট (Advance Delivery Fee)",
    category: "advance",
    text: "প্রিয় {customerName}, অর্ডার #{orderNumber} কনফার্ম করতে ডেলিভারি চার্জ ৳{advanceAmount} এই লিংকে পরিশোধ করুন: {paymentLink}। - {storeName}",
  },
  {
    id: "tpl_4",
    name: "আজই পার্সেল ডেলিভারি রিমাইন্ডার (Out for Delivery)",
    category: "delivery",
    text: "প্রিয় {customerName}, আপনার পার্সেলটি আজ ডেলিভারি হবে। অনুগ্রহ করে কুরিয়ার রাইডারের জন্য নগদ ৳{amount} প্রস্তুত রাখুন। - {storeName}",
  },
];

export function OrderSmsPanel() {
  const { locale } = useLocale();
  const [selectedTemplate, setSelectedTemplate] = useState<SmsTemplate>(TEMPLATES[0]);
  const [smsText, setSmsText] = useState(TEMPLATES[0].text);
  const [recipientPhone, setRecipientPhone] = useState("01712345678");
  const [provider, setProvider] = useState("Greenweb BD");
  const [sending, setSending] = useState(false);
  const [sendSuccess, setSendSuccess] = useState<string | null>(null);

  // Variables for preview replacement
  const [customerName, setCustomerName] = useState("সাকিব আল হাসান");
  const [orderNumber, setOrderNumber] = useState("ORD-9840");
  const [amount, setAmount] = useState("1450");
  const [courier, setCourier] = useState("Steadfast Courier");
  const [trackingId, setTrackingId] = useState("STD98402211");
  const [storeName, setStoreName] = useState("My Store");
  const [advanceAmount, setAdvanceAmount] = useState("120");
  const [paymentLink, setPaymentLink] = useState("https://mystore.com/pay/bkash99");

  const renderedPreview = smsText
    .replace(/{customerName}/g, customerName)
    .replace(/{orderNumber}/g, orderNumber)
    .replace(/{amount}/g, amount)
    .replace(/{courier}/g, courier)
    .replace(/{trackingId}/g, trackingId)
    .replace(/{storeName}/g, storeName)
    .replace(/{advanceAmount}/g, advanceAmount)
    .replace(/{paymentLink}/g, paymentLink);

  const isUnicode = /[^\u0000-\u007f]/.test(renderedPreview);
  const charLimit = isUnicode ? 70 : 160;
  const charCount = renderedPreview.length;
  const smsCount = Math.ceil(charCount / charLimit) || 1;

  const handleSelectTemplate = (tpl: SmsTemplate) => {
    setSelectedTemplate(tpl);
    setSmsText(tpl.text);
    setSendSuccess(null);
  };

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setSendSuccess(null);

    setTimeout(() => {
      setSending(false);
      setSendSuccess(
        locale === "bn"
          ? `${recipientPhone} নম্বরে সফলভাবে এসএমএস পাঠানো হয়েছে (${provider})!`
          : `SMS sent successfully to ${recipientPhone} via ${provider}!`
      );
    }, 600);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-base font-semibold text-text-main">
          {locale === "bn" ? "অর্ডার এসএমএস ও বাংলা নোটিফিকেশন টেমপ্লেট" : "Bangla Order SMS & Notification Templates"}
        </h2>
        <p className="mt-0.5 text-xs text-text-muted">
          {locale === "bn"
            ? "অর্ডার কনফার্ম, কুরিয়ার ট্র্যাকিং ও অগ্রিম পেমেন্টের জন্য প্রি-বিল্ট এসএমএস টেমপ্লেট ও সরাসরি পাঠানোর টুল"
            : "Pre-configured Bangla order SMS templates with dynamic tags and BD gateway integration"}
        </p>
      </div>

      {/* Template Selection Tabs */}
      <div className="flex flex-wrap gap-2">
        {TEMPLATES.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => handleSelectTemplate(t)}
            className={`rounded-xl border px-3.5 py-2 text-xs font-medium transition ${
              selectedTemplate.id === t.id
                ? "border-brand-500 bg-brand-50 text-brand-700 shadow-sm"
                : "border-border bg-card text-text-main hover:bg-surface-2"
            }`}
          >
            {t.name}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Editor Form */}
        <Card className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text-main">
              {locale === "bn" ? "টেমপ্লেট এডিটর" : "Template Editor"}
            </h3>
            <span className="text-[11px] text-text-muted">ট্যাগ: {"{customerName}, {orderNumber}, {amount}, {trackingId}, {paymentLink}"}</span>
          </div>

          <textarea
            value={smsText}
            onChange={(e) => setSmsText(e.target.value)}
            rows={5}
            className="w-full rounded-[10px] border border-border bg-card p-3 text-sm outline-none focus:border-brand-500 focus:ring-[3px] focus:ring-brand-100"
          />

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 text-xs">
            <div>
              <label className="mb-1 block text-text-muted">কাস্টমার নাম</label>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="h-8 w-full rounded-lg border border-border bg-card px-2 text-xs"
              />
            </div>
            <div>
              <label className="mb-1 block text-text-muted">অর্ডার নম্বর</label>
              <input
                type="text"
                value={orderNumber}
                onChange={(e) => setOrderNumber(e.target.value)}
                className="h-8 w-full rounded-lg border border-border bg-card px-2 text-xs"
              />
            </div>
            <div>
              <label className="mb-1 block text-text-muted">টাকার পরিমাণ (৳)</label>
              <input
                type="text"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="h-8 w-full rounded-lg border border-border bg-card px-2 text-xs"
              />
            </div>
            <div>
              <label className="mb-1 block text-text-muted">কুরিয়ার</label>
              <input
                type="text"
                value={courier}
                onChange={(e) => setCourier(e.target.value)}
                className="h-8 w-full rounded-lg border border-border bg-card px-2 text-xs"
              />
            </div>
            <div>
              <label className="mb-1 block text-text-muted">ট্র্যাকিং কোড</label>
              <input
                type="text"
                value={trackingId}
                onChange={(e) => setTrackingId(e.target.value)}
                className="h-8 w-full rounded-lg border border-border bg-card px-2 text-xs"
              />
            </div>
            <div>
              <label className="mb-1 block text-text-muted">দোকানের নাম</label>
              <input
                type="text"
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
                className="h-8 w-full rounded-lg border border-border bg-card px-2 text-xs"
              />
            </div>
          </div>
        </Card>

        {/* Live Mobile Screen Preview & Test Send */}
        <Card className="p-5 space-y-4 bg-surface-2 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <h3 className="text-sm font-semibold text-text-main">
                {locale === "bn" ? "এসএমএস প্রিভিউ ও মিটার" : "SMS Preview & Meter"}
              </h3>
              <Badge tone={isUnicode ? "info" : "neutral"}>
                {isUnicode ? "বাংলা ইউনিকোড (৭০ অক্ষর/SMS)" : "ইংরেজি ASCII (১৬০ অক্ষর/SMS)"}
              </Badge>
            </div>

            {/* Simulated Phone Message Bubble */}
            <div className="my-4 rounded-2xl border border-brand-200 bg-card p-4 shadow-sm">
              <p className="text-xs text-brand-600 font-semibold mb-1">
                {storeName} (SMS Preview):
              </p>
              <p className="text-sm text-text-main leading-relaxed select-all">
                {renderedPreview}
              </p>
            </div>

            {/* Character & Count Meter */}
            <div className="flex items-center justify-between rounded-xl bg-card p-3 border border-border text-xs">
              <div>
                <span className="text-text-muted">অক্ষর সংখ্যা: </span>
                <span className="font-bold text-text-main">{charCount}</span>
                <span className="text-text-muted"> / {charLimit * smsCount}</span>
              </div>
              <div>
                <span className="text-text-muted">কাউন্ট: </span>
                <span className="font-bold text-brand-600">{smsCount} SMS</span>
              </div>
            </div>
          </div>

          {/* Test Sender Form */}
          <form onSubmit={handleSend} className="space-y-3 pt-3 border-t border-border">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-text-muted">গেটওয়ে প্রোভাইডার</label>
                <select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  className="h-9 w-full rounded-lg border border-border bg-card px-2.5 text-xs outline-none"
                >
                  <option value="Greenweb BD">Greenweb BD</option>
                  <option value="BulkSMSBD">BulkSMSBD</option>
                  <option value="Onnorokom SMS">Onnorokom SMS</option>
                  <option value="Banglalink/GP Direct">GP / Banglalink Direct</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-text-muted">টেস্ট মোবাইল নম্বর</label>
                <input
                  type="text"
                  value={recipientPhone}
                  onChange={(e) => setRecipientPhone(e.target.value)}
                  className="h-9 w-full rounded-lg border border-border bg-card px-2.5 text-xs font-mono outline-none"
                />
              </div>
            </div>

            <Button type="submit" disabled={sending} className="w-full">
              {sending ? (
                locale === "bn" ? "পাঠানো হচ্ছে..." : "Sending..."
              ) : (
                <>
                  <Icon name="phone" size={15} className="mr-1.5 inline" />
                  {locale === "bn" ? "এসএমএস পাঠান (Test Send)" : "Send SMS"}
                </>
              )}
            </Button>

            {sendSuccess && (
              <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-2.5 text-xs text-emerald-800">
                ✓ {sendSuccess}
              </div>
            )}
          </form>
        </Card>
      </div>
    </div>
  );
}
