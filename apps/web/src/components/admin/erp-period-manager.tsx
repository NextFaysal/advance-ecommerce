"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface ErpPeriodItem {
  id?: string;
  code: string;
  lockedAt: string | null;
}

interface Props {
  initialPeriods: ErpPeriodItem[];
}

export function ErpPeriodManager({ initialPeriods }: Props) {
  const router = useRouter();
  const [periods, setPeriods] = useState<ErpPeriodItem[]>(initialPeriods);
  const [newPeriod, setNewPeriod] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggleLock(code: string, currentLocked: boolean) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/admin/modules/erp-period", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          period: code,
          action: currentLocked ? "unlock" : "lock",
        }),
      });
      const json = await res.json() as { data?: { code: string; lockedAt: string | null }; error?: { message: string } };

      if (!res.ok) {
        setError(json.error?.message || "হালনাগাদ করা যায়নি।");
        return;
      }

      setPeriods((prev) => {
        const found = prev.find((p) => p.code === code);
        if (found) {
          return prev.map((p) => (p.code === code ? { ...p, lockedAt: json.data?.lockedAt ?? null } : p));
        }
        return [{ code, lockedAt: json.data?.lockedAt ?? null }, ...prev];
      });

      router.refresh();
    } catch {
      setError("নেটওয়ার্ক ত্রুটি। আবার চেষ্টা করুন।");
    } finally {
      setLoading(false);
    }
  }

  function handleCreatePeriod(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{4}-\d{2}$/.test(newPeriod)) {
      setError("পিরিয়ড ফরম্যাট YYYY-MM হতে হবে (যেমন: 2026-10)।");
      return;
    }
    toggleLock(newPeriod, true);
    setNewPeriod("");
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div>
          <h3 className="text-base font-bold text-text-main">হিসাব পিরিয়ড ও লক ব্যবস্থাপনা</h3>
          <p className="text-xs text-text-muted">
            লক করা মাসে কোনো পূর্ববর্তী ব্যাকডেটেড জার্নাল এন্ট্রি পোস্ট করা নিষিদ্ধ।
          </p>
        </div>

        {/* Add/Lock period form */}
        <form onSubmit={handleCreatePeriod} className="flex items-center gap-2">
          <input
            type="text"
            placeholder="YYYY-MM (e.g. 2026-10)"
            value={newPeriod}
            onChange={(e) => setNewPeriod(e.target.value)}
            className="w-36 rounded-lg border border-input bg-background px-3 py-1.5 text-xs text-text-main shadow-sm focus:border-ring focus:outline-none"
          />
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm hover:opacity-90 disabled:opacity-50"
          >
            + পিরিয়ড লক
          </button>
        </form>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="divide-y divide-border/60">
        {periods.map((p) => {
          const isLocked = Boolean(p.lockedAt);
          return (
            <div key={p.code} className="flex items-center justify-between py-3">
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm font-bold text-text-main">{p.code}</span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                    isLocked ? "bg-destructive/15 text-destructive" : "bg-success/15 text-success"
                  }`}
                >
                  {isLocked ? "🔒 লকড (বন্ধ)" : "🔓 ওপেন (খোলা)"}
                </span>
                {isLocked && p.lockedAt && (
                  <span className="text-[11px] text-text-muted">
                    লক হয়েছে: {new Date(p.lockedAt).toLocaleDateString("bn-BD")}
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={() => toggleLock(p.code, isLocked)}
                disabled={loading}
                className={`rounded-lg px-3 py-1 text-xs font-semibold shadow-sm transition hover:opacity-90 disabled:opacity-50 ${
                  isLocked
                    ? "border border-border bg-card text-text-main hover:bg-muted"
                    : "border border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20"
                }`}
              >
                {isLocked ? "আনলক করুন" : "লক করুন"}
              </button>
            </div>
          );
        })}

        {periods.length === 0 && (
          <p className="py-4 text-center text-xs text-text-muted">
            কোনো সংরক্ষিত হিসাব পিরিয়ড নেই। উপরের ফর্ম দিয়ে বর্তমান মাস যুক্ত ও লক করতে পারেন।
          </p>
        )}
      </div>
    </div>
  );
}
