import type { ReactNode } from "react";
import { Icon, type IconName } from "./icon";

/**
 * Toast (Design System v4, doc 31 D3) — SVG status icon in a solid
 * medallion on the semantic soft surface, fade-slide-in entry, lift
 * shadow. Tones ride the v4 solid/soft token pairs (dark-safe).
 * API unchanged from v1.
 */
export function Toast({ tone = "success", children }: { tone?: "success" | "error" | "info"; children: ReactNode }) {
  const tones: Record<string, string> = {
    success: "border-success-solid/30 bg-success-soft",
    error: "border-danger/30 bg-danger-soft",
    info: "border-info-solid/30 bg-info-soft",
  };
  const medallions: Record<string, string> = {
    success: "bg-success-solid text-white",
    error: "bg-danger text-white",
    info: "bg-info-solid text-white",
  };
  const icons: Record<string, IconName> = { success: "check", error: "alert", info: "info" };
  return (
    <div role="status" aria-live="polite" className={`animate-fade-slide-in flex items-center gap-2.5 rounded-2xl border px-3.5 py-3 text-sm font-medium text-text-main shadow-lift ${tones[tone]}`}>
      <span aria-hidden="true" className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full shadow-xs ${medallions[tone]}`}>
        <Icon name={icons[tone]} size={15} />
      </span>
      <span>{children}</span>
    </div>
  );
}
