import type { ReactNode } from "react";

type Elevation = "flat" | "card" | "lift" | "raised";

const elevations: Record<Elevation, string> = {
  flat: "border border-border bg-card",
  card: "border border-border/60 bg-card shadow-xs transition duration-base ease-smooth hover:shadow-card",
  lift: "border border-border/60 bg-card shadow-card transition duration-base ease-smooth hover:-translate-y-0.5 hover:shadow-lift",
  // Raised = the top surface step (doc 31 tokens v4): sits on
  // --c-surface-raised so panels nested inside a card still read as a
  // higher layer in both modes.
  raised: "border border-border/50 bg-surface-raised shadow-card",
};

/**
 * Card — surface container (Design System v4, doc 31 D3).
 * `elevation`: "card" (default) = hairline xs shadow that deepens on
 * hover; "lift" adds a hover raise for clickable cards; "raised" = the
 * top surface step for nested/highlight panels; "flat" = border only.
 */
export function Card({
  children,
  className = "",
  elevation = "card",
}: {
  children: ReactNode;
  className?: string;
  elevation?: Elevation;
}) {
  return <section className={`rounded-2xl p-5 ${elevations[elevation]} ${className}`}>{children}</section>;
}
