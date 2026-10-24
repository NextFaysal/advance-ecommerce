import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "gradient" | "secondary" | "outline" | "ghost" | "destructive";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 shadow-sm",
  gradient: "brand-gradient text-white shadow-sm",
  secondary: "bg-brand-50 text-brand-700 hover:bg-brand-100",
  outline: "border border-border bg-transparent hover:bg-surface-2",
  ghost: "bg-transparent hover:bg-surface-2",
  destructive: "bg-rose-500 text-white hover:bg-rose-600",
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
      className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md font-medium transition motion-base active:scale-[0.98] disabled:opacity-50 ${variants[variant]} ${sizes[size]} ${className}`}
    >
      {loading ? <span aria-hidden="true">◌</span> : null}
      {children}
    </button>
  );
}
