// Money: integer poisha, kokhono float na.
export function toPoisha(taka: number): number {
  return Math.round(taka * 100);
}

export function fromPoisha(poisha: number): number {
  return poisha / 100;
}

export function formatBdt(poisha: number): string {
  return `৳${(poisha / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
