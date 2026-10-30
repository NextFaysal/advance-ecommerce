"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { useLocale } from "@/i18n/LocaleProvider";

interface WhatsAppTemplate {
  id: string;
  title: string;
  category: "abandoned" | "confirm" | "advance" | "address";
  template: string;
}

const TEMPLATES: WhatsAppTemplate[] = [
  {
    id: "tpl_cart",
    title: "কার্ট রিকভারি (Abandoned Cart)",
    category: "abandoned",
    template: `আসসালামু আলাইকুম {customerName}! 😊
আমাদের ওয়েবসাইট থেকে আপনি {productName} অর্ডার করার চেষ্টা করছিলেন। কোনো সমস্যার কারণে কি অর্ডার সম্পন্ন হতে বাধা পেয়েছে?

অর্ডারটি কনফার্ম করতে অথবা বিশেষ ছাড়ে নিতে আমাদের এই লিংকে ক্লিক করুন:
👉 {checkoutUrl}

যেকোনো তথ্যের জন্য সরাসরি এখানে রিপ্লাই দিতে পারেন। ধন্যবাদ! - {storeName}`,
  },
  {
    id: "tpl_confirm",
    title: "অর্ডার কনফার্মেশন (Order Confirmation)",
    category: "confirm",
    template: `আসসালামু আলাইকুম {customerName}!
আপনার অর্ডার #{orderNumber} টি সফলভাবে গ্রহণ করা হয়েছে। 

📦 পণ্যের নাম: {productName}
💵 মোট বিল (ক্যাশ অন ডেলিভারি): ৳{amount}
🚚 ডেলিভারি ঠিকানা: {address}

পার্সেলটি আজই কুরিয়ারে বুকিং দেওয়া হবে। ইনশাআল্লাহ ২-৩ দিনের মধ্যে ডেলিভারি পাবেন। ধন্যবাদ! - {storeName}`,
  },
  {
    id: "tpl_advance",
    title: "অগ্রিম ডেলিভারি চার্জ রিকোয়েস্ট (Advance Delivery Fee)",
    category: "advance",
    template: `আসসালামু আলাইকুম {customerName},
আপনার অর্ডার #{orderNumber} টি রেডি আছে। ঢাকার বাইরে পার্সেল কনফার্ম করার জন্য কুরিয়ার ডেলিভারি চার্জ ৳{advanceAmount} অগ্রিম প্রদান করতে হবে। (বাকি ৳{remainingAmount} পণ্য হাতে পেয়ে পরিশোধ করবেন)।

বিকাশ বা নগদে সরাসরি পে করতে নিচের লিংকে ক্লিক করুন:
👉 {paymentLink}

পেমেন্ট করার পর ট্রানজেকশন আইডি বা স্ক্রিনশট এখানে পাঠালে পার্সেল সাথে সাথে পাঠিয়ে দেওয়া হবে। ধন্যবাদ! - {storeName}`,
  },
  {
    id: "tpl_address",
    title: "ঠিকানা যাচাই (Address Incomplete)",
    category: "address",
    template: `আসসালামু আলাইকুম {customerName},
আপনার অর্ডারের ঠিকানায় জেলা বা উপজেলার নাম স্পষ্ট নয়। কুরিয়ার ম্যান যেন সঠিক সময়ে আপনার বাসায় পৌঁছাতে পারে, সেজন্য আপনার বিস্তারিত ঠিকানা (বাসা/রোড নম্বর, উপজেলা, জেলা) লিখে রিপ্লাই দিন। ধন্যবাদ! - {storeName}`,
  },
];

export function WhatsAppRecoveryPanel() {
  const { locale } = useLocale();
  const [selectedTpl, setSelectedTpl] = useState<WhatsAppTemplate>(TEMPLATES[0]);
  const [phone, setPhone] = useState("01712345678");
  const [customerName, setCustomerName] = useState("রাকিবুল হাসান");
  const [productName, setProductName] = useState("প্রিমিয়াম সুতি পাঞ্জাবি");
  const [orderNumber, setOrderNumber] = useState("ORD-9842");
  const [amount, setAmount] = useState("1,850");
  const [advanceAmount, setAdvanceAmount] = useState("120");
  const [remainingAmount, setRemainingAmount] = useState("1,730");
  const [address, setAddress] = useState("মিরপুর ১০, ঢাকা");
  const [storeName, setStoreName] = useState("Advance E-Commerce");
  const [checkoutUrl, setCheckoutUrl] = useState("https://mystore.com/checkout?cart=99");
  const [paymentLink, setPaymentLink] = useState("https://mystore.com/pay/bkash9842");
  const [customText, setCustomText] = useState(TEMPLATES[0].template);

  const cleanPhone = phone.replace(/[^0-9]/g, "");
  const formattedPhone = cleanPhone.startsWith("88")
    ? cleanPhone
    : cleanPhone.startsWith("01")
    ? `88${cleanPhone}`
    : cleanPhone;

  const renderedMessage = customText
    .replace(/{customerName}/g, customerName)
    .replace(/{productName}/g, productName)
    .replace(/{orderNumber}/g, orderNumber)
    .replace(/{amount}/g, amount)
    .replace(/{advanceAmount}/g, advanceAmount)
    .replace(/{remainingAmount}/g, remainingAmount)
    .replace(/{address}/g, address)
    .replace(/{storeName}/g, storeName)
    .replace(/{checkoutUrl}/g, checkoutUrl)
    .replace(/{paymentLink}/g, paymentLink);

  const whatsappUrl = `https://wa.me/${formattedPhone}?text=${encodeURIComponent(renderedMessage)}`;

  const handleSelectTemplate = (tpl: WhatsAppTemplate) => {
    setSelectedTpl(tpl);
    setCustomText(tpl.template);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-base font-semibold text-text-main">
          {locale === "bn" ? "হোয়াটসঅ্যাপ ১-ক্লিক অর্ডার ও কার্ট রিকভারি" : "WhatsApp 1-Click Order & Cart Recovery"}
        </h2>
        <p className="mt-0.5 text-xs text-text-muted">
          {locale === "bn"
            ? "কাস্টমারকে কল দেওয়ার ঝামেলা ছাড়াই ১ ক্লিকে হোয়াটসঅ্যাপে প্রাক-লিখিত প্রফেশনাল মেসেজ পাঠিয়ে অর্ডার কনফার্ম বা কার্ট রিকভার করুন"
            : "Direct WhatsApp click-to-chat links with pre-filled Bangla templates to recover abandoned carts and confirm orders"}
        </p>
      </div>

      {/* Template Selectors */}
      <div className="flex flex-wrap gap-2">
        {TEMPLATES.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => handleSelectTemplate(t)}
            className={`rounded-xl border px-3 py-1.5 text-xs font-medium transition ${
              selectedTpl.id === t.id
                ? "border-emerald-500 bg-emerald-50 text-emerald-800 shadow-sm"
                : "border-border bg-card text-text-main hover:bg-surface-2"
            }`}
          >
            {t.title}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Editor Form */}
        <Card className="p-5 space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-text-muted">কাস্টমারের ফোন নম্বর *</label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="017XXXXXXXX"
                className="h-9 w-full rounded-lg border border-border bg-card px-2.5 text-xs font-mono outline-none focus:border-brand-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-muted">কাস্টমারের নাম</label>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-card px-2.5 text-xs outline-none focus:border-brand-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-xs">
            <div>
              <label className="mb-1 block text-text-muted">প্রোডাক্টের নাম</label>
              <input
                type="text"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
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
              <label className="mb-1 block text-text-muted">মোট বিল (৳)</label>
              <input
                type="text"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="h-8 w-full rounded-lg border border-border bg-card px-2 text-xs"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-text-muted">মেসেজ টেমপ্লেট</label>
            <textarea
              rows={6}
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
              className="w-full rounded-[10px] border border-border bg-card p-3 text-xs leading-relaxed outline-none focus:border-brand-500"
            />
          </div>
        </Card>

        {/* WhatsApp Preview & Direct Send */}
        <Card className="p-5 bg-surface-2 flex flex-col justify-between border-emerald-200">
          <div>
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
                <h3 className="text-sm font-semibold text-text-main">হোয়াটসঅ্যাপ চ্যাট প্রিভিউ</h3>
              </div>
              <Badge tone="success">Direct wa.me Link</Badge>
            </div>

            {/* Chat bubble simulation */}
            <div className="my-4 rounded-2xl bg-emerald-50/70 border border-emerald-200 p-4 shadow-sm text-xs leading-relaxed text-emerald-950 whitespace-pre-wrap select-all">
              {renderedMessage}
            </div>
          </div>

          <div className="space-y-3 pt-4 border-t border-border">
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noreferrer"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-emerald-700 shadow-md"
            >
              <Icon name="phone" size={16} />
              {locale === "bn" ? "হোয়াটসঅ্যাপে চ্যাট খুলুন (Open WhatsApp)" : "Open in WhatsApp"}
            </a>
            <p className="text-center text-[11px] text-text-muted">
              {locale === "bn"
                ? `নম্বর: +${formattedPhone} — কোনো নাম্বার সেভ না করেই সরাসরি ব্রাউজার বা অ্যাপে চ্যাট ওপেন হবে`
                : `Target: +${formattedPhone}`}
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
