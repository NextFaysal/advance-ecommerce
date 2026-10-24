import type { InputHTMLAttributes, ReactNode } from "react";
import { Icon } from "./icon";

/**
 * Input (Design System v2) — adds an `icon` slot (leading, decorative),
 * a `suffix` slot (trailing, e.g. a show/hide password button) and a
 * proper error state (rose border + ring + icon). `prefix` (text) from
 * v1 still works and renders before the icon.
 */
export function Input({
  label,
  helper,
  error,
  prefix,
  icon,
  suffix,
  id,
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  helper?: string;
  error?: string;
  prefix?: string;
  icon?: ReactNode;
  suffix?: ReactNode;
}) {
  const inputId = id ?? props.name ?? "field";
  const describedBy = error ? `${inputId}-error` : helper ? `${inputId}-helper` : undefined;
  return (
    <label htmlFor={inputId} className="block">
      {label ? <span className="mb-1.5 block text-sm font-medium text-text-main">{label}{props.required ? " *" : ""}</span> : null}
      <span
        className={`flex h-11 items-center gap-2 rounded-md border bg-card px-3 transition motion-fast ${
          error
            ? "border-rose-400 focus-within:border-rose-500 focus-within:ring-[3px] focus-within:ring-rose-100"
            : "border-border focus-within:border-brand-500 focus-within:ring-[3px] focus-within:ring-brand-100"
        }`}
      >
        {prefix ? <span aria-hidden="true" className="text-text-muted">{prefix}</span> : null}
        {icon ? <span aria-hidden="true" className="shrink-0 text-text-subtle">{icon}</span> : null}
        <input
          {...props}
          id={inputId}
          aria-describedby={describedBy}
          aria-invalid={Boolean(error)}
          className={`w-full bg-transparent text-sm text-text-main outline-none placeholder:text-text-subtle ${className}`}
        />
        {suffix ? <span className="shrink-0">{suffix}</span> : null}
      </span>
      {error ? (
        <span id={`${inputId}-error`} role="alert" className="mt-1.5 flex items-center gap-1 text-xs font-medium text-rose-600">
          <Icon name="alert" size={13} /> {error}
        </span>
      ) : null}
      {!error && helper ? <span id={`${inputId}-helper`} className="mt-1.5 block text-xs text-text-muted">{helper}</span> : null}
    </label>
  );
}
