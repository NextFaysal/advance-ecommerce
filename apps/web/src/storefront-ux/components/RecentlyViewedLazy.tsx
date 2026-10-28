"use client";

// Lazy mounts for the recently-viewed pair (perf wave, audit item 5 —
// the pair was left eager by item 2 because its mounts live inside
// theme packages, which that wave did not own). Both components are
// invisible at first paint by nature:
// - RecordRecentlyViewed renders null; its only job is a
//   localStorage write on mount.
// - RecentlyViewedRail renders null until it has read localStorage
//   in an effect (its SSR output is already empty), and it sits
//   below the fold at the foot of the PDP composition.
// Loading both via next/dynamic with ssr:false therefore changes no
// server-rendered byte: the PDP compositions (server components, one
// per theme package) render THESE client shims instead of the real
// components, and the rail + recorder code (plus the rail's
// QuickViewModal chain) splits into a chunk that loads after
// hydration. The recorder's side effect still fires on every PDP
// visit — a beat after mount instead of during it — and the rail's
// gating (empty list renders nothing) is untouched inside the real
// components. `next/dynamic` with ssr:false cannot live in the
// server compositions themselves, hence this thin client shim (same
// pattern as marketing's SpinWheelWidgetLazy).
import dynamic from "next/dynamic";
import type { RecentlyViewedEntry } from "../types";

const RecordRecentlyViewed = dynamic(
  () => import("./RecordRecentlyViewed").then((m) => m.RecordRecentlyViewed),
  { ssr: false },
);

const RecentlyViewedRail = dynamic(
  () => import("./RecentlyViewedRail").then((m) => m.RecentlyViewedRail),
  { ssr: false },
);

/** Deferred RecordRecentlyViewed — same props, same mount effect. */
export function RecordRecentlyViewedLazy({ entry }: { entry: RecentlyViewedEntry }) {
  return <RecordRecentlyViewed entry={entry} />;
}

/** Deferred RecentlyViewedRail — same props, same empty-list gating. */
export function RecentlyViewedRailLazy({
  excludeProductId,
}: {
  excludeProductId?: string;
}) {
  return <RecentlyViewedRail excludeProductId={excludeProductId} />;
}
