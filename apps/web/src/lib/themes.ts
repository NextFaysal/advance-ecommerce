/**
 * Theme system — type definitions, token catalogue, and built-in defaults.
 *
 * HSL token format:  "H S% L%"   (no hsl() wrapper — used as CSS var values)
 * RGB token format:  "R G B"     (space-separated, used with rgb() in CSS)
 * Gradient format:  full CSS gradient string
 * Length format:    CSS length value (e.g. "0.75rem")
 * Shadow format:    full CSS box-shadow string (e.g. "0 1px 2px rgba(0,0,0,.1)")
 * Font format:      a font-family stack chosen from THEME_FONT_STACKS only
 *                   (families the platform already loads — see app/layout.tsx)
 */

export interface ThemeTokens {
  /** Tokens to apply in light mode (:root). */
  light: Record<string, string>;
  /** Tokens that differ in dark mode (.dark). Merged on top of light for dark. */
  dark: Record<string, string>;
}

export interface AppTheme {
  id: string;
  /**
   * The theme PACKAGE this instance belongs to (doc 25 D1/D3) — an id
   * from the static registry in src/themes/registry.ts ("aurora", …).
   * An instance = package + token set (+ option values, stored
   * separately). Optional because catalogs saved before the package
   * system existed carry no packageId: the repository's read path
   * lazily resolves a missing value to "aurora" (doc 25 §5.2 — no
   * data migration, no write on read). Unknown ids also resolve to
   * Aurora at resolution time (src/themes/resolution.ts), never crash.
   */
  packageId?: string;
  name: string;
  description?: string;
  /** 3 hex colors for the swatch preview chip (e.g. primary, accent, background). */
  preview: string[];
  /** Published to the customer theme picker (Account → Preferences). */
  isActive: boolean;
  /**
   * The store's default theme: applied to every visitor who has not
   * picked their own theme. Exclusive — at most one theme in the
   * catalog carries this flag; set it via setStoreDefaultTheme()
   * (Admin → Appearance → "স্টোরে প্রয়োগ করুন"), never by hand-editing
   * isActive. Optional because catalogs saved before this field
   * existed simply have no store default (visitors then see the
   * globals.css defaults, exactly as before).
   */
  isStoreDefault?: boolean;
  tokens: ThemeTokens;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ */
/* Token groups — used by the editor UI to group related tokens        */
/* ------------------------------------------------------------------ */

export const THEME_TOKEN_GROUPS = [
  {
    label: "Brand Colors",
    tokens: ["--primary", "--primary-foreground", "--accent", "--accent-foreground"],
  },
  {
    label: "Backgrounds",
    tokens: [
      "--background",
      "--foreground",
      "--card",
      "--card-foreground",
      "--muted",
      "--muted-foreground",
      "--popover",
      "--popover-foreground",
    ],
  },
  {
    label: "UI Elements",
    tokens: ["--secondary", "--secondary-foreground", "--border", "--input", "--ring"],
  },
  {
    label: "Semantic",
    tokens: [
      "--destructive",
      "--destructive-foreground",
      "--success",
      "--warning",
      "--info",
    ],
  },
  {
    label: "Surfaces (RGB)",
    tokens: [
      "--c-surface",
      "--c-surface-2",
      "--c-bg-app",
      "--c-text-main",
      "--c-text-muted",
      "--c-text-subtle",
    ],
  },
  {
    label: "Gradients & Radius",
    tokens: ["--brand-gradient", "--brand-soft-gradient", "--radius"],
  },
  {
    label: "Shadows",
    tokens: ["--shadow-card", "--shadow-lift", "--shadow-pop"],
  },
  {
    label: "Typography",
    tokens: ["--font-sans", "--font-display"],
  },
] as const;

/* ------------------------------------------------------------------ */
/* Token metadata — label, type, light/dark defaults from globals.css  */
/* ------------------------------------------------------------------ */

export type TokenType = "hsl" | "rgb" | "gradient" | "length" | "shadow" | "font";

/**
 * The fixed font-stack allowlist for the "font" tokens (--font-sans,
 * --font-display). Every stack is built ONLY from families the platform
 * already loads via Google Fonts in app/layout.tsx (Plus Jakarta Sans,
 * Hind Siliguri, Noto Sans Bengali) plus generic fallbacks — a theme can
 * reorder/reweight those families but can never introduce a new one
 * (doc 25 §1.3.3). The meta entries below reference these stacks as their
 * `options`; defaults and the palette generator only ever emit values
 * from this list.
 */
export const THEME_FONT_STACKS: { id: string; label: string; value: string }[] = [
  {
    id: "jakarta",
    label: "Plus Jakarta Sans (platform default)",
    value:
      '"Plus Jakarta Sans", "Hind Siliguri", "Noto Sans Bengali", system-ui, -apple-system, "Segoe UI", sans-serif',
  },
  {
    id: "siliguri-display",
    label: "Hind Siliguri first (display default)",
    value: '"Hind Siliguri", "Plus Jakarta Sans", "Noto Sans Bengali", system-ui, sans-serif',
  },
  {
    id: "siliguri",
    label: "Hind Siliguri first (Bengali-first)",
    value: '"Hind Siliguri", "Noto Sans Bengali", "Plus Jakarta Sans", system-ui, sans-serif',
  },
  {
    id: "noto",
    label: "Noto Sans Bengali first",
    value: '"Noto Sans Bengali", "Hind Siliguri", "Plus Jakarta Sans", system-ui, sans-serif',
  },
];

/** The stack values alone — the `options` list carried by font tokens. */
export const THEME_FONT_STACK_VALUES: string[] = THEME_FONT_STACKS.map((s) => s.value);

export const THEME_TOKEN_META: Record<
  string,
  {
    label: string;
    type: TokenType;
    lightDefault: string;
    darkDefault: string;
    /** Fixed value allowlist — set only on "font" tokens (see THEME_FONT_STACKS). */
    options?: string[];
  }
> = {
  // --- Brand Colors ---
  "--primary": {
    label: "Primary",
    type: "hsl",
    lightDefault: "243 75% 59%",
    darkDefault: "239 84% 67%",
  },
  "--primary-foreground": {
    label: "Primary Foreground",
    type: "hsl",
    lightDefault: "0 0% 100%",
    darkDefault: "236 37% 9%",
  },
  "--accent": {
    label: "Accent",
    type: "hsl",
    lightDefault: "258 90% 66%",
    darkDefault: "258 90% 70%",
  },
  "--accent-foreground": {
    label: "Accent Foreground",
    type: "hsl",
    lightDefault: "0 0% 100%",
    darkDefault: "236 37% 9%",
  },

  // --- Backgrounds ---
  "--background": {
    label: "Background",
    type: "hsl",
    lightDefault: "230 60% 98%",
    darkDefault: "236 37% 9%",
  },
  "--foreground": {
    label: "Foreground",
    type: "hsl",
    lightDefault: "238 28% 16%",
    darkDefault: "236 100% 96%",
  },
  "--card": {
    label: "Card",
    type: "hsl",
    lightDefault: "0 0% 100%",
    darkDefault: "238 33% 14%",
  },
  "--card-foreground": {
    label: "Card Foreground",
    type: "hsl",
    lightDefault: "238 28% 16%",
    darkDefault: "236 100% 96%",
  },
  "--muted": {
    label: "Muted",
    type: "hsl",
    lightDefault: "232 45% 96%",
    darkDefault: "238 30% 18%",
  },
  "--muted-foreground": {
    label: "Muted Foreground",
    type: "hsl",
    lightDefault: "233 14% 42%",
    darkDefault: "234 25% 70%",
  },
  "--popover": {
    label: "Popover",
    type: "hsl",
    lightDefault: "0 0% 100%",
    darkDefault: "238 33% 14%",
  },
  "--popover-foreground": {
    label: "Popover Foreground",
    type: "hsl",
    lightDefault: "238 28% 16%",
    darkDefault: "236 100% 96%",
  },

  // --- UI Elements ---
  "--secondary": {
    label: "Secondary",
    type: "hsl",
    lightDefault: "226 100% 97%",
    darkDefault: "238 30% 20%",
  },
  "--secondary-foreground": {
    label: "Secondary Foreground",
    type: "hsl",
    lightDefault: "243 75% 40%",
    darkDefault: "236 100% 90%",
  },
  "--border": {
    label: "Border",
    type: "hsl",
    lightDefault: "230 35% 93%",
    darkDefault: "236 31% 24%",
  },
  "--input": {
    label: "Input",
    type: "hsl",
    lightDefault: "230 35% 90%",
    darkDefault: "236 31% 24%",
  },
  "--ring": {
    label: "Ring",
    type: "hsl",
    lightDefault: "239 84% 67%",
    darkDefault: "239 84% 72%",
  },

  // --- Semantic ---
  "--destructive": {
    label: "Destructive",
    type: "hsl",
    lightDefault: "347 77% 50%",
    darkDefault: "349 90% 62%",
  },
  "--destructive-foreground": {
    label: "Destructive Foreground",
    type: "hsl",
    lightDefault: "0 0% 100%",
    darkDefault: "0 0% 100%",
  },
  "--success": {
    label: "Success",
    type: "hsl",
    lightDefault: "161 94% 30%",
    darkDefault: "161 94% 30%",
  },
  "--warning": {
    label: "Warning",
    type: "hsl",
    lightDefault: "32 95% 44%",
    darkDefault: "32 95% 44%",
  },
  "--info": {
    label: "Info",
    type: "hsl",
    lightDefault: "201 98% 37%",
    darkDefault: "201 98% 37%",
  },

  // --- Surfaces (RGB) ---
  "--c-surface": {
    label: "Surface",
    type: "rgb",
    lightDefault: "255 255 255",
    darkDefault: "23 24 48",
  },
  "--c-surface-2": {
    label: "Surface 2",
    type: "rgb",
    lightDefault: "243 244 251",
    darkDefault: "30 32 64",
  },
  "--c-bg-app": {
    label: "App Background",
    type: "rgb",
    lightDefault: "248 249 253",
    darkDefault: "13 14 26",
  },
  "--c-text-main": {
    label: "Text Main",
    type: "rgb",
    lightDefault: "31 32 55",
    darkDefault: "237 237 247",
  },
  "--c-text-muted": {
    label: "Text Muted",
    type: "rgb",
    lightDefault: "91 95 122",
    darkDefault: "166 169 196",
  },
  "--c-text-subtle": {
    label: "Text Subtle",
    type: "rgb",
    lightDefault: "96 103 132",
    darkDefault: "138 142 168",
  },

  // --- Gradients & Radius ---
  "--brand-gradient": {
    label: "Brand Gradient",
    type: "gradient",
    lightDefault: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 55%, #ec4899 100%)",
    darkDefault: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 55%, #ec4899 100%)",
  },
  "--brand-soft-gradient": {
    label: "Brand Soft Gradient",
    type: "gradient",
    lightDefault: "linear-gradient(135deg, #eef2ff 0%, #f5f3ff 100%)",
    darkDefault: "linear-gradient(135deg, #1e1b4b 0%, #2e1065 100%)",
  },
  "--radius": {
    label: "Border Radius",
    type: "length",
    lightDefault: "0.75rem",
    darkDefault: "0.75rem",
  },

  // --- Shadows (full box-shadow strings; values copied from globals.css) ---
  "--shadow-card": {
    label: "Shadow — Card",
    type: "shadow",
    lightDefault: "0 1px 2px rgba(49, 46, 129, 0.05), 0 8px 24px -12px rgba(79, 70, 229, 0.14)",
    darkDefault: "0 1px 2px rgba(0, 0, 0, 0.35), 0 8px 24px -12px rgba(0, 0, 0, 0.45)",
  },
  "--shadow-lift": {
    label: "Shadow — Lift (hover)",
    type: "shadow",
    lightDefault: "0 2px 4px rgba(49, 46, 129, 0.06), 0 16px 32px -12px rgba(79, 70, 229, 0.22)",
    darkDefault: "0 2px 4px rgba(0, 0, 0, 0.4), 0 16px 32px -12px rgba(0, 0, 0, 0.55)",
  },
  "--shadow-pop": {
    label: "Shadow — Pop (overlay)",
    type: "shadow",
    lightDefault: "0 4px 12px rgba(49, 46, 129, 0.08), 0 24px 48px -12px rgba(49, 46, 129, 0.28)",
    darkDefault: "0 4px 12px rgba(0, 0, 0, 0.45), 0 24px 48px -12px rgba(0, 0, 0, 0.6)",
  },

  // --- Typography (constrained: values only from THEME_FONT_STACKS) ---
  // globals.css defines no .dark override for the font vars, so
  // lightDefault === darkDefault and defaultThemeTokens() keeps them in
  // the light map only (dark rendering inherits the :root value).
  "--font-sans": {
    label: "Font — Body (sans)",
    type: "font",
    lightDefault:
      '"Plus Jakarta Sans", "Hind Siliguri", "Noto Sans Bengali", system-ui, -apple-system, "Segoe UI", sans-serif',
    darkDefault:
      '"Plus Jakarta Sans", "Hind Siliguri", "Noto Sans Bengali", system-ui, -apple-system, "Segoe UI", sans-serif',
    options: THEME_FONT_STACK_VALUES,
  },
  "--font-display": {
    label: "Font — Display (headings)",
    type: "font",
    lightDefault: '"Hind Siliguri", "Plus Jakarta Sans", "Noto Sans Bengali", system-ui, sans-serif',
    darkDefault: '"Hind Siliguri", "Plus Jakarta Sans", "Noto Sans Bengali", system-ui, sans-serif',
    options: THEME_FONT_STACK_VALUES,
  },
};

/** All token keys, in display order (same as THEME_TOKEN_GROUPS). */
export const ALL_THEME_TOKEN_KEYS: string[] = THEME_TOKEN_GROUPS.flatMap(
  (g) => g.tokens as unknown as string[],
);

/** Build an AppTheme tokens object from the built-in globals.css defaults. */
export function defaultThemeTokens(): ThemeTokens {
  const light: Record<string, string> = {};
  const dark: Record<string, string> = {};
  for (const [key, meta] of Object.entries(THEME_TOKEN_META)) {
    light[key] = meta.lightDefault;
    if (meta.darkDefault !== meta.lightDefault) {
      dark[key] = meta.darkDefault;
    }
  }
  return { light, dark };
}
