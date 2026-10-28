import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon } from "./icon";

type Variant = "primary" | "gradient" | "secondary" | "outline" | "ghost" | "destructive";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  // Aurora Pro (doc 31, D3): the primary action IS the brand gradient —
  // it carries the glow halo at rest and deepens to the lift shadow on
  // hover. `gradient` stays as the explicit name for the same treatment
  // (hero/CTA call sites) so both spellings render identically.
  primary: "brand-gradient text-white shadow-glow hover:shadow-lift hover:brightness-105",
  gradient: "brand-gradient text-white shadow-glow hover:shadow-lift hover:brightness-105",
  secondary: "bg-secondary text-secondary-foreground shadow-xs hover:bg-surface-2 hover:shadow-card",
  outline: "border border-border-strong bg-card text-text-main shadow-xs hover:bg-surface-2 hover:shadow-card",
  ghost: "bg-transparent text-text-main hover:bg-brand-soft hover:text-brand-ink",
  destructive: "bg-danger text-white shadow-md hover:brightness-95 hover:shadow-lift",
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
      className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl font-semibold transition duration-base ease-smooth focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 ${variants[variant]} ${sizes[size]} ${className}`}
    >
      {loading ? <Icon name="spinner" size={16} className="animate-spin" /> : null}
      {children}
    </button>
  );
}
