"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/i18n/LocaleProvider";
import { intlLocale, pick } from "@/i18n/locale";
import { ADMIN_STRINGS } from "@/admin/strings";

interface ErpPeriodItem {
  id?: string;
  code: string;
  lockedAt: string | null;
}

interface Props {
  initialPeriods: ErpPeriodItem[];
}

export function ErpPeriodManager({ initialPeriods }: Props) {
  const { locale } = useLocale();
  const s = pick(locale, ADMIN_STRINGS);
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
        setError(json.error?.message || s.erpUpdateFailed);
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
      setError(s.erpNetworkError);
    } finally {
      setLoading(false);
    }
  }

  function handleCreatePeriod(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{4}-\d{2}$/.test(newPeriod)) {
      setError(s.erpFormatError);
      return;
    }
    toggleLock(newPeriod, true);
    setNewPeriod("");
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div>
          <h3 className="text-base font-bold text-text-main">{s.erpTitle}</h3>
          <p className="text-xs text-text-muted">
            {s.erpDesc}
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
            {s.erpAddLock}
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
                  {isLocked ? s.erpLocked : s.erpOpen}
                </span>
                {isLocked && p.lockedAt && (
                  <span className="text-[11px] text-text-muted">
                    {s.erpLockedAt}: {new Date(p.lockedAt).toLocaleDateString(intlLocale(locale))}
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
                {isLocked ? s.erpUnlock : s.erpLock}
              </button>
            </div>
          );
        })}

        {periods.length === 0 && (
          <p className="py-4 text-center text-xs text-text-muted">
            {s.erpEmpty}
          </p>
        )}
      </div>
    </div>
  );
}
