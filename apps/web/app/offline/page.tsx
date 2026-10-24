import type { Metadata } from "next";
import RetryButton from "./RetryButton";

/**
 * Offline fallback page — Agent 12 base, designed in the Design v3
 * responsive/PWA pass. public/sw.js precaches this URL at install and
 * serves it when a navigation fails with no cached copy; the storefront
 * shell renders no header/footer on /offline, so the page is fully
 * self-contained. It stays dependency-light: no data fetching, and the
 * page renders completely without client JS (the retry button is a
 * small client island; the home link always works).
 */
export const metadata: Metadata = {
  title: "অফলাইন — Advance Ecommerce",
  description: "ইন্টারনেট সংযোগ নেই। সংযোগ ফিরে এলে আবার চেষ্টা করুন।",
  robots: { index: false, follow: false },
};

function WifiOffMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="30"
      height="30"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12.55a11 11 0 0 1 5.17-2.39" />
      <path d="M10.71 5.05A16 16 0 0 1 22.58 9" />
      <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
      <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
      <path d="M12 20h.01" />
      <path d="m2 2 20 20" />
    </svg>
  );
}

export default function OfflinePage() {
  return (
    <main className="brand-soft-gradient flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm rounded-3xl border border-border bg-card p-7 text-center shadow-pop">
        <span className="brand-gradient mx-auto flex h-16 w-16 items-center justify-center rounded-2xl text-white shadow-lift">
          <WifiOffMark />
        </span>
        <h1 className="font-display mt-5 text-h2 text-text-main">ইন্টারনেট সংযোগ নেই</h1>
        <p className="mt-2 text-sm leading-6 text-text-muted">
          আপনি এখন অফলাইনে আছেন। আগে দেখা পেজগুলো ক্যাশ থেকে খুলতে পারে, কিন্তু নতুন অর্ডার, পেমেন্ট বা স্টক
          আপডেটের জন্য ইন্টারনেট লাগবে। সংযোগ ফিরে এলে আবার চেষ্টা করুন।
        </p>
        <div className="mt-6 flex flex-col gap-2.5">
          <RetryButton />
          <a
            href="/"
            className="flex h-12 items-center justify-center rounded-xl border border-border bg-card px-6 text-sm font-semibold text-text-main transition hover:bg-surface-2"
          >
            হোমপেজে যান
          </a>
        </div>
        <p className="mt-5 text-xs leading-5 text-text-subtle">
          আপনার কার্টের পণ্য এই ডিভাইসেই সংরক্ষিত আছে — সংযোগ ফিরলে সেখান থেকেই কেনাকাটা চালিয়ে যেতে পারবেন।
        </p>
      </div>
    </main>
  );
}
