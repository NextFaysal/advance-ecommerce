import type { ReactNode } from "react";
import { Button } from "./button";
import { Icon } from "./icon";

/**
 * EmptyState (Design System v4, doc 31 D3) — designed illustration spot
 * instead of an emoji: a soft-gradient squircle medallion with the
 * package glyph, ringed by a dashed halo and a small sparkle badge.
 * Pass `illustration` to override the visual (any node, ~72px).
 * `children` renders extra actions/content under the primary action.
 * All colours ride tokens, so the spot is dark-safe.
 */
export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
  illustration,
  children,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  illustration?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="animate-fade-slide-in rounded-2xl border border-dashed border-border-strong bg-surface-2/40 px-6 py-10 text-center shadow-xs">
      <div aria-hidden="true" className="mx-auto flex justify-center">
        {illustration ?? (
          <span className="relative flex h-[88px] w-[88px] items-center justify-center">
            <span className="absolute inset-0 rounded-full border border-dashed border-brand-ink/25" />
            <span className="brand-soft-gradient flex h-[68px] w-[68px] items-center justify-center rounded-[1.4rem] text-brand-ink shadow-xs ring-1 ring-inset ring-brand-ink/10">
              <Icon name="package" size={32} strokeWidth={1.25} />
            </span>
            <span className="brand-gradient absolute -right-0.5 -top-0.5 flex h-6 w-6 items-center justify-center rounded-full text-white shadow-glow">
              <Icon name="sparkles" size={12} />
            </span>
          </span>
        )}
      </div>
      <h3 className="font-display mt-4 text-lg font-semibold text-text-main">{title}</h3>
      <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-text-muted">{description}</p>
      {actionLabel && onAction ? (
        <div className="mt-5">
          <Button onClick={onAction}>{actionLabel}</Button>
        </div>
      ) : null}
      {children}
    </div>
  );
}
