import "./globals.css";
import type { Metadata } from "next";
import RegisterSW from "./register-sw";
import TrackingShell from "./tracking-shell";
import StorefrontShell from "./storefront-shell";

export const metadata: Metadata = {
  title: "Advance Ecommerce — Storefront",
  description: "Bangladesh-first ecommerce platform (local first)",
  manifest: "/manifest.webmanifest",
  icons: [{ rel: "icon", type: "image/svg+xml", url: "/favicon.svg" }],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="bn">
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
