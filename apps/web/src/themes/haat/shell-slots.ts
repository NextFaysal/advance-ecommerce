/**
 * Haat shell slots — Header + Footer (doc 25 §1.4).
 *
 * The client-safe half of the Haat slot map, mirroring
 * bazaar/shell-slots.ts: the storefront shell is a client
 * component and resolves Header/Footer through
 * client-slot-registry.tsx. HaatHeader and HaatFooter are both
 * client-safe (the footer is hook-free; it lives here because
 * the shell map's type requires both slots from one map).
 */
import HaatHeader from "./header";
import HaatFooter from "./footer";
import type { ThemeShellSlots } from "../slots";

export const HAAT_SHELL_SLOTS: ThemeShellSlots = {
  Header: HaatHeader,
  Footer: HaatFooter,
};
