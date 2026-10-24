/**
 * Storefront Shell — shared header + footer (Agent 31).
 *
 * MOUNT CONTRACT (for the main agent — this slice does NOT edit layouts):
 * The root layout (`app/layout.tsx`) wraps EVERYTHING including /admin,
 * so header/footer must be gated by pathname in a small client wrapper,
 * exactly like the existing `app/tracking-shell.tsx` pattern:
 *
 * ```tsx
 * // app/storefront-shell.tsx
 * "use client";
 * import { usePathname } from "next/navigation";
 * import type { ReactNode } from "react";
 * import { SiteFooter, SiteHeader } from "@/storefront-shell";
 *
 * // Storefront chrome shows on public routes only — never on /admin
 * // (its own shell) or /offline (bare fallback page).
 * const HIDDEN_PREFIXES = ["/admin", "/offline"];
 *
 * export default function StorefrontShell({ children }: { children: ReactNode }) {
 *   const pathname = usePathname();
 *   const hidden = HIDDEN_PREFIXES.some((p) => pathname?.startsWith(p));
 *   if (hidden) return <>{children}</>;
 *   return (
 *     <>
 *       <SiteHeader />
 *       {children}
 *       <SiteFooter />
 *     </>
 *   );
 * }
 * ```
 * Then in `app/layout.tsx`, inside <body> next to <RegisterSW /> /
 * <TrackingShell>: `<StorefrontShell>{children}</StorefrontShell>`
 * (nest it inside or beside TrackingShell — order between them does not
 * matter; keep TrackingShell's consent banner as the last element).
 * White-label: pass brandName from public settings once the settings
 * reader is wired, e.g. <SiteHeader brandName={publicBrandName} /> —
 * both components accept `brandName` props for exactly that.
 * Alternative accepted mount: move these into a future `app/(store)/layout.tsx`
 * plus the top-level public pages' layout — the pathname-gated wrapper
 * above is simpler and covers /, /track, /pay, /privacy etc. too.
 */
export { default as SiteHeader } from "./SiteHeader";
export type { SiteHeaderProps } from "./SiteHeader";
export { default as SiteFooter } from "./SiteFooter";
export type { SiteFooterProps } from "./SiteFooter";
