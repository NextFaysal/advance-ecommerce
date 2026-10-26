// Recent-orders ticker section (doc 23 wave 60 / P11) — server
// wrapper in the SpinWheelSection pattern: renders nothing unless
// the module.social_proof flag is on. The ticker itself is a
// client component that fetches the edge-cached
// /api/v1/public/social-proof/recent on mount, so mounting this
// section NEVER makes a page dynamic and the page HTML never
// contains customer names — they only travel through the
// privacy-projected API. The ticker additionally renders nothing
// until at least 3 real recent orders come back.
import { socialProofEnabled } from "@/marketing/social-proof";
import { RecentOrdersTicker } from "./RecentOrdersTicker";

export function RecentOrdersSection() {
  if (!socialProofEnabled()) return null;
  return <RecentOrdersTicker />;
}
