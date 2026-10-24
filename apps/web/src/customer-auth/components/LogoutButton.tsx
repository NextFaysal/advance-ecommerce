"use client";

/** Logout: revokes the server session via the API, then re-renders. */
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    await fetch("/api/v1/public/account/logout", { method: "POST" }).catch(() => null);
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={logout}
      disabled={busy}
      className="h-11 rounded-xl border border-border bg-card px-4 text-sm font-semibold text-text-main transition hover:bg-surface-2 disabled:opacity-60"
    >
      {busy ? "অপেক্ষা করুন…" : "লগআউট"}
    </button>
  );
}
