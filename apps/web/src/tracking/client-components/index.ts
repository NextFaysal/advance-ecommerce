// Storefront tracking React components — Agent 26.
// TrackingProvider creates the framework-agnostic client (../client) and
// fires PageView/UTM capture; ConsentBanner records the visitor's choice.
// Mount both once from the root layout — see TrackingProvider.tsx for the
// exact mount contract.
export * from "./TrackingProvider";
export * from "./ConsentBanner";
