"use client";

/**
 * ThemedProductCard — the ProductCard slot's consumer wrapper
 * (doc 25 §1.4; wave S3b).
 *
 * A thin pass-through: reads the active package id ONCE from the
 * ThemeView context, resolves the package's card component through
 * the client card registry (per-slot Aurora fallback built in), and
 * renders it with the exact props the platform's card always took.
 * For Aurora the resolved component IS src/catalog/ProductCard, so
 * the rendered output is byte-identical to rendering it directly —
 * the wrapper adds one context read per card and nothing else.
 *
 * Consumers keep their own keys/layout wrappers; this component owns
 * no markup of its own.
 */
import { getProductCardSlot } from "./client-card-registry";
import { useThemeView } from "./theme-view";
import type { ThemeProductCardProps } from "./slots";

export function ThemedProductCard(props: ThemeProductCardProps) {
  const themeView = useThemeView();
  const Card = getProductCardSlot(themeView.packageId);
  return <Card {...props} />;
}
