/* Money is always integer poisha. No float arithmetic here: integer division + padded remainder. */
export function formatPoisha(poisha: number): string {
  const negative = poisha < 0;
  const abs = Math.abs(poisha);
  const taka = Math.trunc(abs / 100);
  const remainder = abs % 100;
  const grouped = taka.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}৳${grouped}.${remainder.toString().padStart(2, "0")}`;
}

export function Money({ poisha, className = "" }: { poisha: number; className?: string }) {
  return <span className={`font-mono tabular-nums ${className}`}>{formatPoisha(poisha)}</span>;
}
