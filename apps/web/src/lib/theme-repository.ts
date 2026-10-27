/**
 * Theme repository — server-side CRUD for AppTheme objects.
 *
 * All themes are stored as a single JSON blob in the Setting table under
 * key "theme.catalog", category "appearance", isPublic true.
 * This avoids schema migrations while keeping the data persistent and
 * admin-editable.
 *
 * Server-side only — do NOT import from client components.
 */
import { prisma } from "@advance-ecommerce/db";
import { randomUUID } from "crypto";
import type { AppTheme } from "./themes";
import { THEME_CATALOG_SETTING_KEY } from "./theme-engine";
import { DEFAULT_PACKAGE_ID } from "../themes/registry";

/* ------------------------------------------------------------------ */
/* Catalog read / write                                                */
/* ------------------------------------------------------------------ */

/* 60s in-process TTL cache around the catalog read: getThemeCatalog */
/* is on the render path (root layout resolves the active theme per  */
/* request), and the catalog changes only on admin theme writes. A   */
/* missing row caches as [] too; a DB ERROR is not cached, so a      */
/* transient failure never masks recovery for the whole TTL.         */
/* saveThemeCatalog() clears the cache so a save in this process is  */
/* visible on the very next read (other processes converge ≤60s).    */
const THEME_CATALOG_CACHE_TTL_MS = 60_000;
let themeCatalogCache: { at: number; catalog: AppTheme[] } | null = null;

/**
 * Lazy package transform (doc 25 §5.2, D7): catalog entries saved
 * before the package system have no packageId — they are Aurora
 * instances. The default is applied in the READ path only (idempotent,
 * no write on read); the first admin save after upgrade persists the
 * new shape via saveThemeCatalog(). Entries that already carry a
 * packageId pass through untouched — including unknown ids, which
 * resolution (src/themes/resolution.ts) falls back to Aurora for.
 */
function withDefaultPackageId(theme: AppTheme): AppTheme {
  return theme.packageId ? theme : { ...theme, packageId: DEFAULT_PACKAGE_ID };
}

export async function getThemeCatalog(): Promise<AppTheme[]> {
  if (
    themeCatalogCache !== null &&
    Date.now() - themeCatalogCache.at < THEME_CATALOG_CACHE_TTL_MS
  ) {
    return themeCatalogCache.catalog;
  }
  try {
    const row = await prisma.setting.findUnique({
      where: { key: THEME_CATALOG_SETTING_KEY },
    });
    if (!row) {
      themeCatalogCache = { at: Date.now(), catalog: [] };
      return [];
    }
    const catalog = (JSON.parse(row.value) as AppTheme[]).map(withDefaultPackageId);
    themeCatalogCache = { at: Date.now(), catalog };
    return catalog;
  } catch {
    return [];
  }
}

export async function saveThemeCatalog(themes: AppTheme[]): Promise<void> {
  await prisma.setting.upsert({
    where: { key: THEME_CATALOG_SETTING_KEY },
    update: { value: JSON.stringify(themes) },
    create: {
      key: THEME_CATALOG_SETTING_KEY,
      value: JSON.stringify(themes),
      isPublic: true,
      category: "appearance",
    },
  });
  themeCatalogCache = null;
}

/* ------------------------------------------------------------------ */
/* Individual theme operations                                         */
/* ------------------------------------------------------------------ */

export async function getThemeById(id: string): Promise<AppTheme | null> {
  const catalog = await getThemeCatalog();
  return catalog.find((t) => t.id === id) ?? null;
}

export async function getActiveTheme(): Promise<AppTheme | null> {
  const catalog = await getThemeCatalog();
  return catalog.find((t) => t.isActive) ?? null;
}

export async function createTheme(
  input: Omit<AppTheme, "id" | "createdAt" | "updatedAt">,
): Promise<AppTheme> {
  const catalog = await getThemeCatalog();
  const now = new Date().toISOString();
  const theme: AppTheme = { ...input, id: randomUUID(), createdAt: now, updatedAt: now };
  await saveThemeCatalog([...catalog, theme]);
  return theme;
}

export async function updateTheme(
  id: string,
  input: Partial<Omit<AppTheme, "id" | "createdAt">>,
): Promise<AppTheme> {
  const catalog = await getThemeCatalog();
  const idx = catalog.findIndex((t) => t.id === id);
  if (idx === -1) throw new Error(`Theme ${id} not found`);
  const updated: AppTheme = {
    ...catalog[idx]!,
    ...input,
    id,
    updatedAt: new Date().toISOString(),
  };
  catalog[idx] = updated;
  await saveThemeCatalog(catalog);
  return updated;
}

export async function deleteTheme(id: string): Promise<void> {
  const catalog = await getThemeCatalog();
  await saveThemeCatalog(catalog.filter((t) => t.id !== id));
}

/**
 * Set one theme as active and deactivate all others.
 * Pass null to clear the active theme.
 */
export async function setActiveTheme(id: string | null): Promise<void> {
  const catalog = await getThemeCatalog();
  const next = catalog.map((t) => ({ ...t, isActive: t.id === id }));
  await saveThemeCatalog(next);
}

/* ------------------------------------------------------------------ */
/* Store default theme                                                 */
/* ------------------------------------------------------------------ */

/**
 * The store default theme — the one applied to visitors who have not
 * picked a theme themselves. Distinct from isActive (which only
 * publishes a theme to the customer picker): a catalog may have
 * several published themes but at most one store default.
 */
export async function getStoreDefaultTheme(): Promise<AppTheme | null> {
  const catalog = await getThemeCatalog();
  return catalog.find((t) => t.isStoreDefault) ?? null;
}

/**
 * Set one theme as THE store default, clearing the flag on all
 * others. Pass null to clear the store default entirely (visitors
 * then fall back to the globals.css defaults). Throws when a non-null
 * id does not exist in the catalog. Returns the previous and next
 * store default themes so callers can audit the change.
 */
export async function setStoreDefaultTheme(
  id: string | null,
): Promise<{ previous: AppTheme | null; next: AppTheme | null }> {
  const catalog = await getThemeCatalog();
  const previous = catalog.find((t) => t.isStoreDefault) ?? null;
  if (id !== null && !catalog.some((t) => t.id === id)) {
    throw new Error(`Theme ${id} not found`);
  }
  const mapped = catalog.map((t) => ({ ...t, isStoreDefault: t.id === id }));
  await saveThemeCatalog(mapped);
  return { previous, next: mapped.find((t) => t.isStoreDefault) ?? null };
}
