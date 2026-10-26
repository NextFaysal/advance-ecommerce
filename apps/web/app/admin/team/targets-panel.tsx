"use client";

/**
 * Staff targets panel (ADV-27 remainder) — month targets per staff
 * member + REAL progress bars.
 *
 * ATTRIBUTION RULE (from src/team/targets.ts, also returned in the
 * API meta and printed under the table): "handled" = distinct orders
 * the staff member transitioned INTO CONFIRMED that month
 * (OrderStatusHistory.changedById); revenue progress = Σ totals of
 * orders they transitioned INTO DELIVERED. A transition with no
 * recorded actor counts for nobody — progress is never guessed.
 *
 * Editing: managers (staff.manage) set orders target + revenue
 * target (entered in taka, stored as poisha); saving sends the FULL
 * month list (replace-all semantics, stated in the UI copy). Staff
 * without a row in the form are saved with no target (clearing).
 */
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatPoisha } from "@/components/ui/money";

interface StaffMember {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface Progress {
  handledOrders: number;
  deliveredOrders: number;
  deliveredRevenuePoisha: number;
}

interface TargetRow extends Progress {
  userId: string;
  ordersTarget?: number;
  revenueTargetPoisha?: number;
}

interface TargetsData {
  month: string;
  staff: StaffMember[];
  targets: TargetRow[];
}

function currentMonth(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit" }).format(new Date());
}

function Bar({ actual, target, format }: { actual: number; target?: number; format: (n: number) => string }) {
  if (target === undefined || target <= 0) {
    return <span className="text-caption text-text-subtle">টার্গেট নেই · প্রকৃত: {format(actual)}</span>;
  }
  const pct = Math.min(100, Math.round((actual / target) * 100));
  return (
    <div className="min-w-40">
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-caption tabular-nums">
        {format(actual)} / {format(target)} ({pct}%)
      </p>
    </div>
  );
}

export function TargetsPanel() {
  const [month, setMonth] = useState(currentMonth());
  const [data, setData] = useState<TargetsData | null>(null);
  const [attribution, setAttribution] = useState("");
  const [error, setError] = useState("");
  const [saveNote, setSaveNote] = useState("");
  const [busy, setBusy] = useState(false);
  // form state keyed by userId: raw strings as typed
  const [ordersInputs, setOrdersInputs] = useState<Record<string, string>>({});
  const [revenueInputs, setRevenueInputs] = useState<Record<string, string>>({});

  const load = useCallback(async (m: string) => {
    try {
      const res = await fetch(`/api/v1/admin/team/targets?month=${m}`, { cache: "no-store" });
      const json = (await res.json()) as {
        data?: TargetsData;
        meta?: { attribution?: string };
        error?: { message: string };
      };
      if (!res.ok || !json.data) {
        setError(json.error?.message ?? "টার্গেটের তথ্য আনা যায়নি।");
        return;
      }
      setData(json.data);
      setAttribution(json.meta?.attribution ?? "");
      setError("");
      const orders: Record<string, string> = {};
      const revenue: Record<string, string> = {};
      for (const t of json.data.targets) {
        if (t.ordersTarget !== undefined) orders[t.userId] = String(t.ordersTarget);
        if (t.revenueTargetPoisha !== undefined) revenue[t.userId] = String(Math.round(t.revenueTargetPoisha / 100));
      }
      setOrdersInputs(orders);
      setRevenueInputs(revenue);
    } catch {
      setError("নেটওয়ার্ক ত্রুটি।");
    }
  }, []);

  useEffect(() => {
    void load(month);
  }, [load, month]);

  const progressByUser = new Map((data?.targets ?? []).map((t) => [t.userId, t]));

  const save = async () => {
    if (!data) return;
    setBusy(true);
    setSaveNote("");
    try {
      const targets = data.staff
        .map((member) => {
          const ordersRaw = (ordersInputs[member.id] ?? "").trim();
          const revenueRaw = (revenueInputs[member.id] ?? "").trim();
          const entry: { userId: string; ordersTarget?: number; revenueTargetPoisha?: number } = { userId: member.id };
          if (ordersRaw !== "") entry.ordersTarget = Math.max(0, Math.floor(Number(ordersRaw) || 0));
          if (revenueRaw !== "") entry.revenueTargetPoisha = Math.max(0, Math.round((Number(revenueRaw) || 0) * 100));
          return entry;
        })
        .filter((e) => e.ordersTarget !== undefined || e.revenueTargetPoisha !== undefined);
      const res = await fetch("/api/v1/admin/team/targets", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ month, targets }),
      });
      const json = (await res.json()) as { error?: { message: string } };
      if (!res.ok) {
        setSaveNote(json.error?.message ?? "সংরক্ষণ হয়নি।");
        return;
      }
      setSaveNote("টার্গেট সংরক্ষিত হয়েছে।");
      void load(month);
    } catch {
      setSaveNote("নেটওয়ার্ক ত্রুটি।");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mt-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-h3">মাসিক টার্গেট ও অগ্রগতি</h2>
        <label className="flex items-center gap-2 text-small">
          মাস
          <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-44" />
        </label>
      </div>
      {error !== "" && <p className="text-small font-medium text-rose-600">{error}</p>}
      {data !== null && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-small">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-2 py-2 font-semibold">স্টাফ</th>
                  <th className="px-2 py-2 font-semibold">অর্ডার টার্গেট</th>
                  <th className="px-2 py-2 font-semibold">অগ্রগতি (কনফার্ম করা অর্ডার)</th>
                  <th className="px-2 py-2 font-semibold">রাজস্ব টার্গেট (৳)</th>
                  <th className="px-2 py-2 font-semibold">অগ্রগতি (ডেলিভারি করা রাজস্ব)</th>
                </tr>
              </thead>
              <tbody>
                {data.staff.map((member) => {
                  const progress = progressByUser.get(member.id);
                  const target = data.targets.find((t) => t.userId === member.id);
                  return (
                    <tr key={member.id} className="border-b border-border/60 align-top">
                      <td className="whitespace-nowrap px-2 py-2">
                        <span className="font-medium">{member.name || member.email || "—"}</span>
                        <span className="block text-caption text-text-subtle">{member.role}</span>
                      </td>
                      <td className="px-2 py-2">
                        <Input
                          inputMode="numeric"
                          className="w-24"
                          value={ordersInputs[member.id] ?? ""}
                          onChange={(e) => setOrdersInputs({ ...ordersInputs, [member.id]: e.target.value })}
                          placeholder="—"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <Bar
                          actual={progress?.handledOrders ?? 0}
                          target={target?.ordersTarget}
                          format={(n) => `${n}টি অর্ডার`}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <Input
                          inputMode="numeric"
                          className="w-32"
                          value={revenueInputs[member.id] ?? ""}
                          onChange={(e) => setRevenueInputs({ ...revenueInputs, [member.id]: e.target.value })}
                          placeholder="—"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <Bar
                          actual={progress?.deliveredRevenuePoisha ?? 0}
                          target={target?.revenueTargetPoisha}
                          format={(n) => formatPoisha(n)}
                        />
                        <span className="text-caption text-text-subtle">
                          ডেলিভারি: {progress?.deliveredOrders ?? 0}টি অর্ডার
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button onClick={() => void save()} disabled={busy} className="min-h-[44px]">
              টার্গেট সংরক্ষণ করুন
            </Button>
            {saveNote !== "" && <span className="text-small font-medium">{saveNote}</span>}
            <span className="text-caption text-text-subtle">
              সংরক্ষণে পুরো মাসের তালিকা একসাথে যায় — ফাঁকা রাখা স্টাফের টার্গেট মুছে যাবে।
            </span>
          </div>
          {attribution !== "" && (
            <p className="mt-3 text-caption leading-relaxed text-text-subtle">{attribution}</p>
          )}
        </>
      )}
    </Card>
  );
}
