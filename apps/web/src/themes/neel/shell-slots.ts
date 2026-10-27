/**
 * Neel shell slots — Header + Footer (doc 25 §1.4; doc 27 T-E).
 *
 * The client-safe half of the Neel slot map, mirroring
 * bazaar/shell-slots.ts: the storefront shell is a client
 * component and resolves Header/Footer through
 * client-slot-registry.tsx. NeelHeader and NeelFooter are both
 * client-safe (the footer is hook-free; it lives here because
 * the shell map's type requires both slots from one map).
 */
import NeelHeader from "./header";
import NeelFooter from "./footer";
import type { ThemeShellSlots } from "../slots";

export const NEEL_SHELL_SLOTS: ThemeShellSlots = {
  Header: NeelHeader,
  Footer: NeelFooter,
};
