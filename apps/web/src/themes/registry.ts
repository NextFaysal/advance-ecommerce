/**
 * Theme package registry — doc 25 §1 (D1).
 *
 * A theme is a CODE package in this repo, registered here statically.
 * Packages are never DB rows and never uploaded: the catalog
 * (Setting "theme.catalog") stores INSTANCES (a packageId + a token
 * set); this registry is the source of truth for what packages exist
 * and what each one declares (manifest, options schema, capabilities).
 *
 * This module is intentionally import-free (pure types + data) so it
 * can be consumed from server modules, client components, and the
 * theme repository alike without pulling component code into any of
 * them. Slot COMPONENTS are wired in S3/S4 (aurora/ghorer slots.ts);
 * the registry's `slots` field stays an empty placeholder map until
 * then — resolution never reads components in S0.
 *
 * Safety (doc 25 §4): an unknown package id NEVER crashes resolution —
 * `resolvePackageId` / `getThemePackageOrDefault` fall back to Aurora.
 */

/* ------------------------------------------------------------------ */
/* Slot names (doc 25 §1.4) — the exhaustive list of layout seams a   */
/* theme package may fill. Anything not listed here is platform code  */
/* a theme cannot reach (checkout logic, pricing, order placement,    */
/* auth, admin).                                                      */
/* ------------------------------------------------------------------ */

export type ThemeSlotName =
  | "Header"
  | "Footer"
  | "HomeSections"
  | "ProductCard"
  | "ShopChrome"
  | "PdpComposition"
  | "CartPage"
  | "CartDrawer"
  | "CheckoutSkin";

export const THEME_SLOT_NAMES: readonly ThemeSlotName[] = [
  "Header",
  "Footer",
  "HomeSections",
  "ProductCard",
  "ShopChrome",
  "PdpComposition",
  "CartPage",
  "CartDrawer",
  "CheckoutSkin",
] as const;

/* ------------------------------------------------------------------ */
/* Options schema (doc 25 §1.5) — typed, merchant-facing settings a   */
/* package declares. Options are DATA, never code: values are         */
/* validated against this schema on save and on read (S2 wires the    */
/* validator + Customizer form renderer).                            */
/* ------------------------------------------------------------------ */

export type ThemeOptionField =
  | {
      key: string;
      type: "boolean";
      label: string;
      labelBn?: string;
      default: boolean;
    }
  | {
      key: string;
      type: "select";
      label: string;
      labelBn?: string;
      choices: { value: string; label: string }[];
      default: string;
    }
  | {
      key: string;
      type: "number";
      label: string;
      labelBn?: string;
      default: number;
      min: number;
      max: number;
    }
  | {
      key: string;
      type: "color";
      label: string;
      labelBn?: string;
      /** Hex colour, e.g. "#f5801f". */
      default: string;
    }
  | {
      key: string;
      type: "text";
      label: string;
      labelBn?: string;
      default: string;
      maxLength: number;
    };

/** A resolved option value — always plain JSON data (ThemeView-safe). */
export type ThemeOptionValue = boolean | number | string;
export type ThemeOptions = Record<string, ThemeOptionValue>;

/* ------------------------------------------------------------------ */
/* Theme package                                                        */
/* ------------------------------------------------------------------ */

export interface ThemePackage {
  /** Package id — matches the directory name under src/themes/. */
  id: string;
  /** Display name (admin). */
  name: string;
  nameBn?: string;
  /** Semver of the package (code), not of any instance. */
  version: string;
  author: string;
  /** Honest one-liner: what activating this package changes. */
  description: string;
  /** 3 hex swatches for gallery cards (same shape as AppTheme.preview). */
  preview: string[];
  /**
   * true → the visitor colour picker is hidden and the visitor colour
   * layer is ignored under this package: its palette is a designed
   * system that arbitrary recolouring would break (doc 25 §2.5).
   */
  lockPalette: boolean;
  /** false → the storefront forces light mode under this package. */
  supportsDark: boolean;
  /** Typed merchant options (doc 25 §1.5). Empty = no options yet. */
  optionsSchema: ThemeOptionField[];
  /**
   * Slot → component map. EMPTY in S0 by design: slot components are
   * registered in S3 (aurora) and S4 (ghorer). Values are typed
   * `unknown` here so this module stays free of component imports;
   * S3 narrows the contract in src/themes/shared/ (slot prop types).
   */
  slots: Partial<Record<ThemeSlotName, unknown>>;
}

/** The package every fallback lands on (doc 25 §4.4). */
export const DEFAULT_PACKAGE_ID = "aurora";

/* ------------------------------------------------------------------ */
/* Built-in packages                                                    */
/* ------------------------------------------------------------------ */

/**
 * Theme #1 — Aurora: the platform's current design, registered in
 * place. Its identity is "what the platform already looks like"
 * (globals.css token defaults), so it needs no new design work.
 * Preview swatches are the token defaults as hex: primary
 * (243 75% 59% ≈ #4F46E5), accent (258 90% 66% ≈ #8B5CF6),
 * background (230 60% 98% ≈ #F7F8FE).
 */
export const AURORA_PACKAGE: ThemePackage = {
  id: "aurora",
  name: "Aurora",
  nameBn: "অরোরা",
  version: "1.0.0",
  author: "Advance Commerce",
  description:
    "The platform's built-in design — the current storefront look (header, sections, cards and pages as shipped).",
  preview: ["#4f46e5", "#8b5cf6", "#f7f8fe"],
  lockPalette: false,
  supportsDark: true,
  optionsSchema: [],
  slots: {},
};

/**
 * Theme #2 — Bazaar: a grocery-store layout package (doc 24's spec,
 * built on doc 25 in wave S4). Two-tier header with a deep-green
 * category bar, five-column footer, square-image grocery cards with
 * an outline add-to-cart, a slide-in cart drawer and floating cart/
 * support buttons. Palette is a designed system (orange primary,
 * deep green, warm cream) — hence lockPalette — and the layout is
 * light-first, hence supportsDark: false. Every option below is
 * consumed by the package's components (S4a header/cards; the two
 * home toggles are read by S4b's home composition).
 */
export const BAZAAR_PACKAGE: ThemePackage = {
  id: "bazaar",
  name: "Bazaar",
  nameBn: "বাজার",
  version: "1.0.0",
  author: "Advance Commerce",
  description:
    "A grocery-store layout — two-tier header with category bar, square product cards, cart drawer, floating cart and support buttons, five-column footer. Best for food, grocery and daily-essentials stores.",
  preview: ["#F5801F", "#102E2A", "#FFFBF5"],
  lockPalette: true,
  supportsDark: false,
  optionsSchema: [
    {
      key: "showFloatingCart",
      type: "boolean",
      label: "Floating cart tab",
      labelBn: "ভাসমান কার্ট ট্যাব",
      default: true,
    },
    {
      key: "showSupportButtons",
      type: "boolean",
      label: "Floating call/chat buttons",
      labelBn: "ভাসমান কল/চ্যাট বাটন",
      default: true,
    },
    {
      key: "cardStyle",
      type: "select",
      label: "Product card style",
      labelBn: "পণ্য কার্ডের স্টাইল",
      choices: [{ value: "classic", label: "Classic (ক্লাসিক)" }],
      default: "classic",
    },
    {
      key: "homeShowBrands",
      type: "boolean",
      label: "Show brands row on home",
      labelBn: "হোমে ব্র্যান্ড সেকশন দেখান",
      default: true,
    },
    {
      key: "homeShowTestimonials",
      type: "boolean",
      label: "Show testimonials on home",
      labelBn: "হোমে ক্রেতাদের মতামত দেখান",
      default: true,
    },
  ],
  slots: {},
};

const THEME_PACKAGES: ReadonlyMap<string, ThemePackage> = new Map([
  [AURORA_PACKAGE.id, AURORA_PACKAGE],
  [BAZAAR_PACKAGE.id, BAZAAR_PACKAGE],
]);

/* ------------------------------------------------------------------ */
/* Lookups                                                              */
/* ------------------------------------------------------------------ */

/** All registered packages, in registration order. */
export function listThemePackages(): ThemePackage[] {
  return [...THEME_PACKAGES.values()];
}

/** Pure lookup — undefined for an unregistered id. */
export function getThemePackage(id: string | null | undefined): ThemePackage | undefined {
  if (!id) return undefined;
  return THEME_PACKAGES.get(id);
}

export function isThemePackageId(id: string | null | undefined): boolean {
  return getThemePackage(id) !== undefined;
}

/**
 * Normalise any stored/foreign package id to a registered one:
 * unknown or missing ids resolve to the default package (Aurora).
 * This is the ONLY way resolution should consume a raw packageId.
 */
export function resolvePackageId(id: string | null | undefined): string {
  return getThemePackage(id)?.id ?? DEFAULT_PACKAGE_ID;
}

/** Package lookup with the Aurora fallback built in — never undefined. */
export function getThemePackageOrDefault(id: string | null | undefined): ThemePackage {
  return getThemePackage(id) ?? (THEME_PACKAGES.get(DEFAULT_PACKAGE_ID) as ThemePackage);
}

/** Schema defaults as a plain options object ({} for an empty schema). */
export function defaultThemeOptions(pkg: ThemePackage): ThemeOptions {
  const out: ThemeOptions = {};
  for (const field of pkg.optionsSchema) {
    out[field.key] = field.default;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Option value validation (doc 25 §1.5) — the single source of the   */
/* per-field rules, kept PURE in this import-free module on purpose:  */
/* the strict API validator (src/themes/options.ts, server-only) and  */
/* the read-path overlay (src/themes/resolution.ts, which feeds the   */
/* CLIENT ThemeView context and must never transitively import        */
/* Prisma) both build on this core, so the rules can never drift.     */
/* ------------------------------------------------------------------ */

const THEME_COLOR_HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Type-check one raw (untrusted) value against a schema field.
 * Returns the value unchanged when valid, `undefined` when invalid —
 * strict, no string→number/boolean coercion: stored JSON and API
 * payloads must already carry the declared JSON type.
 *
 * Rules per type:
 * - boolean: must be a boolean.
 * - number:  must be a finite number, within [min, max] when declared.
 * - select:  must be one of the declared choice values.
 * - color:   must be a hex string (#RGB or #RRGGBB).
 * - text:    must be a string, within maxLength when declared.
 */
export function coerceThemeOptionValue(
  field: ThemeOptionField,
  value: unknown,
): ThemeOptionValue | undefined {
  switch (field.type) {
    case "boolean":
      return typeof value === "boolean" ? value : undefined;
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
      if (typeof field.min === "number" && value < field.min) return undefined;
      if (typeof field.max === "number" && value > field.max) return undefined;
      return value;
    }
    case "select":
      return typeof value === "string" &&
        field.choices.some((c) => c.value === value)
        ? value
        : undefined;
    case "color":
      return typeof value === "string" && THEME_COLOR_HEX_RE.test(value)
        ? value
        : undefined;
    case "text": {
      if (typeof value !== "string") return undefined;
      if (typeof field.maxLength === "number" && value.length > field.maxLength) {
        return undefined;
      }
      return value;
    }
  }
}

/**
 * Effective options for a package: schema defaults overlaid with the
 * VALID entries of a stored options object. Unknown keys are dropped;
 * an invalid stored value falls back to that field's schema default.
 * Never throws on bad input — stored JSON is untrusted (doc 25 §1.5:
 * validated on write AND on read).
 */
export function overlayThemeOptions(
  pkg: ThemePackage,
  stored: Record<string, unknown> | null | undefined,
): ThemeOptions {
  const out = defaultThemeOptions(pkg);
  if (!stored || typeof stored !== "object") return out;
  for (const field of pkg.optionsSchema) {
    if (!Object.prototype.hasOwnProperty.call(stored, field.key)) continue;
    const value = coerceThemeOptionValue(field, stored[field.key]);
    if (value !== undefined) out[field.key] = value;
  }
  return out;
}
