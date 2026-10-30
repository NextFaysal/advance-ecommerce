"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { useLocale } from "@/i18n/LocaleProvider";

interface ClaimItem {
  id: string;
  trackingId: string;
  orderNumber: string;
  courier: string;
  itemValue: number;
  daysStuck: number;
  status: "submitted" | "investigating" | "compensated" | "resolved_returned";
  compensatedAmount: number;
  notes: string;
  date: string;
}

const INITIAL_CLAIMS: ClaimItem[] = [
  {
    id: "cl_1",
    trackingId: "STD90112344",
    orderNumber: "#ORD-8712",
    courier: "Steadfast Courier",
    itemValue: 2400,
    daysStuck: 9,
    status: "investigating",
    compensatedAmount: 0,
    notes: "রংপুর হাবে ৯ দিন ধরে কোনো আপডেট নেই, রাইডার ফোন ধরছে না।",
    date: "28 Oct, 2026",
  },
  {
    id: "cl_2",
    trackingId: "PT44119900",
    orderNumber: "#ORD-8690",
    courier: "Pathao Courier",
    itemValue: 1850,
    daysStuck: 14,
    status: "compensated",
    compensatedAmount: 1850,
    notes: "পার্সেল ট্রানজিটে হারিয়ে গিয়েছিল, কুরিয়ার ক্ষতিপূরণ মঞ্জুর করেছে।",
    date: "24 Oct, 2026",
  },
];

export function CourierDisputeClaimPanel() {
  const { locale } = useLocale();
  const [claims, setClaims] = useState<ClaimItem[]>(INITIAL_CLAIMS);

  const [trackingId, setTrackingId] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [courier, setCourier] = useState("Steadfast Courier");
  const [itemValue, setItemValue] = useState(1500);
  const [daysStuck, setDaysStuck] = useState(7);
  const [notes, setNotes] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const handleSubmitClaim = (e: React.FormEvent) => {
    e.preventDefault();
    if (!trackingId.trim()) return;

    const newClaim: ClaimItem = {
      id: `cl_${Date.now()}`,
      trackingId: trackingId.trim().toUpperCase(),
      orderNumber: orderNumber.trim() || `#ORD-${Math.floor(1000 + Math.random() * 9000)}`,
      courier,
      itemValue,
      daysStuck,
      status: "submitted",
      compensatedAmount: 0,
      notes: notes.trim() || "হাবের সাথে যোগাযোগ করে ট্র্যাকিং স্ট্যাটাস আটকে আছে।",
      date: new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
    };

    setClaims([newClaim, ...claims]);
    setMsg(
      locale === "bn"
        ? `ক্লেইম সফলভাবে রেকর্ড করা হয়েছে (ট্র্যাকিং: ${newClaim.trackingId})!`
        : `Claim filed for ${newClaim.trackingId}`
    );

    setTrackingId("");
    setOrderNumber("");
    setNotes("");
  };

  const handleStatusChange = (id: string, newStatus: ClaimItem["status"], compAmt?: number) => {
    setClaims(
      claims.map((c) =>
        c.id === id
          ? {
              ...c,
              status: newStatus,
              compensatedAmount: compAmt !== undefined ? compAmt : c.compensatedAmount,
            }
          : c
      )
    );
  };

  const totalCompensated = claims.reduce((sum, c) => sum + c.compensatedAmount, 0);
  const totalPendingClaim = claims
    .filter((c) => c.status === "submitted" || c.status === "investigating")
    .reduce((sum, c) => sum + c.itemValue, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-base font-semibold text-text-main">
          {locale === "bn" ? "কুরিয়ার মিসিং পার্সেল ও ক্ষতিপূরণ ক্লেইম ট্র্যাকার" : "Lost Parcel & Courier Compensation Tracker"}
        </h2>
        <p className="mt-0.5 text-xs text-text-muted">
          {locale === "bn"
            ? "কুরিয়ার হাবে আটকে থাকা বা হারিয়ে যাওয়া পার্সেলের অভিযোগ নথিভুক্ত করুন এবং ক্ষতিপূরণের টাকা আদায় ট্র্যাক করুন"
            : "Track stuck in transit or lost parcels and manage courier compensation claims"}
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <span className="text-xs text-text-muted">মোট দায়েরকৃত ক্লেইম</span>
          <p className="mt-1 text-2xl font-bold text-text-main">{claims.length}টি</p>
        </div>
        <div className="rounded-xl border border-border bg-emerald-50/50 p-4">
          <span className="text-xs text-emerald-800 font-medium">কুরিয়ার থেকে ক্ষতিপূরণ আদায়</span>
          <p className="mt-1 text-2xl font-bold text-emerald-800">৳ {totalCompensated.toLocaleString("en-BD")}</p>
        </div>
        <div className="rounded-xl border border-border bg-amber-50/50 p-4">
          <span className="text-xs text-amber-800 font-medium">তদন্তাধীন পাওনা টাকা</span>
          <p className="mt-1 text-2xl font-bold text-amber-800">৳ {totalPendingClaim.toLocaleString("en-BD")}</p>
        </div>
      </div>

      {/* New Claim Form */}
      <Card className="p-5 border border-brand-200 bg-brand-50/15">
        <form onSubmit={handleSubmitClaim} className="space-y-4">
          <h3 className="text-sm font-semibold text-text-main">
            {locale === "bn" ? "নতুন মিসিং পার্সেল অভিযোগ যুক্ত করুন" : "File Lost Parcel Claim"}
          </h3>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-text-muted">কুরিয়ার ট্র্যাকিং কোড *</label>
              <input
                type="text"
                required
                value={trackingId}
                onChange={(e) => setTrackingId(e.target.value)}
                placeholder="STD12345678"
                className="h-9 w-full rounded-lg border border-border bg-card px-2.5 text-xs font-mono outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-muted">অর্ডার নম্বর</label>
              <input
                type="text"
                value={orderNumber}
                onChange={(e) => setOrderNumber(e.target.value)}
                placeholder="#ORD-8940"
                className="h-9 w-full rounded-lg border border-border bg-card px-2.5 text-xs outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-muted">কুরিয়ার কোম্পানি</label>
              <select
                value={courier}
                onChange={(e) => setCourier(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-card px-2.5 text-xs outline-none"
              >
                <option value="Steadfast Courier">Steadfast Courier</option>
                <option value="Pathao Courier">Pathao Courier</option>
                <option value="RedX Logistics">RedX Logistics</option>
                <option value="Paperfly">Paperfly</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-muted">পণ্যের মূল্য (৳)</label>
              <input
                type="number"
                value={itemValue}
                onChange={(e) => setItemValue(Number(e.target.value))}
                className="h-9 w-full rounded-lg border border-border bg-card px-2.5 text-xs outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-text-muted">কত দিন ধরে হাবে আটকে?</label>
              <input
                type="number"
                value={daysStuck}
                onChange={(e) => setDaysStuck(Number(e.target.value))}
                className="h-9 w-full rounded-lg border border-border bg-card px-2.5 text-xs outline-none"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-text-muted">অভিযোগের বিবরণ / নোট</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="যেমন: হাবে ৪ দিন ধরে আউট ফর ডেলিভারি দেখাচ্ছে কিন্তু কাস্টমার পায়নি"
                className="h-9 w-full rounded-lg border border-border bg-card px-2.5 text-xs outline-none"
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <span className="text-xs text-text-muted">
              💡 কুরিয়ার ম্যানেজারের সাথে ক্লেইম রেফারেন্স দিয়ে কথা বলুন
            </span>
            <Button type="submit">
              <Icon name="alert" size={15} className="mr-1.5 inline" />
              {locale === "bn" ? "অভিযোগ রেকর্ড করুন" : "Submit Claim"}
            </Button>
          </div>

          {msg && (
            <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-2.5 text-xs text-emerald-800">
              ✓ {msg}
            </div>
          )}
        </form>
      </Card>

      {/* Claims List Table */}
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-border bg-surface-2 text-text-muted">
            <tr>
              <th className="p-3">ট্র্যাকিং ও তারিখ</th>
              <th className="p-3">কুরিয়ার ও অর্ডার</th>
              <th className="p-3">পণ্যের দাম</th>
              <th className="p-3">আটকে থাকার সময়</th>
              <th className="p-3">অবস্থা (Status)</th>
              <th className="p-3">আদায়কৃত ক্ষতিপূরণ</th>
              <th className="p-3 text-right">স্ট্যাটাস আপডেট</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {claims.map((c) => (
              <tr key={c.id} className="hover:bg-surface-1">
                <td className="p-3">
                  <span className="font-mono font-bold text-text-main">{c.trackingId}</span>
                  <span className="block text-[11px] text-text-muted">{c.date}</span>
                </td>
                <td className="p-3">
                  <span className="font-semibold text-text-main">{c.courier}</span>
                  <span className="block text-[11px] text-text-muted">{c.orderNumber}</span>
                </td>
                <td className="p-3 font-bold text-text-main">৳ {c.itemValue}</td>
                <td className="p-3">
                  <Badge tone={c.daysStuck >= 10 ? "danger" : "warning"}>
                    {c.daysStuck} দিন
                  </Badge>
                </td>
                <td className="p-3">
                  <Badge
                    tone={
                      c.status === "compensated"
                        ? "success"
                        : c.status === "investigating"
                        ? "warning"
                        : c.status === "resolved_returned"
                        ? "info"
                        : "neutral"
                    }
                  >
                    {c.status === "compensated"
                      ? "ক্ষতিপূরণ পরিশোধিত"
                      : c.status === "investigating"
                      ? "তদন্ত চলছে"
                      : c.status === "resolved_returned"
                      ? "দেরিতে ফেরত"
                      : "জমা দেওয়া হয়েছে"}
                  </Badge>
                </td>
                <td className="p-3 font-mono font-bold text-emerald-600">
                  {c.compensatedAmount > 0 ? `৳ ${c.compensatedAmount}` : "—"}
                </td>
                <td className="p-3 text-right">
                  {c.status !== "compensated" && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => handleStatusChange(c.id, "compensated", c.itemValue)}
                      className="text-[11px] text-emerald-700 hover:bg-emerald-50"
                    >
                      ক্ষতিপূরণ পেয়েছি
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
