/**
 * Haat theme — hand-authored token set (doc 27 theme T-A).
 *
 * NOT generator output: every value here is authored directly for
 * this package's marketplace palette and converted hex → "H S% L%"
 * triplet by hand, in the platform catalogue format (src/lib/themes.ts
 * THEME_TOKEN_META): HSL triplets for `hsl` tokens, "R G B" triplets
 * for the `--c-*` RGB tokens, full strings for gradients/shadows/fonts.
 *
 * Palette (this package's own design values for a dense,
 * search-led marketplace layout):
 * - Primary orange  #F26D21 — header, prices, primary actions.
 * - Deep orange     #D9550D — header utility strip, Buy Now.
 * - Amber           #FF9F1C — accent end of the brand gradient.
 * - Page grey       #F5F5F5 — app/listing background.
 * - Charcoal        #262626 — text, footer band.
 * - Discount green  #1E9E5A — success / savings accents.
 * - Sale red        #D92D20 — destructive.
 *
 * Dark map is EMPTY by design: the engine merges the light map
 * under the dark delta, so the light look holds in dark mode. The
 * manifest's `supportsDark: false` is the honest declaration of
 * that — this package is light-first.
 *
 * Font tokens reference the shared brand stacks defined once in
 * app/globals.css (--font-brand-sans / --font-brand-display, perf
 * wave item 5); the resolved stacks are the platform allowlist's
 * Hind Siliguri-led stacks (THEME_FONT_STACKS in src/lib/themes.ts),
 * since this is a Bangla-first marketplace layout.
 */
import type { ThemeTokens } from "@/lib/themes";

/** Signature hexes for the few places a token class cannot land
 *  the exact colour (the solid-orange header tiers, the deep-orange
 *  Buy Now, badge chips). Everything else in the package uses token
 *  utilities. */
export const HAAT_COLORS = {
  primary: "#F26D21",
  deepOrange: "#D9550D",
  pageGrey: "#F5F5F5",
  charcoal: "#262626",
  discountGreen: "#1E9E5A",
  whatsappGreen: "#25B05C",
  callNavy: "#17456B",
} as const;

export const HAAT_TOKENS: ThemeTokens = {
  light: {
    /* Brand Colors */
    "--primary": "22 89% 54%", // #F26D21
    "--primary-foreground": "0 0% 100%",
    "--accent": "35 100% 55%", // #FF9F1C amber
    "--accent-foreground": "25 95% 25%", // deep orange-brown on amber

    /* Backgrounds */
    "--background": "0 0% 96%", // #F5F5F5 page grey
    "--foreground": "0 0% 15%", // #262626
    "--card": "0 0% 100%",
    "--card-foreground": "0 0% 15%",
    "--muted": "0 0% 93%", // #EDEDED
    "--muted-foreground": "0 0% 35%", // #595959
    "--popover": "0 0% 100%",
    "--popover-foreground": "0 0% 15%",

    /* UI Elements */
    "--secondary": "28 93% 95%", // #FEF0E4 pale orange tint
    "--secondary-foreground": "25 95% 25%",
    "--border": "30 18% 89%", // #E8E3DE warm light grey
    "--input": "30 13% 82%", // #D8D2CC
    "--ring": "22 89% 54%", // primary orange

    /* Semantic */
    "--destructive": "4 74% 49%", // #D92D20
    "--destructive-foreground": "0 0% 100%",
    "--success": "148 68% 37%", // #1E9E5A discount green
    "--warning": "37 90% 48%", // #E8930C
    "--info": "221 83% 53%", // #2563EB

    /* Surfaces (RGB triplets) */
    "--c-surface": "255 255 255",
    "--c-surface-2": "245 245 245", // #F5F5F5
    "--c-bg-app": "245 245 245", // #F5F5F5
    "--c-text-main": "38 38 38", // #262626
    "--c-text-muted": "89 89 89", // #595959
    "--c-text-subtle": "115 115 115", // #737373

    /* Gradients & Radius */
    "--brand-gradient": "linear-gradient(135deg, #f26d21 0%, #ff9f1c 100%)",
    "--brand-soft-gradient": "linear-gradient(135deg, #fef3e8 0%, #ffffff 100%)",
    // ~4px at the platform's radius scale (rounded-md === var(--radius)):
    // the marketplace layout's cards/buttons are tight rectangles.
    "--radius": "0.25rem",

    /* Shadows — deliberately flat, tinted with the text colour. */
    "--shadow-card":
      "0 1px 2px rgba(38, 38, 38, 0.05), 0 2px 8px -6px rgba(38, 38, 38, 0.08)",
    "--shadow-lift":
      "0 2px 4px rgba(38, 38, 38, 0.06), 0 8px 16px -8px rgba(38, 38, 38, 0.14)",
    "--shadow-pop":
      "0 4px 10px rgba(38, 38, 38, 0.08), 0 16px 32px -10px rgba(38, 38, 38, 0.2)",

    /* Typography — the shared brand stacks by reference (perf wave
       item 5): the literal stacks live once in app/globals.css as
       --font-brand-sans / --font-brand-display; the resolved values
       are the allowlist's Hind Siliguri-led stacks, unchanged. */
    "--font-sans": "var(--font-brand-sans)",
    "--font-display": "var(--font-brand-display)",
  },
  // Light-first package: no dark delta (see header comment).
  dark: {},
};
