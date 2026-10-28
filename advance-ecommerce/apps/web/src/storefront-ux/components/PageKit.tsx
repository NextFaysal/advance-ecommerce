/**
 * Platform page kit (doc 32 P1) — the shared layout patterns for
 * the fully-platform single pages (account, track, search,
 * wishlist, legal…), which are identical under every theme and
 * styled from the global tokens — NOT the active theme's token set.
 * It lives in storefront-ux/components (with StickyBuyBar and the
 * other storefront-shared pieces) rather than components/ui: that
 * folder is the cross-product design-system kit, while these
 * patterns are storefront-page conventions — the widths and rhythms
 * below are lifted from the pages themselves (account/track at
 * reading widths, wishlist at 7xl, the PDP shell at 1440px).
 *
 * Everything here is server-safe (no hooks, no function props) and
 * token-only, so a page built on the kit renders correctly in a
 * light-only theme AND in Aurora/Circuit dark — no fixed hex, no
 * half-flipped surfaces (doc 32 §0.6).
 *
 * - PageShell: the page <main> — width variant + the px/py rhythm
 *   the platform pages already use.
 * - SectionCard: the PDP/account section card (rounded-3xl, token
 *   border, card surface, shadow-card) with an optional header row.
 * - FormRow: label + control + hint/error — the account/settings
 *   form rhythm.
 * - PlatformEmptyState: the kit EmptyState in its server-safe form
 *   (actions arrive as children — typically a Link — never as an
 *   onAction callback).
 */
import type { ReactNode } from "react";
import { EmptyState } from "@/components/ui/empty-state";

/* ------------------------------------------------------------------ */
/* PageShell                                                           */
/* ------------------------------------------------------------------ */

const PAGE_SHELL_WIDTHS = {
  /** Auth/track-style centred column (max-w-md, generous vertical rhythm). */
  narrow: "max-w-md px-4 py-8 sm:py-10",
  /** Account reading width (max-w-3xl). */
  reading: "max-w-3xl px-4 py-8 sm:py-10",
  /** Grid pages — wishlist/search (max-w-7xl). */
  wide: "max-w-7xl px-4 py-6 sm:px-6",
  /** The PDP/content shell (1440px). */
  full: "max-w-[1440px] px-4 py-6 sm:px-6 lg:py-8",
} as const;

export type PageShellWidth = keyof typeof PAGE_SHELL_WIDTHS;

export function PageShell({
  width = "reading",
  className = "",
  children,
}: {
  width?: PageShellWidth;
  className?: string;
  children: ReactNode;
}) {
  return (
    <main className={`mx-auto min-w-0 w-full ${PAGE_SHELL_WIDTHS[width]} ${className}`}>
      {children}
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* SectionCard                                                         */
/* ------------------------------------------------------------------ */

export function SectionCard({
  title,
  description,
  actions,
  className = "",
  children,
}: {
  title?: ReactNode;
  description?: ReactNode;
  /** Header-row actions (links/buttons composed by the caller). */
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={`rounded-3xl border border-border bg-card p-6 shadow-card sm:p-8 ${className}`}
    >
      {title || actions ? (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {title ? (
              <h2 className="font-display text-xl font-extrabold text-text-main">{title}</h2>
            ) : null}
            {description ? (
              <p className="mt-1 text-sm leading-relaxed text-text-muted">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className={title || actions ? "mt-5" : undefined}>{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* FormRow                                                             */
/* ------------------------------------------------------------------ */

export function FormRow({
  label,
  htmlFor,
  hint,
  error,
  required = false,
  className = "",
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <label
        htmlFor={htmlFor}
        className="mb-1.5 block text-sm font-medium text-text-main"
      >
        {label}
        {required ? (
          <span aria-hidden="true" className="text-danger">
            {" "}
            *
          </span>
        ) : null}
      </label>
      {children}
      {error ? (
        <p role="alert" className="mt-1.5 text-xs font-medium text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-xs leading-5 text-text-subtle">{hint}</p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* PlatformEmptyState                                                  */
/* ------------------------------------------------------------------ */

export function PlatformEmptyState({
  title,
  description,
  illustration,
  className = "",
  children,
}: {
  title: string;
  description: string;
  illustration?: ReactNode;
  className?: string;
  /** Actions (typically Links) rendered under the description. */
  children?: ReactNode;
}) {
  return (
    <div className={className}>
      <EmptyState title={title} description={description} illustration={illustration}>
        {children}
      </EmptyState>
    </div>
  );
}
