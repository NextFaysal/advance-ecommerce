"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Badge } from "@/components/ui/badge";
import { useLocale } from "@/i18n/LocaleProvider";

interface LabelOrder {
  id: string;
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  address: string;
  district: string;
  codAmount: number;
  courier: string;
  trackingId: string;
  items: string;
  date: string;
}

const SAMPLE_ORDERS: LabelOrder[] = [
  {
    id: "ord_101",
    orderNumber: "#ORD-8942",
    customerName: "মাহমুদুল হাসান",
    customerPhone: "01712-345678",
    address: "বাসা ১২, রোড ৩, সেক্টর ৭, উত্তরা",
    district: "Dhaka",
    codAmount: 1450,
    courier: "Steadfast Courier",
    trackingId: "STD89421099",
    items: "প্রিমিয়াম ব্ল্যাক হুডি (L) x 1",
    date: "31 Oct, 2026",
  },
  {
    id: "ord_102",
    orderNumber: "#ORD-8943",
    customerName: "সাব্বির আহমেদ",
    customerPhone: "01855-987654",
    address: "জিইসি মোড়, নাসিরাবাদ",
    district: "Chattogram",
    codAmount: 2200,
    courier: "Pathao Courier",
    trackingId: "PT99321455",
    items: "ড্রাই ফিট টি-শার্ট কম্বো x 2",
    date: "31 Oct, 2026",
  },
];

export function ShippingLabelsPanel() {
  const { locale } = useLocale();
  const [orders, setOrders] = useState<LabelOrder[]>(SAMPLE_ORDERS);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(SAMPLE_ORDERS.map((o) => o.id)));
  const [storeName, setStoreName] = useState("Advance E-Commerce");
  const [storePhone, setStorePhone] = useState("01900-000000");
  const [storeAddress, setStoreAddress] = useState("ঢাকা, বাংলাদেশ");
  const [labelSize, setLabelSize] = useState<"thermal_4x6" | "thermal_3x2">("thermal_4x6");

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      {/* Configuration & Action Bar (Hidden when printing) */}
      <div className="print:hidden space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
          <div>
            <h2 className="text-base font-semibold text-text-main">
              {locale === "bn" ? "কুরিয়ার শিপিং লেবেল ও বারকোড প্রিন্টার" : "Courier Shipping Label & Barcode Printer"}
            </h2>
            <p className="mt-0.5 text-xs text-text-muted">
              {locale === "bn"
                ? "পার্সেলের গায়ে লাগানোর জন্য থার্মাল স্টিকার সাইজ লেবেল তৈরি ও সরাসরি প্রিন্ট করুন"
                : "Generate and print 4x6\" or 3x2\" thermal sticker labels with barcode and COD details"}
            </p>
          </div>
          <Button onClick={handlePrint} size="sm">
            <Icon name="package" size={15} className="mr-1.5 inline" />
            {locale === "bn" ? "লেবেল প্রিন্ট করুন (Ctrl + P)" : "Print Labels"}
          </Button>
        </div>

        {/* Sender Info & Format Controls */}
        <Card className="p-4 bg-surface-2">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-text-muted">
                {locale === "bn" ? "লেবেল সাইজ" : "Label Size"}
              </label>
              <select
                value={labelSize}
                onChange={(e) => setLabelSize(e.target.value as any)}
                className="h-9 w-full rounded-lg border border-border bg-card px-2.5 text-xs outline-none focus:border-brand-500"
              >
                <option value="thermal_4x6">4" × 6" থার্মাল স্টিকার (স্ট্যান্ডার্ড)</option>
                <option value="thermal_3x2">3" × 2" কম্প্যাক্ট স্টিকার</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-muted">
                {locale === "bn" ? "দোকানের নাম (Sender)" : "Store Name"}
              </label>
              <input
                type="text"
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-card px-2.5 text-xs outline-none focus:border-brand-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-muted">
                {locale === "bn" ? "হেল্পলাইন ফোন" : "Store Phone"}
              </label>
              <input
                type="text"
                value={storePhone}
                onChange={(e) => setStorePhone(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-card px-2.5 text-xs outline-none focus:border-brand-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-muted">
                {locale === "bn" ? "প্রেরকের ঠিকানা" : "Store Address"}
              </label>
              <input
                type="text"
                value={storeAddress}
                onChange={(e) => setStoreAddress(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-card px-2.5 text-xs outline-none focus:border-brand-500"
              />
            </div>
          </div>
        </Card>
      </div>

      {/* Label Previews (Renders for Print as well) */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 print:grid-cols-1 print:gap-4">
        {orders
          .filter((o) => selectedIds.has(o.id))
          .map((o) => (
            <div
              key={o.id}
              className={`rounded-xl border-2 border-black bg-white p-4 text-black shadow-sm print:shadow-none print:border-black ${
                labelSize === "thermal_3x2" ? "max-w-[340px] text-xs" : "max-w-[420px]"
              }`}
            >
              {/* Courier & Tracking Header */}
              <div className="flex items-center justify-between border-b-2 border-black pb-2">
                <div>
                  <span className="text-xs font-black uppercase tracking-wider">{o.courier}</span>
                  <p className="font-mono text-sm font-bold">{o.trackingId}</p>
                </div>
                <div className="text-right">
                  <span className="rounded bg-black px-1.5 py-0.5 text-[11px] font-bold text-white">
                    COD
                  </span>
                  <p className="mt-0.5 text-xs font-semibold">{o.district}</p>
                </div>
              </div>

              {/* Barcode Simulation */}
              <div className="my-2.5 flex flex-col items-center justify-center border-b-2 border-black pb-2">
                <div className="flex h-10 w-48 items-end justify-between bg-white px-2">
                  {[4, 2, 6, 2, 5, 2, 7, 3, 5, 2, 6, 4, 2, 7, 3, 5, 2, 6, 2, 5, 3].map((w, i) => (
                    <div
                      key={i}
                      className="h-full bg-black"
                      style={{ width: `${w * 1.5}px` }}
                    />
                  ))}
                </div>
                <span className="mt-1 font-mono text-xs tracking-widest">{o.orderNumber}</span>
              </div>

              {/* Recipient Info */}
              <div className="space-y-1 border-b-2 border-black pb-2 text-xs">
                <p className="font-semibold uppercase text-neutral-600 text-[10px]">Recipient (প্রাপক):</p>
                <p className="text-sm font-bold">{o.customerName}</p>
                <p className="font-mono text-xs font-bold">{o.customerPhone}</p>
                <p className="text-xs leading-snug">{o.address}, {o.district}</p>
              </div>

              {/* COD Amount Big Box */}
              <div className="my-2 flex items-center justify-between rounded border-2 border-black bg-neutral-100 p-2">
                <span className="text-xs font-bold uppercase">Cash to Collect (COD):</span>
                <span className="text-lg font-black">৳ {o.codAmount.toLocaleString("en-BD")}</span>
              </div>

              {/* Order Items & Date */}
              <div className="border-b-2 border-black pb-2 text-[11px]">
                <span className="text-[10px] text-neutral-500">আইটেম:</span>
                <p className="font-medium">{o.items}</p>
              </div>

              {/* Sender Store Footer */}
              <div className="mt-2 flex items-center justify-between text-[10px] text-neutral-700">
                <div>
                  <span className="font-bold">{storeName}</span> · {storePhone}
                  <p>{storeAddress}</p>
                </div>
                <span className="text-neutral-500">{o.date}</span>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
