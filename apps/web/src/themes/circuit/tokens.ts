/**
 * Circuit theme — hand-authored token set (doc 27 T-D).
 *
 * NOT generator output: every value here is authored directly from
 * the package's own palette and converted hex → "H S% L%" triplet
 * programmatically, then hard-coded. Colour tokens follow the
 * platform catalogue format (src/lib/themes.ts THEME_TOKEN_META):
 * HSL triplets for `hsl` tokens, "R G B" triplets for the `--c-*`
 * RGB tokens, full strings for gradients/shadows/fonts.
 *
 * Palette (our design values for a tech-store layout):
 * - Primary orange  #F07D1A — prices' companion actions, badges.
 * - Deep navy       #10222E — the header tier, footer, dark surfaces.
 * - Pale tech grey  #EFF3F6 — page background / listing surface.
 * - Save purple     #7126B0 — the card's savings pill.
 * - Price red       #D92D20 — product prices (the destructive token).
 * - CTA gradient    #2563EB → #06B6D4 (blue → cyan) — carried by the
 *   --brand-gradient token; components use the `brand-gradient`
 *   utility the platform builds from it.
 * - Text            #1B2A36.
 *
 * Dark mode is REAL for this package (manifest supportsDark: true):
 * the dark map below is a full authored delta — deep-navy
 * background and cards, the same orange primary, a brightened
 * price red — not an empty passthrough.
 *
 * Font tokens reference the shared brand stacks defined once in
 * app/globals.css (--font-brand-sans / --font-brand-display, perf
 * wave item 5); the resolved stacks are the platform allowlist's
 * Hind Siliguri-led stacks (THEME_FONT_STACKS in src/lib/themes.ts),
 * since this is a Bangla-first storefront.
 */
import type { ThemeTokens } from "@/lib/themes";

/** Signature hexes for the places a token class cannot land the
 *  exact colour (the navy header/footer surfaces — `--foreground`
 *  is the text colour, not the navy — the purple savings pill, and
 *  the WhatsApp/Call buttons). Everything else in the package uses
 *  token utilities. */
export const CIRCUIT_COLORS = {
  primary: "#F07D1A",
  navy: "#10222E",
  navyDeep: "#0B1822",
  savePurple: "#7126B0",
  priceRed: "#D92D20",
  gradientFrom: "#2563EB",
  gradientTo: "#06B6D4",
  whatsappGreen: "#1FA855",
  callNavy: "#1E3A8A",
} as const;

export const CIRCUIT_TOKENS: ThemeTokens = {
  light: {
    /* Brand Colors */
    "--primary": "28 88% 52%", // #F07D1A
    "--primary-foreground": "0 0% 100%",
    "--accent": "195 84% 45%", // #12A5D4 cyan-blue
    "--accent-foreground": "0 0% 100%",

    /* Backgrounds */
    "--background": "206 28% 95%", // #EFF3F6 pale tech grey
    "--foreground": "207 33% 16%", // #1B2A36
    "--card": "0 0% 100%",
    "--card-foreground": "207 33% 16%",
    "--muted": "206 32% 91%", // #E2EAF0
    "--muted-foreground": "207 19% 44%", // #5A7184
    "--popover": "0 0% 100%",
    "--popover-foreground": "207 33% 16%",

    /* UI Elements */
    "--secondary": "206 47% 91%", // #DEEAF3 pale blue tint
    "--secondary-foreground": "204 48% 12%", // #10222E navy
    "--border": "208 25% 87%", // #D5DEE6
    "--input": "208 22% 78%", // #BCC9D4
    "--ring": "28 88% 52%", // primary orange

    /* Semantic */
    "--destructive": "4 74% 49%", // #D92D20 — the price red
    "--destructive-foreground": "0 0% 100%",
    "--success": "154 67% 37%", // #1F9D66
    "--warning": "37 90% 48%", // #E8930C
    "--info": "221 83% 53%", // #2563EB

    /* Surfaces (RGB triplets) */
    "--c-surface": "255 255 255",
    "--c-surface-2": "239 243 246", // #EFF3F6
    "--c-bg-app": "239 243 246", // #EFF3F6
    "--c-text-main": "27 42 54", // #1B2A36
    "--c-text-muted": "90 113 132", // #5A7184
    "--c-text-subtle": "122 140 156", // #7A8C9C

    /* Gradients & Radius */
    "--brand-gradient": "linear-gradient(90deg, #2563eb 0%, #06b6d4 100%)",
    "--brand-soft-gradient": "linear-gradient(135deg, #e3edf7 0%, #eff3f6 100%)",
    // 10px at the platform's radius scale (rounded-md ===
    // var(--radius)): spacious, softly-rounded tech-store cards.
    "--radius": "0.625rem",

    /* Shadows — navy-tinted, a touch deeper than the grocery set:
       the cards are spacious and need a visible lift on hover. */
    "--shadow-card":
      "0 1px 3px rgba(16, 34, 46, 0.06), 0 6px 16px -8px rgba(16, 34, 46, 0.1)",
    "--shadow-lift":
      "0 2px 6px rgba(16, 34, 46, 0.07), 0 14px 28px -12px rgba(16, 34, 46, 0.16)",
    "--shadow-pop":
      "0 6px 16px rgba(16, 34, 46, 0.1), 0 24px 48px -12px rgba(16, 34, 46, 0.24)",

    /* Typography — the shared brand stacks by reference (perf wave
       item 5): the literal stacks live once in app/globals.css as
       --font-brand-sans / --font-brand-display; the resolved values
       are the allowlist's Hind Siliguri-led stacks, unchanged. */
    "--font-sans": "var(--font-brand-sans)",
    "--font-display": "var(--font-brand-display)",
  },
  /* Real dark delta (supportsDark: true): deep-navy surfaces, the
     same orange primary, a brightened price red so prices stay
     legible on dark cards. Keys the delta omits (radius, fonts,
     gradient) inherit the light values via the engine merge. */
  dark: {
    /* Brand Colors */
    "--primary": "28 88% 52%", // #F07D1A (unchanged)
    "--primary-foreground": "0 0% 100%",
    "--accent": "195 84% 45%", // #12A5D4
    "--accent-foreground": "0 0% 100%",

    /* Backgrounds */
    "--background": "206 51% 9%", // #0B1822 deep navy
    "--foreground": "208 35% 93%", // #E6EDF3
    "--card": "203 45% 13%", // #12242F
    "--card-foreground": "208 35% 93%",
    "--muted": "208 45% 16%", // #16293A
    "--muted-foreground": "208 21% 65%", // #93A7B8
    "--popover": "203 45% 13%", // #12242F
    "--popover-foreground": "208 35% 93%",

    /* UI Elements */
    "--secondary": "209 45% 19%", // #1B3247
    "--secondary-foreground": "208 35% 93%",
    "--border": "208 39% 22%", // #22394D
    "--input": "208 39% 22%", // #22394D
    "--ring": "28 88% 52%", // primary orange

    /* Semantic */
    "--destructive": "4 86% 58%", // #F04438 — brightened price red
    "--destructive-foreground": "0 0% 100%",
    "--success": "157 57% 49%", // #35C48D
    "--warning": "37 90% 48%", // #E8930C
    "--info": "221 83% 60%",

    /* Surfaces (RGB triplets) */
    "--c-surface": "18 36 47", // #12242F
    "--c-surface-2": "11 24 34", // #0B1822
    "--c-bg-app": "11 24 34", // #0B1822
    "--c-text-main": "230 237 243", // #E6EDF3
    "--c-text-muted": "147 167 184", // #93A7B8
    "--c-text-subtle": "111 133 152", // #6F8598

    /* Gradients — the CTA gradient holds; the soft gradient goes
       deep-navy so hero fallbacks stay dark. */
    "--brand-gradient": "linear-gradient(90deg, #2563eb 0%, #06b6d4 100%)",
    "--brand-soft-gradient": "linear-gradient(135deg, #12242f 0%, #0b1822 100%)",

    /* Shadows — true-black depth on dark surfaces. */
    "--shadow-card":
      "0 1px 3px rgba(0, 0, 0, 0.35), 0 6px 16px -8px rgba(0, 0, 0, 0.45)",
    "--shadow-lift":
      "0 2px 6px rgba(0, 0, 0, 0.4), 0 14px 28px -12px rgba(0, 0, 0, 0.55)",
    "--shadow-pop":
      "0 6px 16px rgba(0, 0, 0, 0.45), 0 24px 48px -12px rgba(0, 0, 0, 0.6)",
  },
};
