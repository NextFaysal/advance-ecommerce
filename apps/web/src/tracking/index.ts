// Server-side tracking (CAPI) + attribution — Agent 24 (Part H / A8).
// Start from ./types, ./events (builder + dedup), ./capi (Meta payload +
// sandbox sender seam), ./consent, ./attribution, ./channels (GA4/TikTok
// shapes), ./settings (Admin Settings key contract). No real provider call
// exists anywhere in this module — see capi.ts for the sender seam.
export * from "./types";
export * from "./hashing";
export * from "./events";
export * from "./events-server";
export * from "./consent";
export * from "./capi";
export * from "./attribution";
export * from "./attribution-server";
export * from "./channels";
export * from "./settings";
