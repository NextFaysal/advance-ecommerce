import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon } from "./icon";

type Variant = "primary" | "gradient" | "secondary" | "outline" | "ghost" | "destructive";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary: "bg-brand-600 text-white shadow-md hover:bg-brand-700 hover:shadow-lift",
  gradient: "brand-gradient text-white shadow-md hover:shadow-lift hover:brightness-105",
  secondary: "bg-brand-50 text-brand-700 hover:bg-brand-100",
  outline: "border border-border bg-card text-text-main hover:bg-surface-2 hover:shadow-card",
  ghost: "bg-transparent text-text-main hover:bg-surface-2",
  destructive: "bg-rose-500 text-white shadow-md hover:bg-rose-600 hover:shadow-lift",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-5 text-base",
};

export function Button({
  children,
  variant = "primary",
  size = "md",
  loading = false,
  className = "",
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md font-semibold transition motion-base focus-visible:ring-[3px] focus-visible:ring-brand-500/40 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 ${variants[variant]} ${sizes[size]} ${className}`}
    >
      {loading ? <Icon name="spinner" size={16} className="animate-spin" /> : null}
      {children}
    </button>
  );
}
