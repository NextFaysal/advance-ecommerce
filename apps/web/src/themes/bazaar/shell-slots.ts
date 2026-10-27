/**
 * Bazaar shell slots — Header + Footer (doc 25 §1.4, wave S4a).
 *
 * The client-safe half of the Bazaar slot map, mirroring
 * aurora/shell-slots.ts: the storefront shell is a client component
 * and resolves Header/Footer through client-slot-registry.tsx.
 * BazaarHeader and BazaarFooter are both client-safe (the footer is
 * hook-free; it lives here because the shell map's type requires
 * both slots from one map).
 */
import BazaarHeader from "./header";
import BazaarFooter from "./footer";
import type { ThemeShellSlots } from "../slots";

export const BAZAAR_SHELL_SLOTS: ThemeShellSlots = {
  Header: BazaarHeader,
  Footer: BazaarFooter,
};
