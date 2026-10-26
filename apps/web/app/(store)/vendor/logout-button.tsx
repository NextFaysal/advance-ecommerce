"use client";

/** Vendor portal logout (ADV-13) — POSTs the logout route (clears the cookie), then goes to the login page. */
import { useRouter } from "next/navigation";

export default function VendorLogoutButton() {
  const router = useRouter();
  async function onClick() {
    await fetch("/api/v1/public/vendor/logout", { method: "POST" }).catch(() => {});
    router.push("/vendor/login");
    router.refresh();
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-text-main transition hover:bg-brand-50"
    >
      লগআউট
    </button>
  );
}
