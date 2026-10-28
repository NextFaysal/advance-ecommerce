"use client";

// Offline-page retry: reloads the current URL. The service worker is
// network-first for navigations, so once the connection is back the
// reload lands on the page the shopper originally asked for.
export default function RetryButton({ label = "আবার চেষ্টা করুন" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      className="brand-gradient focus-ring flex h-12 items-center justify-center rounded-xl px-6 text-sm font-semibold text-white shadow-md transition hover:opacity-90"
    >
      {label}
    </button>
  );
}
