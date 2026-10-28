import "./globals.css";
import type { Metadata, Viewport } from "next";
import RegisterSW from "./register-sw";
import TrackingShell from "./tracking-shell";
import StorefrontShell from "./storefront-shell";
import ThemeShell from "@/storefront-shell/ThemeShell";
import ThemeStyleSync from "@/components/ui/theme-style-sync";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { getStoreDefaultLocale } from "@/i18n/server";
import { LocaleProvider } from "@/i18n/LocaleProvider";

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

  // Unified language system (doc 30): the store default locale comes from
  // the `general.locale` setting (owner-set in Admin → Settings). The
  // visitor's own override lives in the `ae-locale` cookie/localStorage
  // and is adopted client-side by LocaleProvider (plus a pre-paint script
  // below for <html lang>), so this layout still never calls cookies()
  // and pages stay eligible for static rendering / ISR.
  const defaultLocale = await getStoreDefaultLocale();

  // Selected-theme CSS is applied entirely on the client (bootstrap
  // script below + ThemeStyleSync) so this layout never calls cookies()
  // and pages stay eligible for static rendering / ISR.

  return (
    <html lang={defaultLocale} suppressHydrationWarning>
      {/* Language bootstrap (doc 30): apply the visitor's stored language
          to <html lang> BEFORE first paint, mirroring the theme bootstrap
          below. Keys must stay in sync with src/i18n/locale.ts. */}
      <script
        dangerouslySetInnerHTML={{
          __html:
            '(function(){try{var l=localStorage.getItem("advance-ecommerce:locale");if(l!=="bn"&&l!=="en"){var m=document.cookie.match(/(?:^|; )ae-locale=([^;]*)/);l=m?decodeURIComponent(m[1]):null}if(l==="bn"||l==="en"){document.documentElement.lang=l}}catch(e){}})();',
        }}
      />
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
      {/* Brand fonts via Google Fonts CDN, loaded WITHOUT blocking first
          paint (perf wave, 2026-10-28): the stylesheet is preloaded and
          applied via the print-media swap below (+ an inline script that
          flips it to "all" on load, and a <noscript> fallback), so text
          paints immediately in the fallback stack and swaps when the
          faces arrive (display=swap). Only the two families the design
          tokens actually reach are loaded app-wide:
          - Hind Siliguri 400–700 (display lead; carries Bengali glyphs)
          - Plus Jakarta Sans 400–800 (sans lead for Latin)
          Noto Sans Bengali is gone: it sat behind Hind Siliguri in every
          stack and Hind covers Bengali, so it was unreachable (PDFs are
          unaffected — src/pdf embeds Hind Siliguri from base64 data).
          JetBrains Mono moved to the admin shell (app/admin/layout.tsx);
          storefront font-mono falls through to ui-monospace.
          Why not next/font/google? It renames families to hashed names,
          but the theme packages' token stacks (src/themes/<theme>/tokens.ts)
          reference the literal family names — next/font would leave
          every themed page on system-ui. The self-hosted woff2 files in
          public/fonts/ remain undeployable (binary push limit), so the
          CDN stylesheet stays the delivery mechanism, now non-blocking. */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        rel="preload"
        as="style"
        href="https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
      />
      <link
        data-brand-fonts
        rel="stylesheet"
        media="print"
        href="https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
      />
      <script
        dangerouslySetInnerHTML={{
          __html:
            '(function(){var l=document.querySelector("link[data-brand-fonts]");if(!l)return;var go=function(){l.media="all"};if(l.sheet){go()}else{l.addEventListener("load",go)}})();',
        }}
      />
      <noscript>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
        />
      </noscript>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased selection:bg-ring selection:text-white">
        <RegisterSW />
        <ThemeStyleSync />
        {/* ThemeShell (S3a): resolves the store theme server-side
            (store-global catalog data only — still no cookies() in
            this layout) and mounts the ThemeView context the theme
            slot system consumes. Renders no markup of its own. */}
        <LocaleProvider defaultLocale={defaultLocale}>
          <ThemeShell>
            <StorefrontShell>
              <TrackingShell>{children}</TrackingShell>
            </StorefrontShell>
          </ThemeShell>
        </LocaleProvider>
      </body>
    </html>
  );
}
