"use client";

// Coupon create form — Agent 25 (marketing page).
// Posts to the EXISTING coupons API (Agent 10): POST /api/v1/admin/coupons,
// which validates with the marketing coupon schema and stores in the
// in-memory demo store. The result message is whatever the API returns —
// this form never claims success on its own (the API currently answers
// 503 DB_NOT_READY for admin routes until Prisma generate succeeds, and
// that error is shown as-is).
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type CouponTypeChoice = "percent" | "fixed" | "free_shipping" | "first_order";

export default function CouponForm() {
  const [code, setCode] = useState("");
  const [type, setType] = useState<CouponTypeChoice>("percent");
  const [value, setValue] = useState("10");
  const [minCart, setMinCart] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setStatus(null);
    const numeric = Number.parseInt(value, 10);
    const body = {
      code: code.trim(),
      type,
      valuePercent: type === "percent" && Number.isFinite(numeric) ? numeric : null,
      valuePoisha: type !== "percent" && Number.isFinite(numeric) ? numeric * 100 : null,
      minCartPoisha: minCart === "" ? null : Number.parseInt(minCart, 10) * 100,
      maxDiscountPoisha: null,
      usageLimit: null,
      perUserLimit: null,
      startsAt: null,
      endsAt: null,
      stackable: false,
      isActive: true,
    };
    try {
      const res = await fetch("/api/v1/admin/coupons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        data?: { coupon?: { code?: string } };
        error?: { message?: string };
      };
      setStatus(
        res.ok
          ? `তৈরি হয়েছে: ${data.data?.coupon?.code ?? body.code} (ডেমো স্টোরে সংরক্ষিত)`
          : (data.error?.message ?? `ব্যর্থ হয়েছে (${res.status}) — কিছুই সংরক্ষিত হয়নি।`),
      );
    } catch {
      setStatus("নেটওয়ার্ক ত্রুটি — কিছুই সংরক্ষিত হয়নি।");
    } finally {
      setSending(false);
    }
  }

  return (
    <Card>
      <h3 className="mb-1 font-semibold">নতুন কুপন তৈরি (রূপরেখা)</h3>
      <p className="mb-4 text-xs text-text-muted">
        ফর্মটি বিদ্যমান Coupons API-তে পাঠায়; API-র উত্তরই এখানে দেখানো হয় — নিজে থেকে সফল বলা হয় না।
      </p>
      <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          কুপন কোড
          <input
            className="mt-1 w-full rounded-[10px] border border-border bg-card px-3 py-2"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="যেমন: NEWYEAR15"
            required
          />
        </label>
        <label className="text-sm">
          ধরন
          <select
            className="mt-1 w-full rounded-[10px] border border-border bg-card px-3 py-2"
            value={type}
            onChange={(e) => setType(e.target.value as CouponTypeChoice)}
          >
            <option value="percent">শতাংশ ছাড়</option>
            <option value="fixed">নির্দিষ্ট টাকা ছাড়</option>
            <option value="free_shipping">ফ্রি শিপিং</option>
            <option value="first_order">প্রথম অর্ডারে ছাড়</option>
          </select>
        </label>
        <label className="text-sm">
          {type === "percent" ? "ছাড় (%)" : "ছাড়ের পরিমাণ (টাকা)"}
          <input
            className="mt-1 w-full rounded-[10px] border border-border bg-card px-3 py-2"
            type="number"
            min={0}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        <label className="text-sm">
          ন্যূনতম কার্ট (টাকা, ঐচ্ছিক)
          <input
            className="mt-1 w-full rounded-[10px] border border-border bg-card px-3 py-2"
            type="number"
            min={0}
            value={minCart}
            onChange={(e) => setMinCart(e.target.value)}
            placeholder="শর্ত নেই"
          />
        </label>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={sending}>
            {sending ? "পাঠানো হচ্ছে…" : "কুপন তৈরি করুন"}
          </Button>
          {status ? (
            <p role="status" className="mt-2 text-sm text-text-muted">
              {status}
            </p>
          ) : null}
        </div>
      </form>
    </Card>
  );
}
