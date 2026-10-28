"use client";

// Lazy mount for SpinWheelWidget (perf wave, audit item 2): the wheel
// chunk (~part of the ~39 KiB gz marketing cluster) used to ride in
// the homepage's First Load JS even though the widget is never
// visible at first paint — it sits mid-page and already resolves its
// signed-in state by fetch on mount. The server wrapper
// (SpinWheelSection) keeps doing the flag/config gating server-side
// and renders THIS client wrapper instead of the widget directly, so
// the widget code splits into its own chunk and loads after
// hydration. `next/dynamic` with ssr:false cannot live in the server
// wrapper itself, hence this thin client shim. Props are unchanged
// and fully serializable — behaviour (eligibility fetch, dismissal
// memory, spin flow) is the widget's own and is untouched.
import dynamic from "next/dynamic";
import type { SpinWidgetSegment } from "./SpinWheelWidget";

const SpinWheelWidget = dynamic(
  () => import("./SpinWheelWidget").then((m) => m.SpinWheelWidget),
  { ssr: false },
);

export function SpinWheelWidgetLazy({
  segments,
  dailyLimit,
}: {
  segments: SpinWidgetSegment[];
  dailyLimit: number;
}) {
  return <SpinWheelWidget segments={segments} dailyLimit={dailyLimit} />;
}
