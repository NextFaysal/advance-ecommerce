"use client";

/**
 * ThemeBoundary — render fallback for theme slots (doc 25 §4.4,
 * wave S3a).
 *
 * Wraps one theme slot subtree. If the resolved slot component
 * throws during render, the boundary swaps in the provided Aurora
 * slot for that subtree, logs the error with the slot name and
 * package id, and leaves the rest of the page (header, cart,
 * everything outside the boundary) alive. A broken theme degrades
 * to Theme #1 — never to a blank page.
 *
 * The fallback is a ReactNode the composition root builds from the
 * Aurora slot with the SAME props it passed the resolved slot, so
 * the degradation is visually identical to running Aurora for that
 * slot. (If Aurora's own component throws, the fallback throws too
 * and the error propagates to the route's error handling — the same
 * behaviour the page had before boundaries existed.)
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import type { ThemeSlotName } from "./registry";

interface ThemeBoundaryProps {
  /** Which slot this boundary guards (for the log line). */
  slotName: ThemeSlotName;
  /** The package the resolved slot came from (for the log line). */
  packageId?: string;
  /** Aurora rendering of the same slot, rendered on error. */
  fallback: ReactNode;
  children: ReactNode;
}

interface ThemeBoundaryState {
  hasError: boolean;
}

export class ThemeBoundary extends Component<ThemeBoundaryProps, ThemeBoundaryState> {
  state: ThemeBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ThemeBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(
      `[theme-boundary] slot "${this.props.slotName}" (package "${this.props.packageId ?? "unknown"}") ` +
        "threw during render — Aurora fallback rendered instead.",
      error,
      info.componentStack,
    );
  }

  render(): ReactNode {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}
