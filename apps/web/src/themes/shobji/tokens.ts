/**
 * Shobji theme — hand-authored token set (doc 27 theme T-B).
 *
 * NOT generator output: every value here is authored directly for
 * this package and converted hex → "H S% L%" triplet, then
 * hard-coded. Colour tokens follow the platform catalogue format
 * (src/lib/themes.ts THEME_TOKEN_META): HSL triplets for `hsl`
 * tokens, "R G B" triplets for the `--c-*` RGB tokens, full strings
 * for gradients/shadows/fonts.
 *
 * Palette (this package's own design values for a sidebar grocery
 * layout):
 * - Primary purple  #7438A8 — actions, prices, the sidebar accents,
 *   the floating cart tab, the account button.
 * - Deep purple     #5B2A86 — pressed/hover partner of the primary;
 *   Buy Now on the PDP.
 * - Lavender        #EFEAF9 — hero panel + soft listing surface.
 * - Gold            #E9B949 — accent (badges, small highlights).
 * - White           #FFFFFF — page background.
 * - Text            #241B2E (deep plum-charcoal).
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
 * since this is a Bangla-first grocery layout.
 */
import type { ThemeTokens } from "@/lib/themes";

/** Signature hexes for the few places a token class cannot land
 *  the exact colour (the lavender surface token already covers
 *  most; these cover the deep-purple Buy Now and the gold chip).
 *  Everything else in the package uses token utilities. */
export const SHOBJI_COLORS = {
  primary: "#7438A8",
  primaryDeep: "#5B2A86",
  lavender: "#EFEAF9",
  gold: "#E9B949",
  savingGreen: "#219A62",
  whatsappGreen: "#1FA855",
  callPlum: "#3E2A5C",
} as const;

export const SHOBJI_TOKENS: ThemeTokens = {
  light: {
    /* Brand Colors */
    "--primary": "272 50% 44%", // #7438A8
    "--primary-foreground": "0 0% 100%",
    "--accent": "42 78% 60%", // #E9B949 gold
    "--accent-foreground": "272 45% 18%", // deep plum on gold

    /* Backgrounds */
    "--background": "0 0% 100%", // white
    "--foreground": "268 26% 14%", // #241B2E
    "--card": "0 0% 100%",
    "--card-foreground": "268 26% 14%",
    "--muted": "263 44% 96%", // #F5F2FA pale lavender-grey
    "--muted-foreground": "261 12% 45%", // #6E6480
    "--popover": "0 0% 100%",
    "--popover-foreground": "268 26% 14%",

    /* UI Elements */
    "--secondary": "260 56% 95%", // #EFEAF9 lavender
    "--secondary-foreground": "266 52% 24%", // #3A1E5E
    "--border": "261 38% 90%", // #E3DCF0
    "--input": "261 32% 85%", // #D5CBE8
    "--ring": "272 50% 44%", // primary purple

    /* Semantic */
    "--destructive": "4 69% 52%", // #D93B30
    "--destructive-foreground": "0 0% 100%",
    "--success": "152 65% 37%", // #219A62
    "--warning": "36 90% 46%", // #DE8A0C
    "--info": "221 83% 53%", // #2563EB

    /* Surfaces (RGB triplets) */
    "--c-surface": "255 255 255",
    "--c-surface-2": "239 234 249", // #EFEAF9 lavender
    "--c-bg-app": "255 255 255",
    "--c-text-main": "36 27 46", // #241B2E
    "--c-text-muted": "110 100 128", // #6E6480
    "--c-text-subtle": "148 139 166", // #948BA6

    /* Gradients & Radius */
    "--brand-gradient": "linear-gradient(135deg, #7438a8 0%, #a55eea 100%)",
    "--brand-soft-gradient": "linear-gradient(135deg, #efeaf9 0%, #ffffff 100%)",
    // ~8px at the platform's radius scale (rounded-md === var(--radius)):
    // this layout's cards and panels are softly rounded.
    "--radius": "0.5rem",

    /* Shadows — soft and plum-tinted, in the family of the text
       colour rather than a neutral grey. */
    "--shadow-card":
      "0 1px 3px rgba(36, 27, 46, 0.05), 0 6px 16px -10px rgba(36, 27, 46, 0.10)",
    "--shadow-lift":
      "0 2px 6px rgba(36, 27, 46, 0.06), 0 14px 28px -12px rgba(36, 27, 46, 0.16)",
    "--shadow-pop":
      "0 6px 16px rgba(36, 27, 46, 0.10), 0 24px 48px -16px rgba(36, 27, 46, 0.22)",

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
