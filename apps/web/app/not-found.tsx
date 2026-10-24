import Link from "next/link";

// Branded 404 for the storefront (replaces the framework default).
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-2xl flex-col items-center justify-center px-6 py-20 text-center">
      <p className="brand-gradient bg-clip-text text-7xl font-extrabold text-transparent">404</p>
      <h1 className="mt-4 text-2xl font-bold text-text-main">পেজটি পাওয়া যায়নি</h1>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-text-muted">
        আপনি যে পেজটি খুঁজছেন তা সরে গেছে অথবা লিংকটি ভুল। দোকান থেকে আবার শুরু করুন — পছন্দের পণ্য অপেক্ষা করছে।
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/shop"
          className="brand-gradient rounded-xl px-6 py-3 text-sm font-semibold text-white shadow-md transition hover:opacity-90"
        >
          দোকানে যান
        </Link>
        <Link
          href="/"
          className="rounded-xl border border-border bg-card px-6 py-3 text-sm font-semibold text-text-main transition hover:bg-surface-2"
        >
          হোমপেজ
        </Link>
      </div>
    </main>
  );
}
