"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Money } from "@/components/ui/money";
import { useLocale } from "@/i18n/LocaleProvider";

interface ReturnItem {
  id: string;
  trackingId: string;
  orderNumber: string;
  courier: string;
  customerName: string;
  customerPhone: string;
  returnCharge: number;
  productTitle: string;
  condition: "intact" | "damaged";
  reason: string;
  restocked: boolean;
  receivedAt: string;
}

const INITIAL_RETURNS: ReturnItem[] = [
  {
    id: "ret_1",
    trackingId: "STD88112044",
    orderNumber: "#ORD-8910",
    courier: "Steadfast Courier",
    customerName: "কামাল উদ্দিন",
    customerPhone: "01722-114477",
    returnCharge: 60,
    productTitle: "উইন্টার জ্যাকেট (XL)",
    condition: "intact",
    reason: "কাস্টমার কল রিসিভ করেনি (Phone Unreachable)",
    restocked: true,
    receivedAt: "30 Oct, 2026",
  },
  {
    id: "ret_2",
    trackingId: "PT55441199",
    orderNumber: "#ORD-8915",
    courier: "Pathao Courier",
    customerName: "রাকিব হাসান",
    customerPhone: "01911-336699",
    returnCharge: 100,
    productTitle: "ব্লুটুথ ইয়ারবাডস",
    condition: "intact",
    reason: "কাস্টমার পার্সেল নিতে অপারগতা প্রকাশ করেছে (Customer Refused)",
    restocked: false,
    receivedAt: "31 Oct, 2026",
  },
];

export function ReturnTrackerPanel() {
  const { locale } = useLocale();
  const [returns, setReturns] = useState<ReturnItem[]>(INITIAL_RETURNS);
  const [trackingInput, setTrackingInput] = useState("");
  const [courier, setCourier] = useState("Steadfast Courier");
  const [returnCharge, setReturnCharge] = useState(60);
  const [condition, setCondition] = useState<"intact" | "damaged">("intact");
  const [reason, setReason] = useState("কাস্টমার পার্সেল রিসিভ করেনি");
  const [productTitle, setProductTitle] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleReceiveReturn = (e: React.FormEvent) => {
    e.preventDefault();
    if (!trackingInput.trim()) return;

    const newItem: ReturnItem = {
      id: `ret_${Date.now()}`,
      trackingId: trackingInput.trim().toUpperCase(),
      orderNumber: orderNumber.trim() || `#ORD-${Math.floor(1000 + Math.random() * 9000)}`,
      courier,
      customerName: "কাস্টমার",
      customerPhone: customerPhone.trim() || "017XXXXXXXX",
      returnCharge,
      productTitle: productTitle.trim() || "অর্ডার আইটেম",
      condition,
      reason,
      restocked: condition === "intact",
      receivedAt: new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
    };

    setReturns([newItem, ...returns]);
    setSuccessMsg(
      locale === "bn"
        ? `পার্সেল ${newItem.trackingId} সফলভাবে রিসিভ করা হয়েছে${condition === "intact" ? " এবং ইনভেন্টরিতে স্টক ব্যাক করা হয়েছে!" : "!"}`
        : `Return ${newItem.trackingId} recorded successfully!`
    );

    setTrackingInput("");
    setProductTitle("");
    setOrderNumber("");
    setCustomerPhone("");
  };

  const handleRestock = (id: string) => {
    setReturns(
      returns.map((r) => (r.id === id ? { ...r, restocked: true } : r))
    );
  };

  const totalReturnLoss = returns.reduce((sum, r) => sum + r.returnCharge, 0);
  const restockedCount = returns.filter((r) => r.restocked).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-base font-semibold text-text-main">
          {locale === "bn" ? "রিটার্ন পার্সেল ট্র্যাকার ও স্টক ইনওয়ার্ড (RTO Management)" : "Return Parcel & Restock Tracker"}
        </h2>
        <p className="mt-0.5 text-xs text-text-muted">
          {locale === "bn"
            ? "কুরিয়ার থেকে ফেরত আসা পার্সেল স্ক্যান করে রিসিভ করুন, লোকসান হিসাব রাখুন এবং স্টকে ফেরত যুক্ত করুন"
            : "Receive returned parcels, track return delivery charges loss and restock inventory"}
        </p>
      </div>

      {/* Summary Stat Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <span className="text-xs text-text-muted">মোট ফেরত পার্সেল</span>
          <p className="mt-1 text-2xl font-bold text-text-main">{returns.length}টি</p>
        </div>
        <div className="rounded-xl border border-border bg-rose-50/50 p-4">
          <span className="text-xs text-rose-700 font-medium">কুরিয়ার রিটার্ন চার্জ বাবদ লোকসান</span>
          <p className="mt-1 text-2xl font-bold text-rose-700">৳ {totalReturnLoss.toLocaleString("en-BD")}</p>
        </div>
        <div className="rounded-xl border border-border bg-emerald-50/50 p-4">
          <span className="text-xs text-emerald-800 font-medium">স্টকে ফেরত নেওয়া হয়েছে</span>
          <p className="mt-1 text-2xl font-bold text-emerald-800">{restockedCount}টি আইটেম</p>
        </div>
      </div>

      {/* Receive Return Form */}
      <Card className="p-5 border border-brand-200 bg-brand-50/15">
        <form onSubmit={handleReceiveReturn} className="space-y-4">
          <h3 className="text-sm font-semibold text-text-main">
            {locale === "bn" ? "নতুন ফেরত পার্সেল রিসিভ করুন" : "Receive Returned Parcel"}
          </h3>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-text-muted">
                {locale === "bn" ? "কুরিয়ার ট্র্যাকিং কোড *" : "Tracking ID *"}
              </label>
              <input
                type="text"
                required
                value={trackingInput}
                onChange={(e) => setTrackingInput(e.target.value)}
                placeholder="STD12345678 বা বারকোড স্ক্যান করুন"
                className="h-10 w-full rounded-[10px] border border-border bg-card px-3 text-sm font-mono outline-none focus:border-brand-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-muted">
                {locale === "bn" ? "কুরিয়ার কোম্পানি" : "Courier Provider"}
              </label>
              <select
                value={courier}
                onChange={(e) => setCourier(e.target.value)}
                className="h-10 w-full rounded-[10px] border border-border bg-card px-3 text-sm outline-none focus:border-brand-500"
              >
                <option value="Steadfast Courier">Steadfast Courier</option>
                <option value="Pathao Courier">Pathao Courier</option>
                <option value="RedX Logistics">RedX Logistics</option>
                <option value="Paperfly">Paperfly</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-muted">
                {locale === "bn" ? "রিটার্ন ডেলিভারি চার্জ (৳)" : "Return Fee (৳)"}
              </label>
              <input
                type="number"
                value={returnCharge}
                onChange={(e) => setReturnCharge(Number(e.target.value))}
                className="h-10 w-full rounded-[10px] border border-border bg-card px-3 text-sm outline-none focus:border-brand-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-text-muted">
                {locale === "bn" ? "প্রোডাক্টের নাম" : "Product Title"}
              </label>
              <input
                type="text"
                value={productTitle}
                onChange={(e) => setProductTitle(e.target.value)}
                placeholder="যেমন: পোলো টি-শার্ট (XL)"
                className="h-10 w-full rounded-[10px] border border-border bg-card px-3 text-sm outline-none focus:border-brand-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-muted">
                {locale === "bn" ? "পণ্যটি কেমন অবস্থায় আছে?" : "Item Condition"}
              </label>
              <select
                value={condition}
                onChange={(e) => setCondition(e.target.value as any)}
                className="h-10 w-full rounded-[10px] border border-border bg-card px-3 text-sm outline-none focus:border-brand-500"
              >
                <option value="intact">অক্ষত ও ভালো (ইনভেন্টরিতে স্টক ব্যাক হবে)</option>
                <option value="damaged">নষ্ট / ছেঁড়া / ব্যবহার করা (ড্যামেজ ক্ষতি)</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-muted">
                {locale === "bn" ? "ফেরতের কারণ" : "Return Reason"}
              </label>
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="h-10 w-full rounded-[10px] border border-border bg-card px-3 text-sm outline-none focus:border-brand-500"
              >
                <option value="কাস্টমার পার্সেল রিসিভ করেনি">কাস্টমার পার্সেল রিসিভ করেনি</option>
                <option value="ফোন বন্ধ বা রিসিভ করেনি">ফোন বন্ধ বা রিসিভ করেনি</option>
                <option value="ঠিকানা খুঁজে পায়নি কুরিয়ার">ঠিকানা খুঁজে পায়নি কুরিয়ার</option>
                <option value="পণ্য দেখে পছন্দ হয়নি">পণ্য দেখে পছন্দ হয়নি</option>
              </select>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <span className="text-xs text-text-muted">
              {condition === "intact" ? "✓ এটি স্বয়ংক্রিয়ভাবে ইনভেন্টরিতে বিক্রয়যোগ্য হিসেবে যুক্ত হবে" : "⚠ এটি ড্যামেজ হিসেবে গণ্য হবে"}
            </span>
            <Button type="submit">
              <Icon name="check" size={16} className="mr-1.5 inline" />
              {locale === "bn" ? "পার্সেল রিসিভ নিশ্চিত করুন" : "Confirm Return Received"}
            </Button>
          </div>

          {successMsg && (
            <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
              ✓ {successMsg}
            </div>
          )}
        </form>
      </Card>

      {/* Return Items History Table */}
      <div>
        <h3 className="mb-3 font-display text-sm font-semibold text-text-main">
          {locale === "bn" ? "সম্প্রতি ফেরত পাওয়া পার্সেল তালিকা" : "Recent Returns Log"}
        </h3>
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-border bg-surface-2 text-text-muted">
              <tr>
                <th className="p-3">ট্র্যাকিং ও অর্ডার</th>
                <th className="p-3">কুরিয়ার</th>
                <th className="p-3">আইটেম ও কারণ</th>
                <th className="p-3">রিটার্ন চার্জ লস</th>
                <th className="p-3">অবস্থা ও স্টক</th>
                <th className="p-3 text-right">অ্যাকশন</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {returns.map((r) => (
                <tr key={r.id} className="hover:bg-surface-1">
                  <td className="p-3">
                    <span className="font-mono font-bold text-text-main">{r.trackingId}</span>
                    <span className="block text-[11px] text-text-muted">{r.orderNumber} · {r.receivedAt}</span>
                  </td>
                  <td className="p-3 font-medium text-text-main">{r.courier}</td>
                  <td className="p-3">
                    <span className="font-medium text-text-main">{r.productTitle}</span>
                    <span className="block text-[11px] text-text-muted">{r.reason}</span>
                  </td>
                  <td className="p-3 font-mono font-bold text-rose-600">৳ {r.returnCharge}</td>
                  <td className="p-3">
                    <div className="flex flex-col gap-1">
                      <Badge tone={r.condition === "intact" ? "success" : "danger"}>
                        {r.condition === "intact" ? "ভালো" : "নষ্ট"}
                      </Badge>
                      <span className="text-[10px] text-text-muted">
                        {r.restocked ? "✓ ইনভেন্টরিতে যুক্ত" : "স্টকে নেওয়া হয়নি"}
                      </span>
                    </div>
                  </td>
                  <td className="p-3 text-right">
                    {!r.restocked && r.condition === "intact" && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => handleRestock(r.id)}
                        className="text-[11px]"
                      >
                        স্টকে যুক্ত করুন
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
