/**
 * Theme resolution — doc 25 §2.2 (D2).
 *
 * Pure, server-safe functions that turn the theme catalog + the store
 * pointer into a resolved theme. NO I/O, NO next/headers, NO component
 * references: callers (the S3 shell wrapper, admin APIs, tests) fetch
 * the catalog and hand it in.
 *
 * The headline output is `ThemeView` — a PLAIN SERIALISABLE object
 * that may cross the RSC boundary into client components (via the
 * context in theme-view.tsx). It contains no functions and no
 * component references, per the platform rule from the 2026-10-25
 * incident (never pass function props from server into client
 * components).
 *
 * Fallback discipline (doc 25 §4.4): every unknown — missing store
 * pointer, deleted instance, unregistered packageId — resolves to the
 * Aurora package with instanceId null (the "virtual built-in
 * instance": Aurora + globals.css defaults), which is exactly today's
 * rendering. Resolution never throws on bad data.
 */
import type { AppTheme } from "@/lib/themes";
import {
  DEFAULT_PACKAGE_ID,
  defaultThemeOptions,
  getThemePackageOrDefault,
  overlayThemeOptions,
  resolvePackageId,
  type ThemeOptions,
} from "./registry";

/* ------------------------------------------------------------------ */
/* ThemeView — the serialisable view leaf components consume          */
/* ------------------------------------------------------------------ */

export interface ThemeView {
  /** Registered package id (always valid — unknowns fall back). */
  packageId: string;
  /** Catalog instance id, or null for the virtual built-in instance. */
  instanceId: string | null;
  /** From the package manifest: hide/ignore the visitor colour layer. */
  lockPalette: boolean;
  /** From the package manifest: false → storefront forces light. */
  supportsDark: boolean;
  /**
   * Resolved option values: schema defaults overlaid with the
   * instance's stored values (theme.options.<instanceId>) when the
   * caller used a *WithOptions resolver; schema defaults only with
   * the plain S0 resolvers. Plain JSON data only.
   */
  options: ThemeOptions;
}

/** The safe default view — Aurora, no instance. Matches useThemeView's fallback. */
export const DEFAULT_THEME_VIEW: ThemeView = {
  packageId: DEFAULT_PACKAGE_ID,
  instanceId: null,
  lockPalette: false,
  supportsDark: true,
  options: {},
};

export interface ResolvedTheme {
  /** Registered package id (post-fallback). */
  packageId: string;
  /** The catalog instance, or null for the virtual built-in instance. */
  instance: AppTheme | null;
  /** Serialisable view for context/props. */
  themeView: ThemeView;
}

function buildResolved(
  instance: AppTheme | null,
  storedOptions?: Record<string, unknown> | null,
): ResolvedTheme {
  const packageId = resolvePackageId(instance?.packageId);
  const pkg = getThemePackageOrDefault(packageId);
  const themeView: ThemeView = {
    packageId: pkg.id,
    instanceId: instance?.id ?? null,
    lockPalette: pkg.lockPalette,
    supportsDark: pkg.supportsDark,
    // Options seam (filled in S2): when the caller supplies the
    // instance's RAW stored options, they are overlaid on the schema
    // defaults via overlayThemeOptions — which re-validates every
    // value at read (stored JSON is untrusted; an invalid value
    // falls back to its schema default, never crashes). Without
    // stored options this is exactly the S0 behaviour: defaults only.
    options: storedOptions
      ? overlayThemeOptions(pkg, storedOptions)
      : defaultThemeOptions(pkg),
  };
  return { packageId: pkg.id, instance, themeView };
}

/**
 * Raw stored option values by instance id — the shape a server caller
 * assembles from getThemeOptions() (src/themes/options.ts) for the
 * instances it is about to resolve, e.g.:
 *
 *   const stored = await getThemeOptions(instanceId);
 *   resolveStorefrontThemeWithOptions(catalog, storeId, {
 *     [instanceId]: stored,
 *   });
 *
 * Values are RAW (untrusted) JSON: the overlay validates them against
 * the package schema at resolution time.
 */
export type ThemeOptionsByInstance = Readonly<
  Record<string, Record<string, unknown>>
>;

/* ------------------------------------------------------------------ */
/* Storefront resolution (visitor layer 2 — the store instance)       */
/* ------------------------------------------------------------------ */

/**
 * Resolve the store's theme from the catalog + the store pointer.
 *
 * `storeDefaultId` is the instance id the foundation wave's store
 * pointer selects (the AppTheme carrying `isStoreDefault`, see
 * getStoreDefaultTheme() in src/lib/theme-repository.ts — callers pass
 * `storeDefault?.id ?? null`). Null/unknown → the virtual Aurora
 * instance (today's rendering, doc 25 §5.2).
 */
export function resolveStorefrontTheme(
  catalog: AppTheme[],
  storeDefaultId: string | null | undefined,
): ResolvedTheme {
  return resolveStorefrontThemeWithOptions(catalog, storeDefaultId, {});
}

/**
 * Options-aware sibling of resolveStorefrontTheme (S2): identical
 * resolution, except the resolved instance's ThemeView.options are
 * the schema defaults overlaid with `optionsByInstance[instance.id]`
 * (raw stored values, validated at read by the overlay). This is the
 * resolver S3's shell wrapper should call once it has fetched the
 * store instance's stored options.
 */
export function resolveStorefrontThemeWithOptions(
  catalog: AppTheme[],
  storeDefaultId: string | null | undefined,
  optionsByInstance: ThemeOptionsByInstance,
): ResolvedTheme {
  if (!storeDefaultId) return buildResolved(null);
  const instance = catalog.find((t) => t.id === storeDefaultId) ?? null;
  return buildResolved(instance, instance ? optionsByInstance[instance.id] : undefined);
}

/* ------------------------------------------------------------------ */
/* Preview resolution (visitor layer 1 — staff preview grant)         */
/* ------------------------------------------------------------------ */

/**
 * The minimal grant shape resolution needs. The full verified grant
 * (signature, staff binding, expiry) lives in preview.ts; resolution
 * deliberately depends only on this structural subset so it stays
 * pure and unit-verifiable without next/headers.
 */
export interface ThemePreviewGrantRef {
  instanceId: string;
}

/**
 * Resolve the theme a verified preview grant points at. An instance
 * deleted after the grant was minted resolves to the virtual Aurora
 * instance rather than crashing the preview render.
 */
export function resolvePreviewTheme(
  catalog: AppTheme[],
  grant: ThemePreviewGrantRef,
): ResolvedTheme {
  return resolvePreviewThemeWithOptions(catalog, grant, {});
}

/**
 * Options-aware sibling of resolvePreviewTheme (S2): the previewed
 * instance's ThemeView.options include its stored values (validated
 * at read by the overlay), so a staff preview shows the theme as it
 * is actually configured.
 */
export function resolvePreviewThemeWithOptions(
  catalog: AppTheme[],
  grant: ThemePreviewGrantRef,
  optionsByInstance: ThemeOptionsByInstance,
): ResolvedTheme {
  const instance = catalog.find((t) => t.id === grant.instanceId) ?? null;
  return buildResolved(instance, instance ? optionsByInstance[instance.id] : undefined);
}
