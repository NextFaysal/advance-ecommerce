/**
 * Server-side storefront theme resolution — doc 25 §2.2 (wave S3a).
 *
 * The one place composition roots (the ThemeShell wrapper, the home
 * page) turn store state into a ResolvedTheme:
 *
 *   catalog (theme-repository, 60s in-process cache)
 *   + store pointer (the AppTheme flagged isStoreDefault)
 *   + the instance's stored options (theme.options.<id>, when an
 *     instance is actually pointed at)
 *   → resolveStorefrontThemeWithOptions()
 *
 * ISR discipline: this reads ONLY store-global data — no cookies(),
 * no headers(), no request APIs — so pages keep their current
 * rendering modes and revalidate windows; activation propagates
 * within those windows, and the store-default API route additionally
 * calls revalidatePath("/", "layout") so a switch applies
 * immediately. The staff preview grant (preview.ts) is deliberately
 * NOT consulted here: slot rendering follows the store pointer only
 * in this wave.
 *
 * Fail-safe: the repository returns [] on DB errors and resolution
 * falls back to the virtual Aurora instance (resolution.ts), so a
 * resolution failure renders exactly today's storefront.
 *
 * SERVER-ONLY: imports Prisma-backed modules (theme-repository,
 * options). Never import from a client component.
 */
import { getStoreDefaultTheme, getThemeCatalog } from "@/lib/theme-repository";
import { getThemeOptions } from "./options";
import {
  resolveStorefrontThemeWithOptions,
  type ResolvedTheme,
} from "./resolution";

export async function resolveStorefrontThemeFromStore(): Promise<ResolvedTheme> {
  const [catalog, storeDefault] = await Promise.all([
    getThemeCatalog(),
    getStoreDefaultTheme(),
  ]);
  const storeDefaultId = storeDefault?.id ?? null;
  // Stored options exist only for a real instance; the virtual
  // Aurora instance (no store pointer) resolves with schema
  // defaults, so the options read is skipped entirely then.
  const storedOptions = storeDefaultId
    ? await getThemeOptions(storeDefaultId)
    : null;
  return resolveStorefrontThemeWithOptions(
    catalog,
    storeDefaultId,
    storedOptions && storeDefaultId ? { [storeDefaultId]: storedOptions } : {},
  );
}
