"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useLocale } from "@/i18n/LocaleProvider";

export function ProfitCalculatorPanel() {
  const { locale } = useLocale();

  const [sellingPrice, setSellingPrice] = useState(1200);
  const [costPrice, setCostPrice] = useState(650);
  const [shippingZone, setShippingZone] = useState<"inside_dhaka" | "outside_dhaka">("outside_dhaka");
  const [customerShipping, setCustomerShipping] = useState(100);
  const [courierFee, setCourierFee] = useState(120);
  const [packagingCost, setPackagingCost] = useState(25);
  const [codPercent, setCodPercent] = useState(1);
  const [returnRate, setReturnRate] = useState(10);
  const [returnCharge, setReturnCharge] = useState(80);

  // Math
  const codFee = Math.round((sellingPrice * codPercent) / 100);
  const netShippingExpense = Math.max(0, courierFee - customerShipping);
  const totalDirectExpenses = costPrice + netShippingExpense + codFee + packagingCost;
  const netProfitOnDelivery = sellingPrice - totalDirectExpenses;
  const netProfitMarginPercent = sellingPrice > 0 ? Math.round((netProfitOnDelivery / sellingPrice) * 100) : 0;

  // Expected value accounting for return risk:
  // e.g. If 10% return, we lose (packaging + returnCharge + courierFee) on 10% orders
  const returnLossPerReturn = packagingCost + courierFee + returnCharge;
  const returnRiskCushion = Math.round((returnLossPerReturn * returnRate) / 100);
  const expectedRealisticProfit = netProfitOnDelivery - returnRiskCushion;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-base font-semibold text-text-main">
          {locale === "bn" ? "কুরিয়ার ডেলিভারি ও নেট প্রফিট ক্যালকুলেটর" : "Courier Shipping & Net Margin Calculator"}
        </h2>
        <p className="mt-0.5 text-xs text-text-muted">
          {locale === "bn"
            ? "পণ্যের ক্রয়মূল্য, কুরিয়ার চার্জ, ১% COD কমিশন ও রিটার্ন রিস্ক মিলিয়ে প্রতিটি অর্ডারে আসল খাঁটি লাভ (Net Profit) হিসাব করুন"
            : "Calculate true profit margins factoring in BD courier charges, 1% COD fee, packaging, and return rate risk"}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Input Parameters (2 cols) */}
        <Card className="p-5 lg:col-span-2 space-y-4">
          <h3 className="text-sm font-semibold text-text-main pb-2 border-b border-border">
            {locale === "bn" ? "খরচ ও মূল্যের তথ্য (Expense Inputs)" : "Pricing & Cost Inputs"}
          </h3>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-text-muted">
                পণ্যের বিক্রয়মূল্য (Selling Price ৳) *
              </label>
              <input
                type="number"
                value={sellingPrice}
                onChange={(e) => setSellingPrice(Number(e.target.value))}
                className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm font-bold outline-none focus:border-brand-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-muted">
                পাইকারি ক্রয়মূল্য (Cost Price ৳) *
              </label>
              <input
                type="number"
                value={costPrice}
                onChange={(e) => setCostPrice(Number(e.target.value))}
                className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm font-bold outline-none focus:border-brand-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 pt-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-text-muted">ডেলিভারি এলাকা</label>
              <select
                value={shippingZone}
                onChange={(e) => {
                  const z = e.target.value as any;
                  setShippingZone(z);
                  if (z === "inside_dhaka") {
                    setCourierFee(60);
                    setCustomerShipping(60);
                    setReturnCharge(50);
                  } else {
                    setCourierFee(120);
                    setCustomerShipping(100);
                    setReturnCharge(80);
                  }
                }}
                className="h-9 w-full rounded-lg border border-border bg-card px-2.5 text-xs outline-none focus:border-brand-500"
              >
                <option value="inside_dhaka">ঢাকার ভেতরে (Inside Dhaka)</option>
                <option value="outside_dhaka">ঢাকার বাইরে (Outside Dhaka)</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-muted">
                কুরিয়ারের চার্জ (৳)
              </label>
              <input
                type="number"
                value={courierFee}
                onChange={(e) => setCourierFee(Number(e.target.value))}
                className="h-9 w-full rounded-lg border border-border bg-card px-2.5 text-xs outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-muted">
                কাস্টমার থেকে নেওয়া চার্জ (৳)
              </label>
              <input
                type="number"
                value={customerShipping}
                onChange={(e) => setCustomerShipping(Number(e.target.value))}
                className="h-9 w-full rounded-lg border border-border bg-card px-2.5 text-xs outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 pt-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-text-muted">
                প্যাকেজিং ও বক্সের খরচ (৳)
              </label>
              <input
                type="number"
                value={packagingCost}
                onChange={(e) => setPackagingCost(Number(e.target.value))}
                className="h-9 w-full rounded-lg border border-border bg-card px-2.5 text-xs outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-muted">
                কুরিয়ার COD কালেকশন ফি (%)
              </label>
              <input
                type="number"
                value={codPercent}
                onChange={(e) => setCodPercent(Number(e.target.value))}
                className="h-9 w-full rounded-lg border border-border bg-card px-2.5 text-xs outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-muted">
                প্রত্যাশিত রিটার্ন রেট (%)
              </label>
              <input
                type="number"
                value={returnRate}
                onChange={(e) => setReturnRate(Number(e.target.value))}
                className="h-9 w-full rounded-lg border border-border bg-card px-2.5 text-xs outline-none"
              />
            </div>
          </div>
        </Card>

        {/* Real Profit Result Card (1 col) */}
        <Card className="p-5 bg-surface-2 flex flex-col justify-between border-brand-200">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <span className="text-xs font-semibold uppercase text-text-muted">প্রফিট বিশ্লেষণ</span>
              <Badge tone={netProfitMarginPercent >= 25 ? "success" : netProfitMarginPercent >= 15 ? "warning" : "danger"}>
                {netProfitMarginPercent}% মার্জিন
              </Badge>
            </div>

            {/* Profit Figures */}
            <div className="mt-4 space-y-3">
              <div className="rounded-xl bg-card p-3 border border-border">
                <span className="block text-xs text-text-muted">সফল ডেলিভারিতে খাঁটি লাভ (Net Profit)</span>
                <span className="text-2xl font-black text-brand-600">
                  ৳ {netProfitOnDelivery.toLocaleString("en-BD")}
                </span>
              </div>

              <div className="rounded-xl bg-card p-3 border border-border space-y-1.5 text-xs">
                <div className="flex justify-between text-text-muted">
                  <span>কুরিয়ার COD ফি (১%):</span>
                  <span className="font-medium text-text-main">৳ {codFee}</span>
                </div>
                <div className="flex justify-between text-text-muted">
                  <span>ডেলিভারি খরচ ব্যবধান:</span>
                  <span className="font-medium text-text-main">৳ {netShippingExpense}</span>
                </div>
                <div className="flex justify-between text-text-muted">
                  <span>রিটার্ন লস বাবদ রিজার্ভ:</span>
                  <span className="font-medium text-rose-600">- ৳ {returnRiskCushion}</span>
                </div>
              </div>

              {/* Realistic Adjusted Profit */}
              <div className="rounded-xl bg-emerald-50/70 p-3 border border-emerald-200">
                <span className="block text-[11px] text-emerald-900 font-medium">
                  {returnRate}% রিটার্ন বিবেচনা করে গড় বাস্তব লাভ:
                </span>
                <span className="text-lg font-bold text-emerald-800">
                  ৳ {expectedRealisticProfit.toLocaleString("en-BD")} / অর্ডার
                </span>
              </div>
            </div>
          </div>

          <div className="pt-3 text-[11px] text-text-subtle text-center">
            ব্রেক-ইভেন সর্বনিম্ন বিক্রয়মূল্য: <span className="font-bold text-text-main">৳ {totalDirectExpenses}</span>
          </div>
        </Card>
      </div>
    </div>
  );
}
