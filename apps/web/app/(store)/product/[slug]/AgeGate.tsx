"use client";

/**
 * PDP age gate — ADV-29 (doc 22).
 *
 * When the product's category is age-restricted (Settings
 * catalog.age_restricted_categories, resolved SERVER-side on the
 * PDP and passed in as `minAge`), the buy box is replaced by an
 * age-confirmation interstitial until the customer confirms. The
 * confirmation is remembered per product in sessionStorage (this
 * browser session only) — it is a convenience, NOT the control:
 * the binding gate is at checkout, where the server re-derives
 * the requirement from DB category slugs and refuses the order
 * without a fresh attestation recorded on the order note.
 *
 * The copy is explicit that this is a self-declaration
 * (স্ব-ঘোষণা), not identity or age verification — no document is
 * collected anywhere in this flow.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "@/components/ui/icon";

interface AgeGateProps {
  productId: string;
  /** null = the category is not restricted: children render as-is. */
  minAge: number | null;
  children: ReactNode;
}

export function AgeGate({ productId, minAge, children }: AgeGateProps) {
  const storageKey = `age-gate:${productId}`;
  const [unlocked, setUnlocked] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (minAge === null) return;
    try {
      if (window.sessionStorage.getItem(storageKey) === "confirmed") setUnlocked(true);
    } catch {
      // Storage unavailable (private mode): the gate simply asks
      // again on every visit — never fails open silently at PDP.
    }
  }, [storageKey, minAge]);

  if (minAge === null || unlocked) return <>{children}</>;

  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-400/30 dark:bg-amber-500/10">
      <p className="flex items-center gap-2 text-sm font-bold text-text-main">
        <Icon name="alert" size={16} />
        বয়স-সীমাবদ্ধ পণ্য / Age-restricted product
      </p>
      <p className="mt-2 text-sm leading-6 text-text-muted">
        এই পণ্যটি কিনতে আপনার বয়স কমপক্ষে {minAge} বছর হতে হবে। আপনি নিশ্চিত করছেন আপনার বয়স {minAge}+
        — এটি একটি স্ব-ঘোষণা (attestation); আমরা কোনো পরিচয়পত্র বা জন্মতারিখ যাচাই করি না। চেকআউটের
        সময়ও এই নিশ্চিতকরণটি অর্ডারে রেকর্ড হবে।
      </p>
      <label className="mt-3 flex items-start gap-2.5 text-sm leading-6 text-text-main">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 shrink-0"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
        />
        <span>আপনি নিশ্চিত করছেন আপনার বয়স {minAge}+ / I confirm I am at least {minAge} years old.</span>
      </label>
      <button
        type="button"
        disabled={!checked}
        onClick={() => {
          try {
            window.sessionStorage.setItem(storageKey, "confirmed");
          } catch {
            // See above — dismissal is best-effort only.
          }
          setUnlocked(true);
        }}
        className="brand-gradient mt-3 inline-flex h-11 items-center rounded-xl px-5 text-sm font-semibold text-white shadow-md transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        নিশ্চিত করে এগিয়ে যান / Confirm & continue
      </button>
    </div>
  );
}
