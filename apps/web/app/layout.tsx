import "./globals.css";
import type { Metadata, Viewport } from "next";
import RegisterSW from "./register-sw";
import TrackingShell from "./tracking-shell";
import StorefrontShell from "./storefront-shell";
import ThemeStyleSync from "@/components/ui/theme-style-sync";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";

export const metadata: Metadata = {
  title: "Advance Ecommerce — Storefront",
  description: "Bangladesh-first ecommerce platform (local first)",
  manifest: "/manifest.webmanifest",
  icons: [
    { rel: "icon", type: "image/svg+xml", url: "/favicon.svg" },
    // iOS home-screen icon (Safari ignores the web manifest's icons).
    { rel: "apple-touch-icon", type: "image/png", url: "/icons/icon-192.png" },
  ],
  // iOS "Add to Home Screen" behaviour: launch standalone (no Safari
  // chrome) with the store name — the Apple-side half of the customer
  // PWA (see apps/customer-app/README.md). Android/desktop use the web
  // manifest above; theme colour is in the viewport export below.
  appleWebApp: {
    capable: true,
    title: "AdvEcommerce",
    statusBarStyle: "default",
  },
};

// Browser chrome colour for the PWA / mobile browser UI. Matches the
// web manifest theme_color (#4F46E5) in light mode; brand-900 in dark.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#4F46E5" },
    { media: "(prefers-color-scheme: dark)", color: "#312E81" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Ensure DB feature flags are hydrated for all consumers across the process
  try {
    await ensureDbFeatureFlags();
  } catch {
    // Database unreachable — fallback gracefully to catalogue defaults
  }

  // Selected-theme CSS is applied entirely on the client (bootstrap
  // script below + ThemeStyleSync) so this layout never calls cookies()
  // and pages stay eligible for static rendering / ISR.

  return (
    <html lang="bn" suppressHydrationWarning>
      {/* Theme bootstrap (Design v3): apply the stored/system dark-mode
          preference BEFORE first paint so the ThemeToggle never flashes
          light. Must stay in sync with src/components/ui/theme-toggle.tsx
          (same localStorage key "theme", same .dark class on <html>). */}
      <script
        dangerouslySetInnerHTML={{
          __html:
            '(function(){try{var t=localStorage.getItem("theme");if(t==="dark"||(!t&&window.matchMedia("(prefers-color-scheme: dark)").matches)){document.documentElement.classList.add("dark")}}catch(e){}})();',
        }}
      />
      {/* Selected-theme bootstrap: inject the cached theme CSS BEFORE
          first paint so a themed visitor never flashes the default
          tokens. The CSS text is computed by ThemeStyleSync /
          ThemeProvider and cached in localStorage under "ae-theme-css"
          (keys must stay in sync with
          src/components/ui/theme-style-sync.tsx). The injected <style>
          lands in <head> after globals.css, so it overrides default
          tokens without !important. No cache entry = default theme. */}
      <script
        dangerouslySetInnerHTML={{
          __html:
            '(function(){try{var css=localStorage.getItem("ae-theme-css");if(css){var s=document.createElement("style");s.setAttribute("data-theme-override","true");s.textContent=css;(document.head||document.documentElement).appendChild(s);}}catch(e){}})();',
        }}
      />
      {/* Brand fonts via Google Fonts CDN. The self-hosted woff2 files
          exist locally (public/fonts/) but are NOT in the deployed repo
          (binary files could not be pushed), so production rendered in
          system-ui. CDN link restores brand typography in deployed envs;
          local dev still loads public/fonts/ if available. */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        href="https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&family=Noto+Sans+Bengali:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
        rel="stylesheet"
      />
      <body className="min-h-screen bg-background font-sans text-foreground antialiased selection:bg-brand-500 selection:text-white">
        <RegisterSW />
        <ThemeStyleSync />
        <StorefrontShell>
          <TrackingShell>{children}</TrackingShell>
        </StorefrontShell>
      </body>
    </html>
  );
}
