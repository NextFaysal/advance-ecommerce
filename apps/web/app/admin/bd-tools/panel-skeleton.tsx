"use client";

/**
 * BD Tools — tab-panel loading placeholder (admin perf wave, audit B2).
 *
 * Shown inside the tab panel area while a lazy panel's chunk loads on
 * first switch to its tab (see the next/dynamic definitions in
 * ./page.tsx). Built only from the shared Skeleton primitives (doc 31
 * design language) — a neutral text-and-block rhythm that approximates
 * every panel's geometry without introducing a new visual style.
 */
import { Skeleton } from "@/components/ui/skeleton";

export function PanelSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-40 w-full rounded-2xl" />
      <Skeleton className="h-4 w-1/3" />
    </div>
  );
}
