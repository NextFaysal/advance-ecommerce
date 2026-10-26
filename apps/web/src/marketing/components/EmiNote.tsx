// EMI breakdown — PDP server component (ADV-18B). DISPLAY ONLY:
// bank-card instalment terms computed from Settings payments.emi.*;
// no amount anywhere changes because of this card. Renders nothing
// when the module flag is off, EMI is disabled, or the price is
// below the configured minimum.
import { marketingMechanicsEnabled } from "@/marketing/docs";
import { loadEmiConfig, computeEmiBreakdown, EMI_LABEL_BN } from "@/marketing/emi";
import { formatPoisha } from "@/components/ui/money";
import { DigitText } from "@/components/ui/numerals";

export async function EmiNote({ totalPoisha }: { totalPoisha: number }) {
  if (!marketingMechanicsEnabled()) return null;
  const config = await loadEmiConfig().catch(() => null);
  if (config === null) return null;
  const breakdowns = computeEmiBreakdown(totalPoisha, config);
  if (breakdowns.length === 0) return null;
  return (
    <div className="mt-4 rounded-2xl bg-surface-2 p-4 ring-1 ring-border">
      <p className="text-sm font-bold text-text-main">{EMI_LABEL_BN}</p>
      <ul className="mt-2 space-y-1 text-sm text-text-muted">
        {breakdowns.map((b) => (
          <li key={b.months}>
            <DigitText text={`${b.months}`} /> মাসের কিস্তি: মাসে{" "}
            <span className="font-mono font-bold text-text-main">
              <DigitText text={formatPoisha(b.perMonthPoisha)} />
            </span>{" "}
            (মোট <DigitText text={formatPoisha(b.totalWithSurchargePoisha)} />
            {b.surchargePoisha > 0 ? (
              <>
                , সারচার্জ <DigitText text={formatPoisha(b.surchargePoisha)} />
              </>
            ) : null}
            )
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-text-subtle">ভ্যারিয়েন্ট অনুযায়ী মূল্য বদলালে কিস্তির পরিমাণও বদলাবে।</p>
    </div>
  );
}
