/**
 * Boighor theme — hand-authored token set (doc 27 T-C).
 *
 * NOT generator output: every value here is authored directly from
 * the package's own palette and converted hex → "H S% L%" triplet
 * programmatically, then hard-coded. Colour tokens follow the
 * platform catalogue format (src/lib/themes.ts THEME_TOKEN_META):
 * HSL triplets for `hsl` tokens, "R G B" triplets for the `--c-*`
 * RGB tokens, full strings for gradients/shadows/fonts.
 *
 * Palette (our design values for a books-catalogue layout):
 * - Primary blue    #1668B4 — prices, primary actions, links.
 * - Utility blue    #0B4F8C — the top utility bar (see BOIGHOR_COLORS).
 * - Pale blue       #EAF2FB — facet row, listing/muted surface.
 * - Page grey-blue  #F4F6F8 — page background.
 * - Offer red       #D93A36 — discount badge, sale accents.
 * - Text            #1F2D3A.
 *
 * Dark map is EMPTY by design: the engine merges the light map
 * under the dark delta, so the light look holds in dark mode. The
 * manifest's `supportsDark: false` (registry.ts) is the honest
 * declaration of that — this package is light-first.
 *
 * Font tokens reference the shared brand stacks defined once in
 * app/globals.css (--font-brand-sans / --font-brand-display, perf
 * wave item 5); the resolved stacks are the platform allowlist's
 * Hind Siliguri-led stacks (THEME_FONT_STACKS in src/lib/themes.ts),
 * since this is a Bangla-first catalogue layout.
 */
import type { ThemeTokens } from "@/lib/themes";

/** Signature hexes for the few places a token class cannot land the
 *  exact colour (the blue utility bar, the red discount disc, the
 *  WhatsApp/Call buttons). Everything else in the package uses
 *  token utilities. */
export const BOIGHOR_COLORS = {
  primary: "#1668B4",
  utilityBlue: "#0B4F8C",
  paleBlue: "#EAF2FB",
  pageBg: "#F4F6F8",
  saleRed: "#D93A36",
  whatsappGreen: "#1FA855",
  callNavy: "#1E3A8A",
} as const;

export const BOIGHOR_TOKENS: ThemeTokens = {
  light: {
    /* Brand Colors */
    "--primary": "209 78% 40%", // #1668B4
    "--primary-foreground": "0 0% 100%",
    "--accent": "37 91% 55%", // #F5A623 warm amber (badges, highlights)
    "--accent-foreground": "209 76% 18%", // deep blue on amber

    /* Backgrounds */
    "--background": "210 22% 96%", // #F4F6F8
    "--foreground": "210 30% 17%", // #1F2D3A
    "--card": "0 0% 100%",
    "--card-foreground": "210 30% 17%",
    "--muted": "212 68% 95%", // #EAF2FB pale blue
    "--muted-foreground": "210 16% 42%", // #5A6B7A
    "--popover": "0 0% 100%",
    "--popover-foreground": "210 30% 17%",

    /* UI Elements */
    "--secondary": "212 60% 93%", // #DCEBF8 deeper pale blue tint
    "--secondary-foreground": "209 78% 30%",
    "--border": "212 30% 88%", // #D8E2EC
    "--input": "212 28% 80%", // #B9CBDD
    "--ring": "209 78% 40%", // primary blue

    /* Semantic */
    "--destructive": "2 68% 53%", // #D93A36
    "--destructive-foreground": "0 0% 100%",
    "--success": "152 55% 38%", // stock green
    "--warning": "37 90% 48%", // #E8930C
    "--info": "209 78% 40%", // #1668B4

    /* Surfaces (RGB triplets) */
    "--c-surface": "255 255 255",
    "--c-surface-2": "234 242 251", // #EAF2FB
    "--c-bg-app": "244 246 248", // #F4F6F8
    "--c-text-main": "31 45 58", // #1F2D3A
    "--c-text-muted": "90 107 122", // #5A6B7A
    "--c-text-subtle": "122 136 150", // #7A8896

    /* Gradients & Radius */
    "--brand-gradient": "linear-gradient(135deg, #1668b4 0%, #2f8fd6 100%)",
    "--brand-soft-gradient": "linear-gradient(135deg, #eaf2fb 0%, #f4f6f8 100%)",
    // 0.5rem at the platform's radius scale: this catalogue layout's
    // cards and buttons are medium-radius rectangles.
    "--radius": "0.5rem",

    /* Shadows — soft and flat, tinted with the text colour. */
    "--shadow-card":
      "0 1px 2px rgba(31, 45, 58, 0.05), 0 4px 12px -8px rgba(31, 45, 58, 0.08)",
    "--shadow-lift":
      "0 2px 4px rgba(31, 45, 58, 0.06), 0 10px 20px -10px rgba(31, 45, 58, 0.14)",
    "--shadow-pop":
      "0 4px 12px rgba(31, 45, 58, 0.08), 0 20px 40px -12px rgba(31, 45, 58, 0.2)",

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
