"use client";

// EMI note for the checkout summary rail (ADV-18B). DISPLAY ONLY:
// the breakdown comes precomputed from the server
// (GET /api/v1/public/marketing/emi-config?total=) — no pricing
// math runs here and the charged total never changes. Renders
// nothing when EMI is off or the subtotal is below the minimum.
import { useEffect, useState } from "react";
import { formatPoisha } from "@/components/ui/money";

interface EmiBreakdownWire {
  months: number;
  surchargePoisha: number;
  totalWithSurchargePoisha: number;
  perMonthPoisha: number;
}

export function EmiCheckoutNote({ subtotalPoisha }: { subtotalPoisha: number }) {
  const [state, setState] = useState<{ label: string; breakdowns: EmiBreakdownWire[] } | null>(null);

  useEffect(() => {
    if (subtotalPoisha <= 0) return;
    let cancelled = false;
    void fetch(`/api/v1/public/marketing/emi-config?total=${subtotalPoisha}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json: unknown) => {
        if (cancelled || json === null) return;
        const data = (json as { data?: { config?: { labelBn?: string }; breakdowns?: EmiBreakdownWire[] } }).data;
        if (data?.breakdowns !== undefined && data.breakdowns.length > 0) {
          setState({ label: data.config?.labelBn ?? "", breakdowns: data.breakdowns });
        }
      })
      .catch(() => {
        // display-only garnish — failure just hides the note
      });
    return () => {
      cancelled = true;
    };
  }, [subtotalPoisha]);

  if (state === null) return null;
  return (
    <div className="mt-3 rounded-xl bg-surface-2 p-3 text-xs text-text-muted ring-1 ring-border">
      <p className="font-bold text-text-main">{state.label}</p>
      <ul className="mt-1 space-y-0.5">
        {state.breakdowns.map((b) => (
          <li key={b.months}>
            {b.months} মাসে মাসে {formatPoisha(b.perMonthPoisha)} (মোট {formatPoisha(b.totalWithSurchargePoisha)})
          </li>
        ))}
      </ul>
      <p className="mt-1 text-text-subtle">চেকআউটে পুরো টাকাই আপনার পছন্দের পেমেন্ট মাধ্যমে নেওয়া হবে — EMI ব্যাংক কার্ডে প্রযোজ্য।</p>
    </div>
  );
}
