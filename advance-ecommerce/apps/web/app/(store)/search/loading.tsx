import { SearchPageSkeleton } from "./SearchSkeleton";

// Route-level loading state for /search (wave P5, doc 32) — the same
// skeleton the shell's Suspense fallback renders, so navigations
// into search never flash a blank page.
export default function SearchLoading() {
  return (
    <main className="mx-auto min-w-0 max-w-7xl px-4 py-6">
      <SearchPageSkeleton />
    </main>
  );
}
