"use client";

// Lazy mount for NewsletterForm (perf wave, audit item 5 — the form
// was left eager by item 2 because its only mount lives inside the
// Aurora theme package, which that wave did not own). The form is
// the closing section of the home page — far below the fold — so
// its code splits via next/dynamic (ssr:false) into a chunk that
// loads after hydration; the section's heading/copy around the mount
// still server-render exactly as before, and the form itself appears
// in place a beat later. Props and behaviour (submit flow, honeypot,
// honest error states) are the real form's own and are untouched.
// `next/dynamic` with ssr:false cannot live in the server-side
// home-sections composition, hence this thin client shim (same
// pattern as marketing's SpinWheelWidgetLazy).
import dynamic from "next/dynamic";

const NewsletterForm = dynamic(
  () => import("./NewsletterForm").then((m) => m.NewsletterForm),
  { ssr: false },
);

/** Deferred NewsletterForm — same props, same submit behaviour. */
export function NewsletterFormLazy({ source = "homepage" }: { source?: string }) {
  return <NewsletterForm source={source} />;
}
