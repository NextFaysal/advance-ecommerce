"use client";

/**
 * Cart primitives — the shared drawer/page building blocks (doc 32
 * P1), extracted from the two surfaces that had already converged
 * in markup: the platform cart page (CartPageClient) and the theme
 * cart drawers (Bazaar's is the reference implementation).
 *
 * - QtyStepper: the quantity control in both densities — the
 *   drawer's compact 36px form (SVG glyphs) and the cart page's
 *   comfortable 44px form (text glyphs, ≥44px touch targets). The
 *   stepper is purely presentational: quantities, stepping rules
 *   and persistence stay with the caller (src/lib/quantity +
 *   src/cart contracts are untouched).
 * - CartLineRow: the line-row shell (thumb, name/meta slot, stepper
 *   slot, price slot, remove button) both surfaces lay out the same
 *   way; the caller composes the slots from its own line shape —
 *   guest-cart snapshots in drawers, catalog-resolved lines on the
 *   cart page — so no cart data contract is imposed here.
 * - FreeShippingProgress: the free-shipping progress bar. Pure
 *   presentation — the threshold (the `shipping.free_above_poisha`
 *   store setting) and the copy arrive as props from whoever knows
 *   them; it renders nothing while the threshold is off (≤ 0),
 *   matching shipping-core's rule. Money text arrives pre-formatted
 *   inside `label`/`completeLabel` so the numerals preference stays
 *   with the caller's formatters (doc 30/32 §0.5).
 *
 * Copy stays with callers throughout: every aria label is a prop.
 */
import type { ReactNode } from "react";
import { Icon } from "@/components/ui/icon";
import { StoreImage } from "./StoreImage";

/* ------------------------------------------------------------------ */
/* QtyStepper                                                          */
/* ------------------------------------------------------------------ */

export function QtyStepper({
  value,
  valueLabel,
  onDecrease,
  onIncrease,
  decreaseLabel,
  increaseLabel,
  decreaseDisabled = false,
  increaseDisabled = false,
  density = "comfortable",
  className = "",
}: {
  /** The quantity display (already formatted — digits are the caller's). */
  value: ReactNode;
  /** aria-label for the value readout (e.g. the "Quantity" string). */
  valueLabel?: string;
  onDecrease: () => void;
  onIncrease: () => void;
  decreaseLabel: string;
  increaseLabel: string;
  decreaseDisabled?: boolean;
  increaseDisabled?: boolean;
  /** compact = drawer rows (36px); comfortable = cart page (44px). */
  density?: "compact" | "comfortable";
  className?: string;
}) {
  if (density === "compact") {
    return (
      <div
        className={`flex h-9 items-stretch overflow-hidden rounded-md border border-input bg-card ${className}`}
      >
        <button
          type="button"
          onClick={onDecrease}
          disabled={decreaseDisabled}
          aria-label={decreaseLabel}
          className="flex w-9 items-center justify-center text-text-main transition hover:bg-muted disabled:opacity-40"
        >
          <Icon name="minus" size={14} />
        </button>
        <span
          aria-label={valueLabel}
          className="flex min-w-[40px] items-center justify-center border-x border-input px-1.5 text-sm font-bold tabular-nums text-text-main"
        >
          {value}
        </span>
        <button
          type="button"
          onClick={onIncrease}
          disabled={increaseDisabled}
          aria-label={increaseLabel}
          className="flex w-9 items-center justify-center text-text-main transition hover:bg-muted disabled:opacity-40"
        >
          <Icon name="plus" size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className={`inline-flex items-center rounded-md border border-border ${className}`}>
      <button
        type="button"
        aria-label={decreaseLabel}
        disabled={decreaseDisabled}
        onClick={onDecrease}
        className="flex h-11 w-11 items-center justify-center text-lg disabled:opacity-40"
      >
        −
      </button>
      <span
        className="w-10 text-center text-sm font-medium tabular-nums"
        aria-label={valueLabel}
      >
        {value}
      </span>
      <button
        type="button"
        aria-label={increaseLabel}
        disabled={increaseDisabled}
        onClick={onIncrease}
        className="flex h-11 w-11 items-center justify-center text-lg disabled:opacity-40"
      >
        +
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* CartLineRow                                                         */
/* ------------------------------------------------------------------ */

export function CartLineRow({
  imageUrl,
  imageAlt = "",
  name,
  meta,
  stepper,
  priceLine,
  onRemove,
  removeLabel,
  className = "",
}: {
  imageUrl?: string | null;
  imageAlt?: string;
  /** Line name (a Link or plain text — composed by the caller). */
  name: ReactNode;
  /** Variant label / SKU / weight notes under the name. */
  meta?: ReactNode;
  /** Typically a <QtyStepper />. */
  stepper?: ReactNode;
  /** Unit × qty = total line (pre-formatted by the caller). */
  priceLine?: ReactNode;
  onRemove?: () => void;
  removeLabel?: string;
  className?: string;
}) {
  return (
    <div className={`flex gap-3 ${className}`}>
      <span className="relative h-[64px] w-[64px] shrink-0 overflow-hidden rounded-md border border-border bg-muted">
        {imageUrl ? (
          <StoreImage src={imageUrl} alt={imageAlt} preset="thumb" fillParent />
        ) : (
          <span className="flex h-full w-full items-center justify-center font-display text-lg font-extrabold text-primary/40">
            {typeof name === "string" ? name.charAt(0) : null}
          </span>
        )}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="line-clamp-2 min-w-0 break-words text-sm font-semibold leading-snug text-text-main [overflow-wrap:anywhere]">
            {name}
          </div>
          {onRemove ? (
            <button
              type="button"
              onClick={onRemove}
              aria-label={removeLabel}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-text-subtle transition hover:bg-destructive/10 hover:text-destructive"
            >
              <Icon name="x" size={15} />
            </button>
          ) : null}
        </div>
        {meta}
        {stepper || priceLine ? (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            {stepper}
            {priceLine}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* FreeShippingProgress                                                */
/* ------------------------------------------------------------------ */

export function FreeShippingProgress({
  subtotalPoisha,
  thresholdPoisha,
  label,
  completeLabel,
  className = "",
}: {
  subtotalPoisha: number;
  /** The store's free-above threshold; ≤ 0 = feature off (renders null). */
  thresholdPoisha: number;
  /** Pre-formatted "remaining" copy (numerals already applied). */
  label: ReactNode;
  /** Pre-formatted copy shown once the threshold is reached. */
  completeLabel?: ReactNode;
  className?: string;
}) {
  if (thresholdPoisha <= 0) return null;
  const reached = subtotalPoisha >= thresholdPoisha;
  const pct = Math.min(100, Math.round((subtotalPoisha / thresholdPoisha) * 100));
  return (
    <div className={className}>
      <p className="text-xs leading-5 text-text-muted">{reached && completeLabel ? completeLabel : label}</p>
      <div
        className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={thresholdPoisha}
        aria-valuenow={Math.min(subtotalPoisha, thresholdPoisha)}
      >
        <div
          aria-hidden="true"
          className="brand-gradient h-full rounded-full transition-all duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
