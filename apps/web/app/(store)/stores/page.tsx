/**
 * /stores — store locator (ADV-19, doc 22). Renders the locations the
 * merchant recorded in Settings: pickup points (stores.pickup_points,
 * the same document checkout offers for click & collect) plus retail
 * locations (stores.retail_locations, display-only). Name / address /
 * hours are shown exactly as recorded; the map link is a Google Maps
 * search URL built from the recorded address text (no API key, no
 * coordinates are invented). When neither document is configured the
 * page says so plainly instead of showing placeholder stores.
 */
import type { Metadata } from "next";
import { Icon } from "@/components/ui/icon";
import { loadPickupPoints, loadRetailLocations, type PickupPoint } from "@/checkout/pickup-points";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "আমাদের স্টোর — Advance Ecommerce",
  description: "আমাদের পিকআপ পয়েন্ট ও স্টোরের ঠিকানা এবং খোলার সময়।",
};

function mapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

function LocationCard({ point, pickup }: { point: PickupPoint; pickup: boolean }) {
  return (
    <article className="flex flex-col rounded-3xl border border-border bg-card p-6 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-display text-lg font-semibold text-text-main">{point.name}</h2>
        {pickup ? (
          <span className="shrink-0 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
            পিকআপ পয়েন্ট
          </span>
        ) : (
          <span className="shrink-0 rounded-full bg-surface-2 px-3 py-1 text-xs font-semibold text-text-muted">
            স্টোর
          </span>
        )}
      </div>
      <p className="mt-3 flex items-start gap-2 text-sm leading-6 text-text-muted">
        <span aria-hidden="true" className="mt-0.5 shrink-0 text-brand-600">
          <Icon name="store" size={16} />
        </span>
        <span>{point.address}</span>
      </p>
      {point.hours ? (
        <p className="mt-2 flex items-start gap-2 text-sm leading-6 text-text-muted">
          <span aria-hidden="true" className="mt-0.5 shrink-0 text-brand-600">
            <Icon name="clock" size={16} />
          </span>
          <span>খোলা: {point.hours}</span>
        </p>
      ) : null}
      <a
        href={mapsUrl(point.address)}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 inline-flex min-h-[44px] w-fit items-center gap-1.5 rounded-md border border-border px-4 text-sm font-medium text-text-main transition motion-fast hover:border-brand-300"
      >
        ম্যাপে দেখুন <Icon name="arrow-right" size={14} />
      </a>
    </article>
  );
}

export default async function StoresPage() {
  const [pickupPoints, retailLocations] = await Promise.all([
    loadPickupPoints(),
    loadRetailLocations(),
  ]);
  const total = pickupPoints.length + retailLocations.length;

  return (
    <main className="mx-auto w-full max-w-[1100px] px-4 pb-24 pt-6 sm:px-6">
      <h1 className="font-display text-h1">আমাদের স্টোর ও পিকআপ পয়েন্ট</h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-text-muted">
        অনলাইনে অর্ডার করে পিকআপ পয়েন্ট থেকে নিজে সংগ্রহ করতে পারবেন — চেকআউটে পিকআপ বেছে
        নিলেই পয়েন্টগুলো দেখানো হবে। স্টোরে এসে সরাসরি কেনাকাটাও করতে পারবেন।
      </p>

      {total === 0 ? (
        <section className="mt-8 rounded-2xl border border-border bg-card px-6 py-14 text-center shadow-card" aria-label="কোনো স্টোর নেই">
          <span aria-hidden="true" className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand-50 text-brand-500">
            <Icon name="store" size={28} />
          </span>
          <h2 className="mt-4 text-h3">এখনো কোনো স্টোরের তথ্য যোগ করা হয়নি</h2>
          <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-text-muted">
            আমাদের স্টোর ও পিকআপ পয়েন্টের তালিকা শীঘ্রই এখানে আসছে। ততদিন হোম ডেলিভারিতেই
            অর্ডার করুন — অথবা যোগাযোগের পেজ থেকে আমাদের সঙ্গে কথা বলুন।
          </p>
          <a
            href="/contact"
            className="brand-gradient mt-5 inline-flex min-h-[44px] items-center rounded-md px-5 text-sm font-semibold text-white shadow-md transition hover:opacity-90"
          >
            যোগাযোগ করুন
          </a>
        </section>
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {pickupPoints.map((p) => (
            <LocationCard key={`pickup-${p.id}`} point={p} pickup />
          ))}
          {retailLocations.map((p) => (
            <LocationCard key={`retail-${p.id}`} point={p} pickup={false} />
          ))}
        </div>
      )}
    </main>
  );
}
