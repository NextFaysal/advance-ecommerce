"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Money } from "@/components/ui/money";
import { useLocale } from "@/i18n/LocaleProvider";
export interface CourierBreakdown {
  courierName: string;
  delivered: number;
  cancelled: number;
  returned: number;
  successRate: number;
}

export interface CourierPhoneHistory {
  phone: string;
  phoneMasked: string;
  isBlacklisted: boolean;
  blacklistReason?: string;
  isWhitelisted: boolean;
  whitelistReason?: string;
  totalParcels: number;
  totalDelivered: number;
  totalCancelled: number;
  totalReturned: number;
  successRatePercent: number;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  suggestedAction: "auto_confirm" | "call_verify" | "require_advance" | "block";
  suggestedActionTextBn: string;
  courierBreakdown: CourierBreakdown[];
  storeHistory: {
    totalOrders: number;
    deliveredOrders: number;
    cancelledOrders: number;
    returnedOrders: number;
    lifetimeValuePoisha: number;
  };
}

const SAMPLES = ["01712345678", "01811223344", "01987654321", "01655443322"];

export function PhoneFraudCheckPanel() {
  const { locale } = useLocale();
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CourierPhoneHistory | null>(null);

  const handleSearch = async (targetPhone?: string) => {
    const query = (targetPhone ?? phone).trim();
    if (!query) {
      setError(locale === "bn" ? "মোবাইল নম্বর লিখুন।" : "Please enter a mobile phone number.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/v1/admin/bd/phone-fraud-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: query }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok) {
        setError(json?.error?.message ?? (locale === "bn" ? "যাচাই করতে সমস্যা হয়েছে।" : "Check failed."));
        setResult(null);
        return;
      }

      if (json?.data) {
        setResult(json.data as CourierPhoneHistory);
        setPhone(query);
      }
    } catch {
      setError(locale === "bn" ? "সার্ভার সংযোগে ত্রুটি।" : "Network connection error.");
    } finally {
      setLoading(false);
    }
  };

  const riskBadgeTone =
    result?.riskLevel === "HIGH" ? "danger" : result?.riskLevel === "MEDIUM" ? "warning" : "success";

  return (
    <div className="space-y-6">
      {/* Header & Search */}
      <div className="rounded-xl border border-brand-200 bg-brand-50/25 p-5">
        <h2 className="text-base font-semibold text-text-main">
          {locale === "bn" ? "কাস্টমার কুরিয়ার ফ্রড ও ডেলিভারি হিস্ট্রি চেকার" : "Courier Delivery & Fraud Checker"}
        </h2>
        <p className="mt-1 text-xs text-text-muted">
          {locale === "bn"
            ? "যেকোনো মোবাইল নম্বর লিখে সার্চ করুন — Steadfast, Pathao, RedX সহ সব কুরিয়ারে সে আগে কয়টি পার্সেল নিয়েছে বা ক্যানসেল করেছে তা এক নজরে দেখুন।"
            : "Lookup any customer mobile number to view cross-courier delivery success rate and cancel history."}
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSearch();
          }}
          className="mt-4 flex flex-wrap items-center gap-2"
        >
          <div className="relative flex-1 min-w-[240px]">
            <input
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="017XXXXXXXX"
              className="h-10 w-full rounded-[10px] border border-border bg-card px-3 text-sm font-mono outline-none focus:border-brand-500 focus:ring-[3px] focus:ring-brand-100"
            />
          </div>
          <Button type="submit" disabled={loading}>
            {loading ? (
              locale === "bn" ? "যাচাই হচ্ছে..." : "Checking..."
            ) : (
              <>
                <Icon name="search" size={16} className="mr-1.5 inline" />
                {locale === "bn" ? "হিস্ট্রি দেখুন" : "Check History"}
              </>
            )}
          </Button>
        </form>

        {/* Quick Samples */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
          <span>{locale === "bn" ? "দ্রুত টেস্ট করুন:" : "Quick samples:"}</span>
          {SAMPLES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => void handleSearch(s)}
              className="rounded bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-text-main transition hover:bg-brand-100"
            >
              {s}
            </button>
          ))}
        </div>

        {error && (
          <div role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-700">
            ⚠ {error}
          </div>
        )}
      </div>

      {/* Result Display */}
      {result && (
        <div className="space-y-5 animate-in fade-in duration-300">
          {/* Top Score Banner */}
          <Card className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-lg font-bold text-text-main">{result.phone}</span>
                  <Badge tone={riskBadgeTone}>
                    {result.riskLevel === "HIGH"
                      ? "উচ্চ ঝুঁকি (HIGH RISK)"
                      : result.riskLevel === "MEDIUM"
                      ? "মাঝারি ঝুঁকি (MEDIUM RISK)"
                      : "নিরাপদ ক্রেতা (SAFE)"}
                  </Badge>
                  {result.isBlacklisted && <Badge tone="danger">কালো তালিকাভুক্ত (Blacklisted)</Badge>}
                  {result.isWhitelisted && <Badge tone="success">বিশ্বস্ত ক্রেতা (Whitelisted)</Badge>}
                </div>
                <p className="mt-1 text-sm font-medium text-text-main">
                  {result.suggestedActionTextBn}
                </p>
                {result.blacklistReason && (
                  <p className="mt-1 text-xs text-rose-600">কারণ: {result.blacklistReason}</p>
                )}
              </div>

              {/* Success Rate Circle / Stat */}
              <div className="flex items-center gap-4 rounded-xl bg-surface-2 px-4 py-3">
                <div className="text-center">
                  <span className="block text-2xl font-black text-brand-600">
                    {result.successRatePercent}%
                  </span>
                  <span className="text-[11px] font-medium text-text-muted">
                    {locale === "bn" ? "সাফল্যের হার" : "Success Rate"}
                  </span>
                </div>
                <div className="h-8 w-px bg-border" />
                <div className="text-xs space-y-0.5">
                  <p className="text-success-solid font-medium">✓ রিসিভড: {result.totalDelivered}টি</p>
                  <p className="text-danger font-medium">✗ ক্যানসেল: {result.totalCancelled}টি</p>
                  <p className="text-text-muted">মোট বুকিং: {result.totalParcels}টি</p>
                </div>
              </div>
            </div>

            {/* Quick Action Buttons */}
            <div className="mt-4 flex flex-wrap gap-2 pt-3 border-t border-border">
              <a
                href={`https://wa.me/880${result.phone.slice(-10)}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100"
              >
                <Icon name="phone" size={14} className="mr-1.5" />
                হোয়াটসঅ্যাপে চ্যাট করুন
              </a>
              <a
                href={`tel:${result.phone}`}
                className="inline-flex items-center rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-xs font-semibold text-text-main transition hover:bg-brand-50"
              >
                <Icon name="phone" size={14} className="mr-1.5" />
                সরাসরি কল দিন
              </a>
            </div>
          </Card>

          {/* Courier Breakdown Grid */}
          <div>
            <h3 className="mb-3 font-display text-sm font-semibold text-text-main">
              {locale === "bn" ? "কুরিয়ারভিত্তিক বিগত ডেলিভারি রিপোর্ট" : "Courier-by-Courier History"}
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {result.courierBreakdown.map((c) => (
                <div
                  key={c.courierName}
                  className="rounded-xl border border-border bg-card p-3.5 shadow-sm"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-text-main">{c.courierName}</span>
                    <Badge tone={c.successRate >= 80 ? "success" : c.successRate >= 60 ? "warning" : "danger"}>
                      {c.successRate}%
                    </Badge>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded bg-emerald-50/60 p-2 text-emerald-800">
                      <span className="block text-[10px] text-text-muted">ডেলিভারি</span>
                      <span className="font-bold">{c.delivered}টি</span>
                    </div>
                    <div className="rounded bg-rose-50/60 p-2 text-rose-800">
                      <span className="block text-[10px] text-text-muted">ক্যানসেল</span>
                      <span className="font-bold">{c.cancelled}টি</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Store History */}
          <div className="rounded-xl border border-border bg-surface-2 p-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              {locale === "bn" ? "আমাদের দোকানে বিগত অর্ডার রেকর্ড" : "In-Store Purchase History"}
            </h4>
            <div className="mt-2 grid grid-cols-2 gap-4 sm:grid-cols-4 text-sm">
              <div>
                <span className="block text-xs text-text-muted">মোট অর্ডার</span>
                <span className="font-semibold text-text-main">{result.storeHistory.totalOrders}টি</span>
              </div>
              <div>
                <span className="block text-xs text-text-muted">সফল ডেলিভারি</span>
                <span className="font-semibold text-emerald-600">{result.storeHistory.deliveredOrders}টি</span>
              </div>
              <div>
                <span className="block text-xs text-text-muted">বাতিল / ক্যানসেল</span>
                <span className="font-semibold text-rose-600">{result.storeHistory.cancelledOrders}টি</span>
              </div>
              <div>
                <span className="block text-xs text-text-muted">মোট কেনাকাটার মূল্য</span>
                <span className="font-semibold text-text-main">
                  <Money poisha={result.storeHistory.lifetimeValuePoisha} />
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
