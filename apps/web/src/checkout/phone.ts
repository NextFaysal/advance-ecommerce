// BD phone helpers — pure, schema-free (perf wave, zod diet).
//
// BD_PHONE_REGEX / normalizeBdPhone / maskPhone used to live in
// ./validation next to the checkout zod schemas. The checkout page's
// OTP panel (a client component) imports maskPhone, which dragged
// the zod runtime (and, through ./validation, the pod/rental/
// restaurant/services selection schemas) into the browser bundle.
// The helpers now live here; ./validation re-exports them so every
// existing server import keeps working unchanged.
//
// Mirrors packages/validators/src/phone.ts (BD_PHONE_REGEX) so this
// module is self-contained; the validators package remains the
// canonical source.

export const BD_PHONE_REGEX = /^(?:\+?88)?01[3-9]\d{8}$/;

/** Normalize any accepted BD form to +8801XXXXXXXXX. Returns null if invalid. */
export function normalizeBdPhone(input: string): string | null {
  const cleaned = input.replace(/[\s-]/g, "");
  if (!BD_PHONE_REGEX.test(cleaned)) return null;
  const digits = cleaned.replace(/^\+?88/, "");
  return `+880${digits.slice(-10)}`;
}

export function maskPhone(normalized: string): string {
  if (normalized.length < 5) return normalized;
  return `${normalized.slice(0, 5)}******${normalized.slice(-2)}`;
}
