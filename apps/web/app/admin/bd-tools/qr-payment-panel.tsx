"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { useLocale } from "@/i18n/LocaleProvider";

export function QrPaymentPanel() {
  const { locale } = useLocale();
  const [provider, setProvider] = useState<"bkash" | "nagad">("bkash");
  const [accountType, setAccountType] = useState<"personal" | "merchant">("merchant");
  const [phone, setPhone] = useState("01712345678");
  const [amount, setAmount] = useState("1450");
  const [orderId, setOrderId] = useState("ORD-9842");

  const isBkash = provider === "bkash";
  const brandColor = isBkash ? "bg-[#E2136E]" : "bg-[#F7941D]";
  const brandBorder = isBkash ? "border-[#E2136E]" : "border-[#F7941D]";
  const brandText = isBkash ? "text-[#E2136E]" : "text-[#F7941D]";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-base font-semibold text-text-main">
          {locale === "bn" ? "বিকাশ ও নগদ ডায়নামিক QR কোড জেনারেটর" : "bKash & Nagad Dynamic QR Payment Generator"}
        </h2>
        <p className="mt-0.5 text-xs text-text-muted">
          {locale === "bn"
            ? "অর্ডারের সঠিক টাকার অঙ্ক ও রেফারেন্স দিয়ে ইনস্ট্যান্ট কিউআর কোড কার্ড তৈরি করে কাস্টমারকে ইনবক্সে পাঠান"
            : "Generate branded scan-to-pay QR cards for bKash and Nagad with order amount and reference"}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Input Parameters */}
        <Card className="p-5 space-y-4">
          <h3 className="text-sm font-semibold text-text-main pb-2 border-b border-border">
            {locale === "bn" ? "পেমেন্ট তথ্য দিন" : "Payment Details"}
          </h3>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-text-muted">পেমেন্ট মেথড</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setProvider("bkash")}
                  className={`flex-1 rounded-lg border py-2 text-xs font-bold transition ${
                    isBkash
                      ? "border-[#E2136E] bg-[#E2136E]/10 text-[#E2136E]"
                      : "border-border bg-card text-text-muted"
                  }`}
                >
                  bKash (বিকাশ)
                </button>
                <button
                  type="button"
                  onClick={() => setProvider("nagad")}
                  className={`flex-1 rounded-lg border py-2 text-xs font-bold transition ${
                    !isBkash
                      ? "border-[#F7941D] bg-[#F7941D]/10 text-[#F7941D]"
                      : "border-border bg-card text-text-muted"
                  }`}
                >
                  Nagad (নগদ)
                </button>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-text-muted">হিসাবের ধরন</label>
              <select
                value={accountType}
                onChange={(e) => setAccountType(e.target.value as any)}
                className="h-9 w-full rounded-lg border border-border bg-card px-2.5 text-xs outline-none focus:border-brand-500"
              >
                <option value="merchant">মার্চেন্ট পেমেন্ট (Merchant Pay)</option>
                <option value="personal">পার্সোনাল সেন্ড মানি (Send Money)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-text-muted">হিসাব নম্বর *</label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-card px-2.5 text-xs font-mono font-bold outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-muted">টাকার পরিমাণ (৳) *</label>
              <input
                type="text"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-card px-2.5 text-xs font-bold outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-muted">রেফারেন্স / অর্ডার নং</label>
              <input
                type="text"
                value={orderId}
                onChange={(e) => setOrderId(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-card px-2.5 text-xs font-mono outline-none"
              />
            </div>
          </div>

          <div className="rounded-lg bg-surface-2 p-3 text-xs text-text-subtle">
            <span className="font-semibold text-text-main">💡 কীভাবে পাঠাবেন: </span>
            ডানপাশের কিউআর কার্ডটি স্ক্রিনশট নিয়ে বা ইমেজ সেভ করে কাস্টমারকে মেসেঞ্জার/হোয়াটসঅ্যাপে পাঠিয়ে দিন। কাস্টমার অ্যাপ থেকে স্ক্যান করলেই টাকা ও রেফারেন্স নিজে নিজেই বসে যাবে।
          </div>
        </Card>

        {/* QR Code Branded Card Preview */}
        <div className="flex flex-col items-center justify-center">
          <div
            className={`w-full max-w-[340px] rounded-3xl border-2 ${brandBorder} bg-white p-5 text-center shadow-lg`}
          >
            {/* Top Brand Banner */}
            <div className={`-mx-5 -mt-5 mb-4 rounded-t-3xl ${brandColor} py-3 text-white`}>
              <h4 className="text-base font-black tracking-wider uppercase">
                {isBkash ? "bKash Payment" : "Nagad Payment"}
              </h4>
              <span className="text-[11px] font-medium opacity-90">
                {accountType === "merchant" ? "মার্চেন্ট পেমেন্ট" : "সেন্ড মানি"}
              </span>
            </div>

            {/* QR Code Graphic Box */}
            <div className="relative mx-auto my-2 flex h-52 w-52 items-center justify-center rounded-2xl border-2 border-dashed border-neutral-300 bg-neutral-50 p-3">
              {/* High-contrast QR pattern mockup */}
              <div className="grid grid-cols-7 gap-1 h-full w-full p-2 bg-white rounded-xl shadow-inner">
                {Array.from({ length: 49 }).map((_, i) => (
                  <div
                    key={i}
                    className={`rounded-sm ${
                      [0, 1, 2, 6, 7, 8, 14, 20, 28, 34, 40, 41, 42, 48, 24, 18, 30].includes(i) ||
                      (i * 7) % 3 === 0
                        ? "bg-black"
                        : "bg-transparent"
                    }`}
                  />
                ))}
              </div>
              <div
                className={`absolute rounded-lg ${brandColor} px-2 py-0.5 text-[10px] font-black text-white shadow-md`}
              >
                SCAN ME
              </div>
            </div>

            {/* Amount & Account Info */}
            <div className="mt-3 space-y-1">
              <span className="text-xs text-neutral-500 font-medium">পরিশোধের পরিমাণ:</span>
              <p className={`text-2xl font-black ${brandText}`}>
                ৳ {Number(amount || 0).toLocaleString("en-BD")}
              </p>
              <p className="font-mono text-sm font-bold text-neutral-800">{phone}</p>
              {orderId && (
                <span className="inline-block rounded-full bg-neutral-100 px-2.5 py-0.5 font-mono text-[11px] text-neutral-600">
                  রেফারেন্স: {orderId}
                </span>
              )}
            </div>

            {/* Instructions */}
            <div className="mt-4 border-t border-neutral-100 pt-2 text-[10px] text-neutral-500">
              {isBkash ? "বিকাশ" : "নগদ"} অ্যাপের কিউআর স্ক্যানার দিয়ে স্ক্যান করে পেমেন্ট সম্পন্ন করুন।
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
