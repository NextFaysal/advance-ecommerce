import type { ReactNode } from "react";
import { Button } from "./button";
import { Icon } from "./icon";

/**
 * EmptyState (Design System v2) — designed illustration medallion instead
 * of an emoji. Pass `illustration` to override the visual (any node,
 * ~72px); the default is a package glyph in a soft brand-gradient ring.
 * `children` renders extra actions/content under the primary action.
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
    <div className="anim-rise rounded-lg border border-dashed border-border bg-card px-6 py-10 text-center shadow-card">
      <div aria-hidden="true" className="mx-auto flex justify-center">
        {illustration ?? (
          <span className="brand-soft-gradient flex h-[72px] w-[72px] items-center justify-center rounded-full text-brand-600 ring-1 ring-inset ring-brand-100">
            <Icon name="package" size={32} strokeWidth={1.25} />
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
