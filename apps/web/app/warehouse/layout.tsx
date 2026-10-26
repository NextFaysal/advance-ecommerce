import type { ReactNode } from "react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { WAREHOUSE_MANIFEST_PATH } from "@/pwa/config";

// Warehouse scanner PWA shell (wave 58) — a phone-first, installable
// segment over the EXISTING warehouse surface (app/admin/warehouse +
// app/api/v1/admin/warehouse/*). This layout only overrides the
// manifest link (Next metadata merging replaces the root manifest
// for this segment) and provides a minimal shell — no admin sidebar,
// no new backend surface.
//
// Auth gate: cookie PRESENCE only, mirroring the rider layout and
// the middleware's edge behaviour for /admin/*. The warehouse APIs
// remain the real boundary — they validate the staff session +
// orders.view + the module.warehouse_ops flag on every call
// (src/warehouse/guard.ts), and the page renders the module's lock
// panel when the flag is OFF, exactly like the admin page.
//
// Width: max-w-3xl (wider than the rider shell) because the reused
// pick-list tables need the room; targets stay 56px+ touch sized.
export const metadata: Metadata = {
  title: "Warehouse — Advance Ecommerce",
  description: "Warehouse scanner: pick lists, scan-to-tick packing, ship handover scan.",
  manifest: WAREHOUSE_MANIFEST_PATH,
};

export default function WarehouseLayout({ children }: { children: ReactNode }) {
  if (!cookies().get("admin_session")?.value) {
    redirect("/admin/login?next=/warehouse");
  }
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between px-4">
          <span className="flex items-center gap-2 font-semibold">
            <Icon name="package" size={20} />
            ওয়্যারহাউস স্ক্যানার
          </span>
          <Link href="/admin/warehouse" className="text-sm text-text-muted underline-offset-2 hover:underline">
            অ্যাডমিন ওয়্যারহাউস
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl px-4 py-4">{children}</main>
    </div>
  );
}
