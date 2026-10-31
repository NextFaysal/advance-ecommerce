import type { InputHTMLAttributes, ReactNode } from "react";
import { Icon } from "./icon";

/**
 * Input (Design System v4, doc 31 D3) — `icon` slot (leading,
 * decorative), `suffix` slot (trailing, e.g. a show/hide password
 * button) and a token-driven error state (danger border + halo).
 * v4 treatment: rounded-xl shell on the surface colour, focus halo in
 * the brand ink token, danger tokens for errors. `prefix` (text) from
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
        className={`flex h-11 items-center gap-2 rounded-xl border bg-surface px-3 shadow-xs transition duration-base ease-smooth ${
          error
            ? "border-danger focus-within:border-danger focus-within:ring-[3px] focus-within:ring-danger/20"
            : "border-border focus-within:border-brand-ink focus-within:ring-[3px] focus-within:ring-brand-ink/15"
        }`}
      >
        {prefix ? <span aria-hidden="true" className="text-text-muted">{prefix}</span> : null}
        {icon ? <span aria-hidden="true" className="shrink-0 text-text-subtle">{icon}</span> : null}
        <input
          {...props}
          id={inputId}
          aria-describedby={describedBy}
          aria-invalid={Boolean(error)}
          className={`w-full bg-transparent text-base text-text-main outline-none placeholder:text-text-subtle sm:text-sm ${className}`}
        />
        {suffix ? <span className="shrink-0">{suffix}</span> : null}
      </span>
      {error ? (
        <span id={`${inputId}-error`} role="alert" className="mt-1.5 flex items-center gap-1 text-xs font-medium text-danger">
          <Icon name="alert" size={13} /> {error}
        </span>
      ) : null}
      {!error && helper ? <span id={`${inputId}-helper`} className="mt-1.5 block text-xs text-text-muted">{helper}</span> : null}
    </label>
  );
}
