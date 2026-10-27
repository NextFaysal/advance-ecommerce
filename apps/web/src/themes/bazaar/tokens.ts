/**
 * Bazaar theme — hand-authored token set (doc 24 §1 palette, doc 25
 * wave S4a).
 *
 * NOT generator output: the palette generator drifts hues (doc 24
 * audit §3), so every value here is authored directly from the
 * package's palette and converted hex → "H S% L%" triplet
 * programmatically, then hard-coded. Colour tokens follow the
 * platform catalogue format (src/lib/themes.ts THEME_TOKEN_META):
 * HSL triplets for `hsl` tokens, "R G B" triplets for the `--c-*`
 * RGB tokens, full strings for gradients/shadows/fonts.
 *
 * Palette (our design values for a grocery-store layout):
 * - Primary orange  #F5801F — prices, primary actions, badges.
 * - Deep green      #102E2A — the category nav bar, dark surfaces.
 * - Cream           #FFFBF5 — page background.
 * - Pale blue-grey  #F0F4F7 — muted/listing surface.
 * - Saving green    #2EBE7A — discount/savings accents.
 * - Sale red        #EE3B2E — destructive.
 * - Text            #1E2A32.
 *
 * Dark map is EMPTY by design: the engine merges the light map
 * under the dark delta, so the light look holds in dark mode. The
 * manifest's `supportsDark: false` (registry.ts) is the honest
 * declaration of that — this package is light-first.
 *
 * Font stacks are values from the platform allowlist
 * (THEME_FONT_STACKS in src/lib/themes.ts): the Hind Siliguri-led
 * stacks, since this is a Bangla-first grocery layout.
 */
import type { ThemeTokens } from "@/lib/themes";

/** Signature hexes for the few places a token class cannot land the
 *  exact colour (the deep-green nav bar — `--foreground` is the text
 *  colour #1E2A32, not the nav green — and SVG-free badge chips).
 *  Everything else in the package uses token utilities. */
export const BAZAAR_COLORS = {
  primary: "#F5801F",
  navGreen: "#102E2A",
  cream: "#FFFBF5",
  listing: "#F0F4F7",
  savingGreen: "#2EBE7A",
  saleRed: "#EE3B2E",
  whatsappGreen: "#1FA855",
  callNavy: "#1E3A8A",
} as const;

export const BAZAAR_TOKENS: ThemeTokens = {
  light: {
    /* Brand Colors */
    "--primary": "27 91% 54%", // #F5801F
    "--primary-foreground": "0 0% 100%",
    "--accent": "39 100% 56%", // #FFB020 warm amber
    "--accent-foreground": "172 48% 12%", // #102E2A on amber

    /* Backgrounds */
    "--background": "36 100% 98%", // #FFFBF5 cream
    "--foreground": "204 25% 16%", // #1E2A32
    "--card": "0 0% 100%",
    "--card-foreground": "204 25% 16%",
    "--muted": "206 30% 95%", // #F0F4F7 pale blue-grey
    "--muted-foreground": "204 13% 41%", // #5B6B76
    "--popover": "0 0% 100%",
    "--popover-foreground": "204 25% 16%",

    /* UI Elements */
    "--secondary": "32 87% 94%", // #FDF1E3 warm cream tint
    "--secondary-foreground": "172 48% 12%", // #102E2A
    "--border": "35 28% 88%", // #E9E2D8 warm light grey
    "--input": "35 27% 82%", // #DED4C6
    "--ring": "27 91% 54%", // primary orange

    /* Semantic */
    "--destructive": "4 85% 56%", // #EE3B2E
    "--destructive-foreground": "0 0% 100%",
    "--success": "152 61% 46%", // #2EBE7A saving green
    "--warning": "37 90% 48%", // #E8930C
    "--info": "221 83% 53%", // #2563EB

    /* Surfaces (RGB triplets) */
    "--c-surface": "255 255 255",
    "--c-surface-2": "240 244 247", // #F0F4F7
    "--c-bg-app": "255 251 245", // #FFFBF5
    "--c-text-main": "30 42 50", // #1E2A32
    "--c-text-muted": "91 107 118", // #5B6B76
    "--c-text-subtle": "122 136 148", // #7A8894

    /* Gradients & Radius */
    "--brand-gradient": "linear-gradient(135deg, #f5801f 0%, #ffb020 100%)",
    "--brand-soft-gradient": "linear-gradient(135deg, #fdf1e3 0%, #fffbf5 100%)",
    // ~6px at the platform's radius scale (rounded-md === var(--radius)):
    // the reference layout's buttons are small-radius rectangles.
    "--radius": "0.375rem",

    /* Shadows — deliberately softer/flatter than Aurora's indigo set,
       tinted with the text colour instead of indigo. */
    "--shadow-card":
      "0 1px 2px rgba(30, 42, 50, 0.05), 0 4px 12px -8px rgba(30, 42, 50, 0.08)",
    "--shadow-lift":
      "0 2px 4px rgba(30, 42, 50, 0.06), 0 10px 20px -10px rgba(30, 42, 50, 0.14)",
    "--shadow-pop":
      "0 4px 12px rgba(30, 42, 50, 0.08), 0 20px 40px -12px rgba(30, 42, 50, 0.2)",

    /* Typography — allowlisted Hind Siliguri-led stacks. */
    "--font-sans":
      '"Hind Siliguri", "Noto Sans Bengali", "Plus Jakarta Sans", system-ui, sans-serif',
    "--font-display":
      '"Hind Siliguri", "Plus Jakarta Sans", "Noto Sans Bengali", system-ui, sans-serif',
  },
  // Light-first package: no dark delta (see header comment).
  dark: {},
};
