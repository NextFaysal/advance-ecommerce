/**
 * Board-local formatting helper. The CD0 design-system contract
 * (SOURCE_VISUAL, SourceChip, SlaChip, TaskCard, slaStateForTask)
 * is consumed directly from src/callcenter/components — CD0 does
 * not provide an age phrasing, so this one stays here.
 */
import { interpolate, pick, type Locale } from "@/i18n/locale";
import { CALL_CENTER_STRINGS } from "../strings";

/** Age of a task in minutes, phrased in the active locale. */
export function ageLabel(ageMinutes: number, locale: Locale): string {
  const s = pick(locale, CALL_CENTER_STRINGS);
  if (ageMinutes <= 0) return s.ageNow;
  if (ageMinutes < 60) return interpolate(s.ageMinutes, { n: ageMinutes });
  const h = Math.floor(ageMinutes / 60);
  const m = ageMinutes % 60;
  return m > 0
    ? interpolate(s.ageHoursMinutes, { h, m })
    : interpolate(s.ageHours, { h });
}
