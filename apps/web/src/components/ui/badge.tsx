import type { ReactNode } from "react";

const tones: Record<string, string> = {
  brand: "bg-brand-100 text-brand-700",
  gradient: "brand-gradient text-white",
  success: "bg-emerald-50 text-emerald-700",
  warning: "bg-amber-50 text-amber-700",
  danger: "bg-rose-50 text-rose-700",
  info: "bg-sky-50 text-sky-700",
  neutral: "bg-slate-100 text-slate-600",
};

const dots: Record<string, string> = {
  brand: "bg-brand-500",
  gradient: "bg-white",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-rose-500",
  info: "bg-sky-500",
  neutral: "bg-slate-400",
};

export function Badge({
  children,
  tone = "brand",
  icon,
  dot = false,
}: {
  children: ReactNode;
  tone?: "brand" | "gradient" | "success" | "warning" | "danger" | "info" | "neutral";
  /** Optional leading slot (v2) — pass an <Icon size={12}> or any small node. */
  icon?: ReactNode;
  /** Optional status dot before the label (v2). */
  dot?: boolean;
}) {
  return (
    <span className={`inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium leading-none ring-1 ring-inset ring-black/5 ${tones[tone]}`}>
      {dot ? <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${dots[tone]}`} /> : null}
      {icon}
      {children}
    </span>
  );
}
