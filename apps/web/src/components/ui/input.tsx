import type { InputHTMLAttributes } from "react";

export function Input({
  label,
  helper,
  error,
  prefix,
  id,
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  helper?: string;
  error?: string;
  prefix?: string;
}) {
  const inputId = id ?? props.name ?? "field";
  const describedBy = error ? `${inputId}-error` : helper ? `${inputId}-helper` : undefined;
  return (
    <label htmlFor={inputId} className="block">
      {label ? <span className="mb-1 block text-xs font-medium text-text-muted">{label}{props.required ? " *" : ""}</span> : null}
      <span className="flex h-10 items-center gap-2 rounded-[10px] border border-border bg-card px-3 focus-within:border-brand-500 focus-within:ring-[3px] focus-within:ring-brand-100">
        {prefix ? <span aria-hidden="true" className="text-text-muted">{prefix}</span> : null}
        <input
          {...props}
          id={inputId}
          aria-describedby={describedBy}
          aria-invalid={Boolean(error)}
          className={`w-full bg-transparent text-sm outline-none ${className}`}
        />
      </span>
      {error ? <span id={`${inputId}-error`} role="alert" className="mt-1 block text-xs text-rose-500">⚠ {error}</span> : null}
      {!error && helper ? <span id={`${inputId}-helper`} className="mt-1 block text-xs text-text-muted">{helper}</span> : null}
    </label>
  );
}
