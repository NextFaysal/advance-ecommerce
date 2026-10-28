import type { TextareaHTMLAttributes } from "react";
import { Icon } from "./icon";

/**
 * Textarea (Design System v4, doc 31 D3) — the multiline sibling of
 * Input: same label / helper / error treatment, rounded-xl shell and
 * token focus halo, so admin forms can mix both without a visual seam.
 * Used for SEO descriptions, brand descriptions and other free-text
 * fields (Wave 13-2).
 */
export function Textarea({
  label,
  helper,
  error,
  id,
  className = "",
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: string;
  helper?: string;
  error?: string;
}) {
  const inputId = id ?? props.name ?? "field";
  const describedBy = error ? `${inputId}-error` : helper ? `${inputId}-helper` : undefined;
  return (
    <label htmlFor={inputId} className="block">
      {label ? (
        <span className="mb-1.5 block text-sm font-medium text-text-main">
          {label}
          {props.required ? " *" : ""}
        </span>
      ) : null}
      <span
        className={`flex rounded-xl border bg-surface px-3 py-2.5 shadow-xs transition duration-base ease-smooth ${
          error
            ? "border-danger focus-within:border-danger focus-within:ring-[3px] focus-within:ring-danger/20"
            : "border-border focus-within:border-brand-ink focus-within:ring-[3px] focus-within:ring-brand-ink/15"
        }`}
      >
        <textarea
          {...props}
          id={inputId}
          aria-describedby={describedBy}
          aria-invalid={Boolean(error)}
          rows={props.rows ?? 3}
          className={`w-full resize-y bg-transparent text-sm leading-relaxed text-text-main outline-none placeholder:text-text-subtle ${className}`}
        />
      </span>
      {error ? (
        <span id={`${inputId}-error`} role="alert" className="mt-1.5 flex items-center gap-1 text-xs font-medium text-danger">
          <Icon name="alert" size={13} /> {error}
        </span>
      ) : null}
      {!error && helper ? (
        <span id={`${inputId}-helper`} className="mt-1.5 block text-xs text-text-muted">
          {helper}
        </span>
      ) : null}
    </label>
  );
}
