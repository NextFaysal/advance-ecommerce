/**
 * PDP loading state (doc 32 P2) — the shared PdpSkeleton from the
 * storefront skeleton set (src/storefront-ux), whose geometry
 * mirrors the Aurora composition (breadcrumb, gallery | buy-column
 * grid, section card), so the page never flashes blank or stale
 * content while the product resolves — under every theme, since
 * the route is shared and the compositions all follow that grid.
 */
import { PdpSkeleton } from "@/storefront-ux/components/StorefrontSkeletons";

export default function ProductLoading() {
  return <PdpSkeleton />;
}
