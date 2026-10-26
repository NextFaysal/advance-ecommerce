import "./globals.css";
import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import RegisterSW from "./register-sw";
import TrackingShell from "./tracking-shell";
import StorefrontShell from "./storefront-shell";
import { getThemeCatalog } from "@/lib/theme-repository";
import { THEME_COOKIE, themeToFullStyleString } from "@/lib/theme-engine";

export const metadata: Metadata = {
  title: "Advance Ecommerce — Storefront",
  description: "Bangladesh-first ecommerce platform (local first)",
  manifest: "/manifest.webmanifest",
  icons: [{ rel: "icon", type: "image/svg+xml", url: "/favicon.svg" }],
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
  // Resolve selected theme from cookie; fall back gracefully if DB is not ready.
  let themeStyleBlock: string | null = null;
  try {
    const themeId = cookies().get(THEME_COOKIE)?.value;
    if (themeId) {
      const catalog = await getThemeCatalog();
      const theme = catalog.find((t) => t.id === themeId) ?? null;
      if (theme) {
        themeStyleBlock = themeToFullStyleString(theme);
      }
    }
  } catch {
    // DB not ready or cookie missing — fall back to globals.css defaults silently.
  }

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
      {/* Custom theme CSS variables — injected after globals.css so they
          override default tokens without !important. Only present when the
          visitor has a selected_theme cookie pointing at a valid catalog entry. */}
      {themeStyleBlock ? (
        <style
          data-theme-override="true"
          dangerouslySetInnerHTML={{ __html: themeStyleBlock }}
        />
      ) : null}
      {/* Brand fonts via Google Fonts CDN. The self-hosted woff2 files
          exist locally (public/fonts/) but are NOT in the deployed repo
          (binary files could not be pushed), so production rendered in
          fallback fonts. Until the binaries reach the repo by a real
          git push, the CDN faces below are the live source; family
          names match src/styles/fonts.css and the --font-* tokens. */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@200..800&family=Hind+Siliguri:wght@400;500;600;700&family=Noto+Sans+Bengali:wght@400;700&family=JetBrains+Mono:wght@400..800&display=swap"
        rel="stylesheet"
      />
      <body>
        <RegisterSW />
        <TrackingShell>
          <StorefrontShell>{children}</StorefrontShell>
        </TrackingShell>
      </body>
    </html>
  );
}
