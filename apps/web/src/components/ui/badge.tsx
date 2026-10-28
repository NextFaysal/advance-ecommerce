import type { ReactNode } from "react";

/* Design tokens v4 (doc 31, D3): semantic tones ride the solid/soft
   token pairs, so every badge flips correctly in dark mode (the old
   fixed emerald/amber/rose/sky -50 fills did not). */
const tones: Record<string, string> = {
  brand: "bg-brand-soft text-brand-ink",
  gradient: "brand-gradient text-white",
  success: "bg-success-soft text-success-solid",
  warning: "bg-warning-soft text-warning-solid",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info-solid",
  neutral: "bg-surface-2 text-text-muted",
};

const dots: Record<string, string> = {
  brand: "bg-brand-ink",
  gradient: "bg-white",
  success: "bg-success-solid",
  warning: "bg-warning-solid",
  danger: "bg-danger",
  info: "bg-info-solid",
  neutral: "bg-text-subtle",
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
    <span className={`inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium leading-none ring-1 ring-inset ring-black/5 dark:ring-white/10 ${tones[tone]}`}>
      {dot ? <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${dots[tone]}`} /> : null}
      {icon}
      {children}
    </span>
  );
}
