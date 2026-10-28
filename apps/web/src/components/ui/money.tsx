/* Money is always integer poisha. No float arithmetic here: integer division + padded remainder. */
import { toBengaliDigits } from "@/lib/numerals";

export function formatPoisha(poisha: number): string {
  const negative = poisha < 0;
  const abs = Math.abs(poisha);
  const taka = Math.trunc(abs / 100);
  const remainder = abs % 100;
  const grouped = taka.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}৳${grouped}.${remainder.toString().padStart(2, "0")}`;
}

export function Money({
  poisha,
  className = "",
  bengaliDigits = false,
}: {
  poisha: number;
  className?: string;
  /**
   * Display-only opt-in: render the formatted amount with Bengali
   * digits (০১২৩…). Client parents that track the visitor's numerals
   * preference (see useBengaliNumerals in components/ui/numerals.tsx)
   * pass it; formatPoisha's own output never changes, so admin and
   * print surfaces keep Latin digits unless they opt in the same way.
   */
  bengaliDigits?: boolean;
}) {
  const text = formatPoisha(poisha);
  return (
    <span className={`tnum font-mono ${className}`}>
      {bengaliDigits ? toBengaliDigits(text) : text}
    </span>
  );
}
