"use client";

/**
 * Bengali numerals — client display layer.
 *
 * The preference lives in localStorage (src/lib/numerals.ts), so — like
 * ThemeToggle — the first paint and SSR always render Latin digits and
 * the Bengali conversion applies right after mount when the visitor
 * opted in. That is deliberate: nothing here ever changes a stored or
 * transmitted value, only the string a human reads.
 *
 * What converts: formatted money on storefront surfaces (prices via
 * formatBdt / formatPoisha outputs) and pure display percentages.
 * What never converts: form inputs, phone numbers, order numbers,
 * SKUs, quantities in inputs, JSON-LD and anything machine-read — those
 * are simply never passed through these helpers.
 */
import { useCallback, useEffect, useState } from "react";
import { formatBdt } from "@advance-ecommerce/validators";
import {
  NUMERALS_CHANGE_EVENT,
  NUMERALS_STORAGE_KEY,
  getNumeralScript,
  setNumeralScript,
  toBengaliDigits,
} from "@/lib/numerals";

/** True when the visitor opted into Bengali digits (post-mount). */
export function useBengaliNumerals(): boolean {
  const [bn, setBn] = useState(false);

  useEffect(() => {
    const sync = () => setBn(getNumeralScript() === "bn");
    sync();
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === NUMERALS_STORAGE_KEY) sync();
    };
    window.addEventListener(NUMERALS_CHANGE_EVENT, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(NUMERALS_CHANGE_EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return bn;
}

/**
 * Returns a display-string converter honouring the preference:
 * `const digits = useDigitText(); … {digits(formatBdt(price))}`.
 * Identity when the preference is off, so call sites stay one-liners.
 */
export function useDigitText(): (text: string) => string {
  const bn = useBengaliNumerals();
  return useCallback((text: string) => (bn ? toBengaliDigits(text) : text), [bn]);
}

/**
 * A formatted BDT amount (validators formatBdt) that honours the
 * numerals preference. For server-rendered surfaces (the PDP price
 * block) that cannot call hooks themselves — props are plain data
 * (poisha + className), never functions.
 */
export function BdtAmount({
  poisha,
  className = "",
}: {
  poisha: number;
  className?: string;
}) {
  const digits = useDigitText();
  return <span className={className}>{digits(formatBdt(poisha))}</span>;
}

/**
 * Converts the digits in an arbitrary short DISPLAY string (e.g. a
 * discount percentage "25%"). Display text only — never pass user
 * input, phone numbers or order numbers through this.
 */
export function DigitText({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  const digits = useDigitText();
  return <span className={className}>{digits(text)}</span>;
}

/**
 * Header toggle next to ThemeToggle: switches price/display numerals
 * between Latin (123) and Bengali (১২৩). The glyph shows the CURRENT
 * script so the state reads at a glance.
 */
export function NumeralsToggle({ className = "" }: { className?: string }) {
  const bn = useBengaliNumerals();

  const toggle = () => setNumeralScript(bn ? "latn" : "bn");

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={bn ? "ইংরেজি সংখ্যায় দেখান" : "বাংলা সংখ্যায় দেখান"}
      aria-pressed={bn}
      title={bn ? "ইংরেজি সংখ্যা" : "বাংলা সংখ্যা"}
      className={`inline-flex h-11 min-w-[44px] items-center justify-center rounded-full border border-border bg-card px-2 text-sm font-bold tabular-nums text-text-main shadow-sm transition motion-base hover:shadow-lift ${className}`}
    >
      {bn ? "১২৩" : "123"}
    </button>
  );
}
