import type { ReactNode } from "react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { RIDER_MANIFEST_PATH } from "@/pwa/config";

// Rider PWA shell (wave 58) — a phone-first, installable segment over
// the EXISTING rider APIs (app/api/v1/admin/riders/*). This layout
// only overrides the manifest link (Next metadata merging replaces
// the root manifest for this segment) and provides a minimal shell —
// no admin sidebar, no new backend surface.
//
// Auth gate: cookie PRESENCE only, mirroring the middleware's edge
// behaviour for /admin/*. The rider APIs remain the real boundary —
// they validate the staff session + riders.view/riders.manage +
// the module.rider flag on every call, and the home component renders
// their 401/403 states honestly if the session is stale.
export const metadata: Metadata = {
  title: "Rider — Advance Ecommerce",
  description: "Own-rider deliveries: today's list, pickup/delivered actions, COD collection.",
  manifest: RIDER_MANIFEST_PATH,
};

export default function RiderLayout({ children }: { children: ReactNode }) {
  if (!cookies().get("admin_session")?.value) {
    redirect("/admin/login?next=/rider");
  }
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-md items-center justify-between px-4">
          <span className="flex items-center gap-2 font-semibold">
            <Icon name="truck" size={20} />
            রাইডার
          </span>
          <Link href="/admin/riders" className="text-sm text-text-muted underline-offset-2 hover:underline">
            অ্যাডমিন বোর্ড
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-md px-4 py-4">{children}</main>
    </div>
  );
}
