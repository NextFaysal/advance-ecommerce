/**
 * Aurora CartDrawer slot — the explicit null drawer (doc 25 §1.4;
 * wave S3b).
 *
 * Theme #1 has NO cart drawer: the header cart links to /cart, and
 * nothing in Aurora opens a slide-in cart. The slot is still
 * registered — with this component, which renders null for every
 * input — so the shell's mount point is real and a package that
 * DOES provide a drawer (S4's Ghorer) plugs into the identical
 * contract ({ open, onClose }) without the shell changing shape.
 */
import type { ThemeCartDrawerProps } from "../slots";

export function NullCartDrawer(_props: ThemeCartDrawerProps) {
  return null;
}
