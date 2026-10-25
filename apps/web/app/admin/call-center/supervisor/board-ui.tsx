/**
 * Board-local formatting helper. The CD0 design-system contract
 * (SOURCE_VISUAL, SourceChip, SlaChip, TaskCard, slaStateForTask)
 * is consumed directly from src/callcenter/components — CD0 does
 * not provide an age phrasing, so this one stays here.
 */

/** Age of a task in minutes, Bn phrasing (the payload's ageMinutes). */
export function ageLabel(ageMinutes: number): string {
  if (ageMinutes <= 0) return "এখনই";
  if (ageMinutes < 60) return `${ageMinutes} মিনিট`;
  const h = Math.floor(ageMinutes / 60);
  const m = ageMinutes % 60;
  return m > 0 ? `${h} ঘণ্টা ${m} মিনিট` : `${h} ঘণ্টা`;
}
