import type { ReactNode } from "react";

type Elevation = "flat" | "card" | "lift";

const elevations: Record<Elevation, string> = {
  flat: "border border-border bg-card",
  card: "border border-border/70 bg-card shadow-card",
  lift: "border border-border/70 bg-card shadow-card transition motion-base hover:-translate-y-0.5 hover:shadow-lift",
};

/**
 * Card — surface container (Design System v2).
 * `elevation`: "card" (default) = soft indigo-tinted shadow; "lift" adds a
 * hover raise for clickable cards; "flat" = the old border-only look.
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
  return <section className={`rounded-lg p-5 ${elevations[elevation]} ${className}`}>{children}</section>;
}
