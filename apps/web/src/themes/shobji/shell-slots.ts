/**
 * Shobji shell slots — Header + Footer (doc 25 §1.4; doc 27 T-B).
 *
 * The client-safe half of the Shobji slot map, mirroring
 * bazaar/shell-slots.ts: the storefront shell is a client component
 * and resolves Header/Footer through client-slot-registry.tsx.
 * ShobjiHeader and ShobjiFooter are both client-safe (the footer is
 * hook-free; it lives here because the shell map's type requires
 * both slots from one map).
 */
import ShobjiHeader from "./header";
import ShobjiFooter from "./footer";
import type { ThemeShellSlots } from "../slots";

export const SHOBJI_SHELL_SLOTS: ThemeShellSlots = {
  Header: ShobjiHeader,
  Footer: ShobjiFooter,
};
