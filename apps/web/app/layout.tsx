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
      {/* Self-hosted font preloads: the two critical first-paint faces
          (Latin UI 400 + Bangla UI 400). Faces are declared in
          src/styles/fonts.css; files live in public/fonts/. */}
      <link
        rel="preload"
        href="/fonts/plus-jakarta-sans/plus-jakarta-sans-variable-latin.woff2"
        as="font"
        type="font/woff2"
        crossOrigin="anonymous"
      />
      <link
        rel="preload"
        href="/fonts/hind-siliguri/hind-siliguri-400-bengali.woff2"
        as="font"
        type="font/woff2"
        crossOrigin="anonymous"
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
