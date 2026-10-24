import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Offline — Advance Ecommerce",
  description: "You are offline. Cached pages may still be available.",
};

/**
 * Offline fallback page — Agent 12 (Step 30 base).
 * This page is precached by public/sw.js and served when a navigation
 * fails with no cached copy. It must stay dependency-light: no data
 * fetching, no client JS required to render.
 */
export default function OfflinePage() {
  return (
    <main
      style={{
        padding: 24,
        fontFamily: "system-ui, sans-serif",
        maxWidth: 520,
        margin: "0 auto",
        textAlign: "center",
      }}
    >
      <h1 style={{ fontSize: 24, marginBottom: 12 }}>Internet nei</h1>
      <p style={{ lineHeight: 1.6, marginBottom: 8 }}>
        আপনি এখন অফলাইনে আছেন। আগে দেখা পেজগুলো ক্যাশ থেকে খুলতে পারে, কিন্তু
        নতুন অর্ডার, পেমেন্ট বা স্টক আপডেটের জন্য ইন্টারনেট লাগবে।
      </p>
      <p style={{ lineHeight: 1.6, color: "#5B5F7A" }}>
        You are offline. Pages you visited before may still open from cache,
        but new orders, payments and stock updates need an internet connection.
        Please reconnect and try again.
      </p>
    </main>
  );
}
