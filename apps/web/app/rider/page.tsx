import RiderHome from "./rider-home";

// Rider PWA home (wave 58). The layout performs the cookie-presence
// gate; this page is the client delivery list over the existing
// rider APIs (see rider-home.tsx for the full contract + honesty
// notes on identity and offline behaviour).
export default function RiderPage() {
  return <RiderHome />;
}
