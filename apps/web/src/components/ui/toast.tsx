import type { ReactNode } from "react";
import { Icon, type IconName } from "./icon";

/**
 * Toast (Design System v2) — SVG status icon in a tinted medallion,
 * pop shadow. API unchanged from v1.
 */
export function Toast({ tone = "success", children }: { tone?: "success" | "error" | "info"; children: ReactNode }) {
  const tones: Record<string, string> = {
    success: "border-emerald-200 bg-emerald-50 text-emerald-800",
    error: "border-rose-200 bg-rose-50 text-rose-800",
    info: "border-sky-200 bg-sky-50 text-sky-800",
  };
  const medallions: Record<string, string> = {
    success: "bg-emerald-100 text-emerald-700",
    error: "bg-rose-100 text-rose-700",
    info: "bg-sky-100 text-sky-700",
  };
  const icons: Record<string, IconName> = { success: "check", error: "alert", info: "info" };
  return (
    <div role="status" aria-live="polite" className={`anim-pop-in flex items-center gap-2.5 rounded-lg border px-3.5 py-3 text-sm font-medium shadow-pop ${tones[tone]}`}>
      <span aria-hidden="true" className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${medallions[tone]}`}>
        <Icon name={icons[tone]} size={15} />
      </span>
      <span>{children}</span>
    </div>
  );
}
