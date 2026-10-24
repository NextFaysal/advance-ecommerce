import type { ReactNode } from "react";

export function Badge({ children, tone = "brand" }: { children: ReactNode; tone?: "brand" | "success" | "warning" | "danger" | "info" | "neutral" }) {
  const tones: Record<string, string> = {
    brand: "bg-brand-100 text-brand-700",
    success: "bg-emerald-50 text-emerald-700",
    warning: "bg-amber-50 text-amber-700",
    danger: "bg-rose-50 text-rose-700",
    info: "bg-sky-50 text-sky-700",
    neutral: "bg-slate-100 text-slate-600",
  };
  return <span className={`inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}
