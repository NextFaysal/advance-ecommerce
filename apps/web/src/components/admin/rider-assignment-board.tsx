"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatBdt } from "@advance-ecommerce/validators";

export interface RiderDeliveryView {
  id: string;
  orderId: string;
  riderId: string;
  riderName: string;
  zoneName: string;
  status: string;
  codAmountPoisha: number;
  proofKind: string;
}

export interface RiderOption {
  id: string;
  name: string;
  status: string;
}

interface Props {
  initialDeliveries: RiderDeliveryView[];
  riders: RiderOption[];
}

export function RiderAssignmentBoard({ initialDeliveries, riders }: Props) {
  const router = useRouter();
  const [deliveries, setDeliveries] = useState<RiderDeliveryView[]>(initialDeliveries);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleReassign(deliveryId: string, newRiderId: string) {
    if (!newRiderId) return;
    setLoadingId(deliveryId);
    setError(null);
    try {
      const res = await fetch(`/api/v1/admin/riders/deliveries/${deliveryId}/reassign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newRiderId }),
      });
      const json = await res.json() as { error?: { message: string } };

      if (!res.ok) {
        setError(json.error?.message || "রি-অ্যাসাইন করা যায়নি।");
        return;
      }

      const newRider = riders.find((r) => r.id === newRiderId);
      setDeliveries((prev) =>
        prev.map((d) => (d.id === deliveryId ? { ...d, riderId: newRiderId, riderName: newRider?.name || newRiderId } : d))
      );
      router.refresh();
    } catch {
      setError("নেটওয়ার্ক ত্রুটি। আবার চেষ্টা করুন।");
    } finally {
      setLoadingId(null);
    }
  }

  const activeRiders = riders.filter((r) => r.status === "ACTIVE" || r.status === "ON_DELIVERY");

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between border-b border-border pb-3">
        <div>
          <h3 className="text-base font-bold text-text-main">লাইভ রাইডার অ্যাসাইনমেন্ট বোর্ড</h3>
          <p className="text-xs text-text-muted">
            পার্সেল রি-অ্যাসাইনমেন্ট এবং ইন-ফ্লাইট ডেলিভারির রিয়েল-টাইম নিয়ন্ত্রণ।
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-border text-text-muted">
            <tr>
              <th className="pb-3 font-semibold">অর্ডার আইডি</th>
              <th className="pb-3 font-semibold">বর্তমান রাইডার</th>
              <th className="pb-3 font-semibold">জোন</th>
              <th className="pb-3 font-semibold">স্ট্যাটাস</th>
              <th className="pb-3 font-semibold">COD আদায়</th>
              <th className="pb-3 font-semibold">রাইডার পরিবর্তন (Reassign)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {deliveries.map((d) => {
              const canReassign = d.status === "ASSIGNED" || d.status === "PICKED_UP";
              return (
                <tr key={d.id} className="hover:bg-muted/30">
                  <td className="py-3 font-mono font-bold text-text-main">{d.orderId}</td>
                  <td className="py-3 font-semibold text-text-main">{d.riderName}</td>
                  <td className="py-3 text-text-muted">{d.zoneName}</td>
                  <td className="py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        d.status === "DELIVERED"
                          ? "bg-success/15 text-success"
                          : d.status === "FAILED"
                          ? "bg-destructive/15 text-destructive"
                          : d.status === "PICKED_UP"
                          ? "bg-primary/15 text-primary"
                          : "bg-warning/15 text-warning"
                      }`}
                    >
                      {d.status}
                    </span>
                  </td>
                  <td className="py-3 font-medium text-text-main">{formatBdt(d.codAmountPoisha)}</td>
                  <td className="py-3">
                    {canReassign ? (
                      <div className="flex items-center gap-2">
                        <select
                          disabled={loadingId === d.id}
                          defaultValue=""
                          onChange={(e) => handleReassign(d.id, e.target.value)}
                          className="rounded-lg border border-input bg-background px-2 py-1 text-xs text-text-main shadow-sm focus:border-ring focus:outline-none disabled:opacity-50"
                        >
                          <option value="" disabled>
                            রাইডার সিলেক্ট করুন…
                          </option>
                          {activeRiders.map((r) => (
                            <option key={r.id} value={r.id} disabled={r.id === d.riderId}>
                              {r.name} {r.id === d.riderId ? "(বর্তমান)" : ""}
                            </option>
                          ))}
                        </select>
                        {loadingId === d.id && <span className="text-[10px] text-text-muted">হচ্ছে…</span>}
                      </div>
                    ) : (
                      <span className="text-[11px] text-text-muted">সম্পন্ন</span>
                    )}
                  </td>
                </tr>
              );
            })}

            {deliveries.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-xs text-text-muted">
                  কোনো ডেলিভারি অ্যাসাইনমেন্ট পাওয়া যায়নি।
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
