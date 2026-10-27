/**
 * Aurora shell slots — Header + Footer (doc 25 §1.4, wave S3a).
 *
 * Aurora's Header/Footer ARE the platform's existing SiteHeader /
 * SiteFooter, registered in place — no wrappers, because their prop
 * types already ARE the slot contracts (see src/themes/slots.ts).
 *
 * This module is the client-safe half of the Aurora slot map: the
 * storefront shell (app/storefront-shell.tsx) is a client component,
 * and everything it imports enters the client bundle. SiteHeader is
 * already a client component and SiteFooter is hook-free, so both
 * are safe here. The HomeSections slot is deliberately NOT in this
 * file: its composition renders async server sections (flash-sale,
 * spin-wheel, recent-orders wrappers that read repositories), which
 * must never be pulled into the client graph — it lives in the full
 * server-side map (./slots.ts) instead.
 */
import { SiteFooter, SiteHeader } from "@/storefront-shell";
import type { ThemeShellSlots } from "../slots";

export const AURORA_SHELL_SLOTS: ThemeShellSlots = {
  Header: SiteHeader,
  Footer: SiteFooter,
};
