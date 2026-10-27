/**
 * Boighor shell slots — Header + Footer (doc 25 §1.4).
 *
 * The client-safe half of the Boighor slot map, mirroring
 * bazaar/shell-slots.ts: the storefront shell is a client
 * component and resolves Header/Footer through
 * client-slot-registry.tsx. BoighorHeader and BoighorFooter are
 * both client-safe (the footer is hook-free; it lives here
 * because the shell map's type requires both slots from one map).
 */
import BoighorHeader from "./header";
import BoighorFooter from "./footer";
import type { ThemeShellSlots } from "../slots";

export const BOIGHOR_SHELL_SLOTS: ThemeShellSlots = {
  Header: BoighorHeader,
  Footer: BoighorFooter,
};
