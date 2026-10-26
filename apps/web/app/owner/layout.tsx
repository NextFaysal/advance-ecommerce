import type { ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { OWNER_MANIFEST_PATH } from "@/pwa/config";

// Owner PWA shell (wave 58) — installable segment whose manifest
// (metadata override below) replaces the root storefront manifest
// for /owner/*. The page itself validates the staff session for real
// before rendering any figure (see page.tsx); this layout is only
// chrome. The shared service worker (scope "/") already covers this
// segment — no second worker, and /api/* is never cached by it.
export const metadata: Metadata = {
  title: "Owner — Advance Ecommerce",
  description: "Owner summary: today's sales, orders and pending work.",
  manifest: OWNER_MANIFEST_PATH,
};

export default function OwnerLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-2xl items-center justify-between px-4">
          <span className="flex items-center gap-2 font-semibold">
            <Icon name="store" size={20} />
            মালিকের সারাংশ
          </span>
          <Link href="/admin" className="text-sm text-text-muted underline-offset-2 hover:underline">
            পূর্ণ অ্যাডমিন
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl px-4 py-4">{children}</main>
    </div>
  );
}
