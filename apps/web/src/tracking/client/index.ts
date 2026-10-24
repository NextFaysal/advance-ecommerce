// Storefront tracking client — Agent 26.
// Framework-agnostic browser side of src/tracking: consent storage,
// UTM capture, and the pixel client that POSTs to the Agent 24 intake
// route (/api/v1/public/track-events) with the shared eventId the server
// CAPI flow dedupes on. React bindings live in ../client-components.
export * from "./consent-storage";
export * from "./utm-capture";
export * from "./pixel-client";
