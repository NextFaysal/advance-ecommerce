// BD phone: 01[3-9]XXXXXXXX, normalized +8801XXXXXXXXX
export const BD_PHONE_REGEX = /^(?:\+?88)?01[3-9]\d{8}$/;

export function normalizeBdPhone(input: string): string | null {
  const cleaned = input.replace(/[\s-]/g, "");
  if (!BD_PHONE_REGEX.test(cleaned)) return null;
  const digits = cleaned.replace(/^\+?88/, "");
  return `+880${digits.slice(-10)}`;
}

export function maskPhone(normalized: string): string {
  // +8801XXXXXXXXX -> +8801******XX (full number dekhte alada permission lagbe)
  if (normalized.length < 5) return normalized;
  return `${normalized.slice(0, 5)}******${normalized.slice(-2)}`;
}
