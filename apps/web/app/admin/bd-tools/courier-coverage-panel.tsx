"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { useLocale } from "@/i18n/LocaleProvider";

const POPULAR_AREAS = [
  { district: "Dhaka", upazila: "Mirpur", zone: "Inside Dhaka", eta: "২৪-৪৮ ঘণ্টা", charge: 60, steadfast: "হোম ডেলিভারি", pathao: "হোম ডেলিভারি", redx: "হোম ডেলিভারি", paperfly: "হোম ডেলিভারি" },
  { district: "Chattogram", upazila: "Kotwali", zone: "District City", eta: "৪৮-৭২ ঘণ্টা", charge: 120, steadfast: "হোম ডেলিভারি", pathao: "হোম ডেলিভারি", redx: "হোম ডেলিভারি", paperfly: "হোম ডেলিভারি" },
  { district: "Sylhet", upazila: "Sylhet Sadar", zone: "District City", eta: "৪৮-৭২ ঘণ্টা", charge: 120, steadfast: "হোম ডেলিভারি", pathao: "হোম ডেলিভারি", redx: "হোম ডেলিভারি", paperfly: "হোম ডেলিভারি" },
  { district: "Bogura", upazila: "Bogura Sadar", zone: "District City", eta: "৪৮-৭২ ঘণ্টা", charge: 120, steadfast: "হোম ডেলিভারি", pathao: "হোম ডেলিভারি", redx: "হোম ডেলিভারি", paperfly: "হোম ডেলিভারি" },
  { district: "Cox's Bazar", upazila: "Teknaf", zone: "Remote Upazila", eta: "৩-৫ দিন", charge: 140, steadfast: "হোম ডেলিভারি (সাব-হাব)", pathao: "পয়েন্ট পিকআপ", redx: "পয়েন্ট পিকআপ", paperfly: "হোম ডেলিভারি" },
  { district: "Panchagarh", upazila: "Tetulia", zone: "Remote Upazila", eta: "৩-৫ দিন", charge: 140, steadfast: "হোম ডেলিভারি", pathao: "পয়েন্ট পিকআপ", redx: "পয়েন্ট পিকআপ", paperfly: "হোম ডেলিভারি" },
  { district: "Rangamati", upazila: "Kaptai", zone: "Hill Tracts", eta: "৩-৫ দিন", charge: 150, steadfast: "হোম ডেলিভারি (সীমিত)", pathao: "পয়েন্ট পিকআপ", redx: "পয়েন্ট পিকআপ", paperfly: "হোম ডেলিভারি" },
];

export function CourierCoveragePanel() {
  const { locale } = useLocale();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedZone, setSelectedZone] = useState<string>("all");

  const filtered = POPULAR_AREAS.filter((a) => {
    const matchSearch =
      a.district.toLowerCase().includes(searchTerm.toLowerCase()) ||
      a.upazila.toLowerCase().includes(searchTerm.toLowerCase());
    const matchZone = selectedZone === "all" || a.zone === selectedZone;
    return matchSearch && matchZone;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-base font-semibold text-text-main">
          {locale === "bn" ? "উপজেলা ও কুরিয়ার হোম ডেলিভারি কভারেজ চেকার" : "Upazila & Courier Coverage Hub Checker"}
        </h2>
        <p className="mt-0.5 text-xs text-text-muted">
          {locale === "bn"
            ? "কাস্টমারের ঠিকানায় কোন কুরিয়ার হোম ডেলিভারি দেয় আর কোন কুরিয়ার পয়েন্ট থেকে পার্সেল নিতে হবে তা দ্রুত চেক করুন"
            : "Check doorstep delivery vs point pickup availability across Steadfast, Pathao, RedX, and Paperfly"}
        </p>
      </div>

      {/* Filter and Search Bar */}
      <Card className="p-4 bg-surface-2">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="জেলা বা উপজেলার নাম লিখুন (যেমন: Mirpur, Bogura, Teknaf)..."
              className="h-10 w-full rounded-lg border border-border bg-card px-3 text-xs outline-none focus:border-brand-500"
            />
          </div>
          <select
            value={selectedZone}
            onChange={(e) => setSelectedZone(e.target.value)}
            className="h-10 rounded-lg border border-border bg-card px-3 text-xs outline-none"
          >
            <option value="all">সব জোন (All Zones)</option>
            <option value="Inside Dhaka">ঢাকার ভেতরে (Inside Dhaka)</option>
            <option value="District City">জেলা সদর (District City)</option>
            <option value="Remote Upazila">উপজেলা / থানা (Remote Upazila)</option>
            <option value="Hill Tracts">পার্বত্য এলাকা (Hill Tracts)</option>
          </select>
        </div>
      </Card>

      {/* Coverage Table */}
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-border bg-surface-2 text-text-muted">
            <tr>
              <th className="p-3">জেলা ও থানা</th>
              <th className="p-3">ডেলিভারি জোন</th>
              <th className="p-3">আনুমানিক সময়</th>
              <th className="p-3">গড় চার্জ</th>
              <th className="p-3">Steadfast</th>
              <th className="p-3">Pathao</th>
              <th className="p-3">RedX</th>
              <th className="p-3">Paperfly</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((item, idx) => (
              <tr key={idx} className="hover:bg-surface-1">
                <td className="p-3">
                  <span className="font-bold text-text-main">{item.upazila}</span>
                  <span className="block text-[11px] text-text-muted">{item.district}</span>
                </td>
                <td className="p-3">
                  <Badge tone={item.zone === "Inside Dhaka" ? "brand" : item.zone === "District City" ? "info" : "neutral"}>
                    {item.zone}
                  </Badge>
                </td>
                <td className="p-3 font-medium text-text-main">{item.eta}</td>
                <td className="p-3 font-mono font-bold text-text-main">৳ {item.charge}</td>
                <td className="p-3">
                  <Badge tone={item.steadfast.includes("হোম") ? "success" : "warning"}>
                    {item.steadfast}
                  </Badge>
                </td>
                <td className="p-3">
                  <Badge tone={item.pathao.includes("হোম") ? "success" : "neutral"}>
                    {item.pathao}
                  </Badge>
                </td>
                <td className="p-3">
                  <Badge tone={item.redx.includes("হোম") ? "success" : "neutral"}>
                    {item.redx}
                  </Badge>
                </td>
                <td className="p-3">
                  <Badge tone="success">{item.paperfly}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
