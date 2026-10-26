"use client";

/**
 * Warehouse scanner PWA home (wave 58) — a scanner-first shell over
 * the EXISTING warehouse surface. The whole pick → pack → ship UI is
 * the admin page's own component, imported unchanged:
 *   app/admin/warehouse/warehouse-client.tsx (WarehouseClient)
 * It is importable without the admin layout because it is a plain
 * client component whose only props are the serialisable initial
 * queue + pick lists, and every read/write after mount goes through
 * the existing JSON APIs:
 *   GET/POST /api/v1/admin/warehouse/queue
 *   GET/POST /api/v1/admin/warehouse/pick-lists (+ /[id]/complete, /[id]/pack)
 *   GET      /api/v1/admin/warehouse/ship/resolve
 *   POST     /api/v1/admin/warehouse/ship/handover
 * The wave-54 scan-to-tick (BarcodeScanner — BarcodeDetector where
 * the browser offers it, typed code everywhere) lives inside that
 * component's pack tab; nothing about scanning is reimplemented here.
 *
 * Offline honesty: the shared service worker caches the app SHELL
 * only and never caches /api/* — this screen shows the server data
 * fetched when the page opened (refreshed after each action by the
 * component itself), never offline data presented as current.
 * Scans/ticks are NOT queued offline: with no connection they fail
 * with the component's error notice and nothing is saved.
 */
import InstallPrompt from "@/pwa/install-prompt";
import { WarehouseClient } from "../admin/warehouse/warehouse-client";
import type { PickList } from "@/warehouse/pick-lists";
import type { ConfirmedQueue } from "@/warehouse/queue";

export function WarehouseHome({
  initialQueue,
  initialLists,
}: {
  initialQueue: ConfirmedQueue;
  initialLists: PickList[];
}) {
  const openLists = initialLists.filter((l) => l.status === "OPEN");
  const openOrderCount = openLists.reduce((sum, l) => sum + l.orders.length, 0);

  return (
    <div className="space-y-4">
      <InstallPrompt />

      <section
        aria-label="চলমান পিক লিস্টের সারাংশ"
        className="rounded-xl bg-surface-2 px-4 py-3"
      >
        <p className="text-base font-semibold">
          চলমান পিক লিস্ট: {openLists.length}টি
          {openLists.length > 0 ? ` · মোট ${openOrderCount}টি অর্ডার` : ""}
          {" · "}কনফার্মড কিউ: {initialQueue.rows.length}টি অর্ডার
        </p>
        <p className="mt-1 text-sm text-text-muted">
          নিচের তালিকা থেকে যেকোনো পিক লিস্টে “প্যাক করুন” চাপলেই স্ক্যানার খুলবে —
          পণ্যের SKU/বারকোড স্ক্যান করলেই টিক পড়বে, চেকবক্স দিয়েও টিক দেওয়া যায়।
        </p>
      </section>

      <WarehouseClient initialQueue={initialQueue} initialLists={initialLists} />

      <p className="pb-2 text-center text-[11px] text-text-muted">
        তালিকা পেজ খোলার সময়ের সার্ভার ডেটা; প্রতিটি কাজের পর নিজে থেকে হালনাগাদ হয় —
        নতুন কনফার্মড অর্ডার দেখতে পেজ রিলোড করুন (কোনো polling নেই)।
        অফলাইনে স্ক্যান/টিক সেভ হবে না — কোনো অফলাইন কিউ নেই, সংযোগ ফিরলে আবার স্ক্যান করুন।
      </p>
    </div>
  );
}
