"use client";

// Coupon manager — real DB-backed admin UI (2026-10-25).
// The list arrives from the server page (listCouponsDb) and toggles go
// through PATCH /api/v1/admin/coupons/[id]; the API's answer is shown
// as-is — this component never claims success on its own. When the
// server page could not read the database it passes dbReady=false and
// an honest unavailable state renders instead of any rows.
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { Money, formatPoisha } from "@/components/ui/money";
import type { CouponRecord } from "@/marketing/service";

const TYPE_LABELS: Record<CouponRecord["type"], string> = {
  percent: "শতাংশ",
  fixed: "নির্দিষ্ট টাকা",
  free_shipping: "ফ্রি শিপিং",
  first_order: "প্রথম অর্ডার",
};

function couponDiscountLabel(c: CouponRecord): string {
  if (c.type === "percent") {
    const cap = c.maxDiscountPoisha !== null ? ` (সর্বোচ্চ ${formatPoisha(c.maxDiscountPoisha)})` : "";
    return `${c.valuePercent ?? 0}%${cap}`;
  }
  if (c.type === "fixed") return formatPoisha(c.valuePoisha ?? 0);
  if (c.type === "free_shipping") return "ডেলিভারি ফ্রি";
  return "প্রথম অর্ডারে বিশেষ ছাড়";
}

export default function CouponManager({
  initialCoupons,
  dbReady,
}: {
  initialCoupons: CouponRecord[];
  dbReady: boolean;
}) {
  const [coupons, setCoupons] = useState<CouponRecord[]>(initialCoupons);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The server page re-reads the DB after a router.refresh() (e.g. the
  // create form below succeeded) — adopt the fresh list when it changes.
  useEffect(() => {
    setCoupons(initialCoupons);
  }, [initialCoupons]);

  async function toggle(coupon: CouponRecord) {
    setBusyId(coupon.id);
    setError(null);
    try {
      const res = await fetch(`/api/v1/admin/coupons/${coupon.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !coupon.isActive }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        data?: { coupon?: CouponRecord };
        error?: { message?: string };
      };
      if (!res.ok || !data.data?.coupon) {
        setError(data.error?.message ?? `ব্যর্থ হয়েছে (${res.status}) — অবস্থা বদলায়নি।`);
        return;
      }
      const updated = data.data.coupon;
      setCoupons((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    } catch {
      setError("নেটওয়ার্ক ত্রুটি — অবস্থা বদলায়নি।");
    } finally {
      setBusyId(null);
    }
  }

  if (!dbReady) {
    return (
      <Card>
        <h3 className="font-semibold">কুপন তালিকা পাওয়া যাচ্ছে না</h3>
        <p className="mt-1 text-sm text-text-muted">
          ডাটাবেস থেকে কুপন পড়া যায়নি — কোনো নমুনা সারি দেখানো হচ্ছে না। ডাটাবেস চালু হলে
          আসল কুপনগুলো এখানে আসবে।
        </p>
      </Card>
    );
  }

  const rows = coupons.map((c) => ({
    code: <span className="font-mono font-semibold">{c.code}</span>,
    type: TYPE_LABELS[c.type] ?? c.type,
    discount: couponDiscountLabel(c),
    minCart: c.minCartPoisha !== null ? <Money poisha={c.minCartPoisha} /> : "শর্ত নেই",
    used: c.usageLimit !== null ? `${c.usedCount} / ${c.usageLimit}` : `${c.usedCount}`,
    status: c.isActive ? (
      <Badge tone="success">সক্রিয়</Badge>
    ) : (
      <Badge tone="neutral">বন্ধ</Badge>
    ),
    action: (
      <Button
        type="button"
        variant={c.isActive ? "secondary" : "primary"}
        disabled={busyId === c.id}
        onClick={() => toggle(c)}
      >
        {busyId === c.id ? "হচ্ছে…" : c.isActive ? "বন্ধ করুন" : "চালু করুন"}
      </Button>
    ),
  }));

  return (
    <div>
      <DataTable
        caption="কুপন তালিকা — আসল ডাটাবেস থেকে (Coupon টেবিল); ব্যবহারের সংখ্যা CouponUsage থেকে গণনা করা"
        columns={[
          { key: "code", header: "কোড" },
          { key: "type", header: "ধরন" },
          { key: "discount", header: "ছাড়" },
          { key: "minCart", header: "ন্যূনতম কার্ট" },
          { key: "used", header: "ব্যবহৃত / সীমা" },
          { key: "status", header: "অবস্থা" },
          { key: "action", header: "অ্যাকশন" },
        ]}
        rows={rows}
      />
      {coupons.length === 0 ? (
        <p className="mt-3 text-sm text-text-muted">
          এখনো কোনো কুপন তৈরি হয়নি — নিচের ফর্ম থেকে প্রথম কুপনটি তৈরি করুন।
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
