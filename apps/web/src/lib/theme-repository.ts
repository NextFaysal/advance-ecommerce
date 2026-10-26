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

/* ------------------------------------------------------------------ */
/* Catalog read / write                                                */
/* ------------------------------------------------------------------ */

export async function getThemeCatalog(): Promise<AppTheme[]> {
  try {
    const row = await prisma.setting.findUnique({
      where: { key: THEME_CATALOG_SETTING_KEY },
    });
    if (!row) return [];
    return JSON.parse(row.value) as AppTheme[];
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
