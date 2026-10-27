/**
 * Circuit shell slots — Header + Footer (doc 25 §1.4).
 *
 * The client-safe half of the Circuit slot map: the storefront
 * shell is a client component and resolves Header/Footer through
 * client-slot-registry.tsx. CircuitHeader and CircuitFooter are
 * both client-safe (the footer is hook-free; it lives here because
 * the shell map's type requires both slots from one map).
 */
import CircuitHeader from "./header";
import CircuitFooter from "./footer";
import type { ThemeShellSlots } from "../slots";

export const CIRCUIT_SHELL_SLOTS: ThemeShellSlots = {
  Header: CircuitHeader,
  Footer: CircuitFooter,
};
