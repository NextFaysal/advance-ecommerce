/**
 * Neel theme — hand-authored token set (doc 27 T-E).
 *
 * NOT generator output: every value here is authored directly for
 * this package's blue marketplace palette and converted hex →
 * "H S% L%" triplet by hand. Colour tokens follow the platform
 * catalogue format (src/lib/themes.ts THEME_TOKEN_META): HSL
 * triplets for `hsl` tokens, "R G B" triplets for the `--c-*` RGB
 * tokens, full strings for gradients/shadows/fonts.
 *
 * Palette (this package's own design values):
 * - Primary blue   #1773B8 — prices' accents, primary actions,
 *   the header gradient's mid-stop.
 * - Deep blue      #0D5A8F — header gradient start.
 * - Bright blue    #2E97D6 — header gradient end.
 * - White          #FFFFFF — page background.
 * - Pale strip     #F2F6FA — top strip / muted surface.
 * - Warm orange    #F97A1F — accent: %-off badges, star tint,
 *   Buy Now — used sparingly against the blue.
 * - Text           #1B2A3A.
 *
 * Dark map is EMPTY by design: the engine merges the light map
 * under the dark delta, so the light look holds in dark mode. The
 * manifest's `supportsDark: false` (registry.ts) is the honest
 * declaration of that — this package is light-first.
 *
 * Font stacks are values from the platform allowlist
 * (THEME_FONT_STACKS in src/lib/themes.ts): the Hind Siliguri-led
 * stacks, since this is a Bangla-first layout.
 */
import type { ThemeTokens } from "@/lib/themes";

/** Signature hexes for the places a token class cannot land the
 *  exact colour (the header gradient — no single token carries a
 *  three-stop gradient — and a few badge chips). Everything else
 *  in the package uses token utilities. */
export const NEEL_COLORS = {
  primary: "#1773B8",
  deepBlue: "#0D5A8F",
  brightBlue: "#2E97D6",
  strip: "#F2F6FA",
  accentOrange: "#F97A1F",
  starAmber: "#F59E0B",
  savingGreen: "#1F9D66",
  whatsappGreen: "#1FA855",
  callNavy: "#1E3A8A",
} as const;

/** The header's blue gradient (this package's signature surface). */
export const NEEL_HEADER_GRADIENT =
  "linear-gradient(90deg, #0D5A8F 0%, #1773B8 55%, #2E97D6 100%)";

export const NEEL_TOKENS: ThemeTokens = {
  light: {
    /* Brand Colors */
    "--primary": "206 78% 41%", // #1773B8
    "--primary-foreground": "0 0% 100%",
    "--accent": "26 95% 55%", // #F97A1F warm orange
    "--accent-foreground": "0 0% 100%",

    /* Backgrounds */
    "--background": "0 0% 100%", // white
    "--foreground": "211 36% 17%", // #1B2A3A
    "--card": "0 0% 100%",
    "--card-foreground": "211 36% 17%",
    "--muted": "210 38% 96%", // #F2F6FA pale blue-grey
    "--muted-foreground": "208 15% 42%", // #5A6B7B
    "--popover": "0 0% 100%",
    "--popover-foreground": "211 36% 17%",

    /* UI Elements */
    "--secondary": "210 56% 95%", // #EAF2FA pale blue tint
    "--secondary-foreground": "206 82% 30%", // #0E5A8C deep blue
    "--border": "210 30% 90%", // #DEE7EF
    "--input": "208 30% 84%", // #C9D8E4
    "--ring": "206 78% 41%", // primary blue

    /* Semantic */
    "--destructive": "0 72% 51%", // #DC2626
    "--destructive-foreground": "0 0% 100%",
    "--success": "155 67% 37%", // #1F9D66
    "--warning": "37 90% 48%", // #E8930C
    "--info": "206 78% 41%", // primary blue

    /* Surfaces (RGB triplets) */
    "--c-surface": "255 255 255",
    "--c-surface-2": "242 246 250", // #F2F6FA
    "--c-bg-app": "255 255 255",
    "--c-text-main": "27 42 58", // #1B2A3A
    "--c-text-muted": "90 107 123", // #5A6B7B
    "--c-text-subtle": "122 138 154", // #7A8A9A

    /* Gradients & Radius */
    "--brand-gradient": "linear-gradient(90deg, #0D5A8F 0%, #1773B8 55%, #2E97D6 100%)",
    "--brand-soft-gradient": "linear-gradient(135deg, #EAF2FA 0%, #FFFFFF 100%)",
    // ~6px at the platform's radius scale (rounded-md === var(--radius)):
    // classic marketplace buttons are small-radius rectangles.
    "--radius": "0.375rem",

    /* Shadows — soft, tinted with the text colour. */
    "--shadow-card":
      "0 1px 2px rgba(27, 42, 58, 0.05), 0 4px 12px -8px rgba(27, 42, 58, 0.08)",
    "--shadow-lift":
      "0 2px 4px rgba(27, 42, 58, 0.06), 0 10px 20px -10px rgba(27, 42, 58, 0.14)",
    "--shadow-pop":
      "0 4px 12px rgba(27, 42, 58, 0.08), 0 20px 40px -12px rgba(27, 42, 58, 0.2)",

    /* Typography — allowlisted Hind Siliguri-led stacks. */
    "--font-sans":
      '"Hind Siliguri", "Noto Sans Bengali", "Plus Jakarta Sans", system-ui, sans-serif',
    "--font-display":
      '"Hind Siliguri", "Plus Jakarta Sans", "Noto Sans Bengali", system-ui, sans-serif',
  },
  // Light-first package: no dark delta (see header comment).
  dark: {},
};
