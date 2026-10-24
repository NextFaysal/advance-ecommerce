/* Phone masking by default. Full number only with customers.view_full_phone permission (Step 4, server-side). */
export function maskPhone(normalized: string): string {
  if (normalized.length < 5) return normalized;
  return `${normalized.slice(0, 5)}******${normalized.slice(-2)}`;
}

export function Phone({ phone, reveal = false }: { phone: string; reveal?: boolean }) {
  const shown = reveal ? phone : maskPhone(phone);
  return <span className="font-mono tabular-nums">{shown}</span>;
}
