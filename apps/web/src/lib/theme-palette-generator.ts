/**
 * Color utilities and smart palette generator for themes.
 * Converts HEX to HSL and auto-generates balanced light and dark theme tokens
 * from a single primary brand color.
 */
import type { ThemeTokens } from "./themes";
import { THEME_TOKEN_META } from "./themes";

/**
 * Seed-independent structural tokens (shadows + fonts) are copied from
 * the catalogue defaults in THEME_TOKEN_META so a generated palette
 * always carries the FULL token catalogue — and its values can never
 * drift from globals.css. Shadows differ per mode (light/dark values in
 * globals.css); fonts do not (globals.css has no .dark font override),
 * so fonts are emitted in the light map only, exactly as
 * defaultThemeTokens() does.
 */
const STRUCTURAL_LIGHT: Record<string, string> = {
  "--shadow-card": THEME_TOKEN_META["--shadow-card"]!.lightDefault,
  "--shadow-lift": THEME_TOKEN_META["--shadow-lift"]!.lightDefault,
  "--shadow-pop": THEME_TOKEN_META["--shadow-pop"]!.lightDefault,
  "--font-sans": THEME_TOKEN_META["--font-sans"]!.lightDefault,
  "--font-display": THEME_TOKEN_META["--font-display"]!.lightDefault,
};

const STRUCTURAL_DARK: Record<string, string> = {
  "--shadow-card": THEME_TOKEN_META["--shadow-card"]!.darkDefault,
  "--shadow-lift": THEME_TOKEN_META["--shadow-lift"]!.darkDefault,
  "--shadow-pop": THEME_TOKEN_META["--shadow-pop"]!.darkDefault,
};

/** Parses hex (#RGB, #RRGGBB) to [h (0-360), s (0-100), l (0-100)] */
export function hexToHsl(hex: string): [number, number, number] {
  let cleaned = hex.replace(/^#/, "");
  if (cleaned.length === 3) {
    cleaned = cleaned
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const num = parseInt(cleaned, 16);
  if (isNaN(num)) return [240, 70, 60];

  const r = ((num >> 16) & 255) / 255;
  const g = ((num >> 8) & 255) / 255;
  const b = (num & 255) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h = Math.round(h * 60);
  }

  return [h, Math.round(s * 100), Math.round(l * 100)];
}

/** Converts HSL [h, s, l] to hex "#RRGGBB" */
export function hslToHex(h: number, s: number, l: number): string {
  const sNorm = s / 100;
  const lNorm = l / 100;
  const a = sNorm * Math.min(lNorm, 1 - lNorm);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = lNorm - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** Converts HSL to "R G B" space-separated triplet */
export function hslToRgbTriplet(h: number, s: number, l: number): string {
  const hex = hslToHex(h, s, l).replace("#", "");
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
}

/** Format HSL values into token format: "H S% L%" */
export function fmtHsl(h: number, s: number, l: number): string {
  return `${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}%`;
}

/**
 * Smart Palette Generator:
 * Takes a primary brand color (hex or hsl) and algorithmically creates a complete,
 * cohesive light and dark token set with proper WCAG contrast ratios.
 */
export function generateSmartPalette(primaryHex: string): {
  tokens: ThemeTokens;
  preview: string[];
} {
  const [h, s] = hexToHsl(primaryHex);

  // Accent color is shifted by 35 degrees on the color wheel
  const accentH = (h + 35) % 360;
  const secondaryH = (h + 200) % 360; // Complementary soft hue

  const primaryLightHsl = fmtHsl(h, Math.min(s, 85), 55);
  const primaryDarkHsl = fmtHsl(h, Math.min(s + 10, 90), 65);

  const accentLightHsl = fmtHsl(accentH, 85, 60);
  const accentDarkHsl = fmtHsl(accentH, 85, 68);

  const light: Record<string, string> = {
    // Brand
    "--primary": primaryLightHsl,
    "--primary-foreground": "0 0% 100%",
    "--accent": accentLightHsl,
    "--accent-foreground": "0 0% 100%",

    // Backgrounds & Surfaces
    "--background": fmtHsl(h, 25, 98),
    "--foreground": fmtHsl(h, 25, 15),
    "--card": "0 0% 100%",
    "--card-foreground": fmtHsl(h, 25, 15),
    "--popover": "0 0% 100%",
    "--popover-foreground": fmtHsl(h, 25, 15),
    "--muted": fmtHsl(h, 20, 95),
    "--muted-foreground": fmtHsl(h, 15, 45),

    // UI Elements
    "--secondary": fmtHsl(secondaryH, 30, 96),
    "--secondary-foreground": fmtHsl(secondaryH, 60, 30),
    "--border": fmtHsl(h, 20, 91),
    "--input": fmtHsl(h, 20, 88),
    "--ring": fmtHsl(h, 75, 65),
    "--radius": "0.75rem",

    // Semantic
    "--destructive": "347 77% 50%",
    "--destructive-foreground": "0 0% 100%",
    "--success": "161 94% 30%",
    "--warning": "32 95% 44%",
    "--info": "201 98% 37%",

    // RGB Triplets
    "--c-surface": "255 255 255",
    "--c-surface-2": hslToRgbTriplet(h, 15, 96),
    "--c-bg-app": hslToRgbTriplet(h, 20, 98),
    "--c-text-main": hslToRgbTriplet(h, 25, 15),
    "--c-text-muted": hslToRgbTriplet(h, 15, 45),
    "--c-text-subtle": hslToRgbTriplet(h, 12, 55),

    // Gradients
    "--brand-gradient": `linear-gradient(135deg, ${hslToHex(h, s, 55)} 0%, ${hslToHex(accentH, 80, 58)} 100%)`,
    "--brand-soft-gradient": `linear-gradient(135deg, ${hslToHex(h, 40, 96)} 0%, ${hslToHex(accentH, 40, 97)} 100%)`,

    // Shadows & Fonts (seed-independent catalogue defaults)
    ...STRUCTURAL_LIGHT,
  };

  const dark: Record<string, string> = {
    // Brand
    "--primary": primaryDarkHsl,
    "--primary-foreground": fmtHsl(h, 30, 10),
    "--accent": accentDarkHsl,
    "--accent-foreground": fmtHsl(accentH, 30, 10),

    // Backgrounds & Surfaces
    "--background": fmtHsl(h, 28, 8),
    "--foreground": fmtHsl(h, 20, 96),
    "--card": fmtHsl(h, 24, 13),
    "--card-foreground": fmtHsl(h, 20, 96),
    "--popover": fmtHsl(h, 24, 13),
    "--popover-foreground": fmtHsl(h, 20, 96),
    "--muted": fmtHsl(h, 20, 18),
    "--muted-foreground": fmtHsl(h, 15, 68),

    // UI Elements
    "--secondary": fmtHsl(secondaryH, 20, 20),
    "--secondary-foreground": fmtHsl(secondaryH, 40, 90),
    "--border": fmtHsl(h, 20, 22),
    "--input": fmtHsl(h, 20, 22),
    "--ring": fmtHsl(h, 75, 70),

    // Semantic
    "--destructive": "349 90% 62%",

    // RGB Triplets
    "--c-surface": hslToRgbTriplet(h, 24, 13),
    "--c-surface-2": hslToRgbTriplet(h, 22, 17),
    "--c-bg-app": hslToRgbTriplet(h, 28, 8),
    "--c-text-main": hslToRgbTriplet(h, 20, 95),
    "--c-text-muted": hslToRgbTriplet(h, 15, 68),
    "--c-text-subtle": hslToRgbTriplet(h, 12, 58),

    // Dark Soft Gradient
    "--brand-soft-gradient": `linear-gradient(135deg, ${hslToHex(h, 30, 14)} 0%, ${hslToHex(accentH, 30, 16)} 100%)`,

    // Shadows (dark catalogue defaults; fonts inherit the light map)
    ...STRUCTURAL_DARK,
  };

  const preview = [
    hslToHex(h, s, 55),
    hslToHex(accentH, 85, 60),
    hslToHex(h, 25, 96),
  ];

  return { tokens: { light, dark }, preview };
}
