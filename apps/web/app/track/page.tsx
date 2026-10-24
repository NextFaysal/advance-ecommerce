/**
 * /track — public order tracking page. Agent 19.
 * Bangla-first, mobile-first. Data comes from POST /api/v1/public/track
 * (real order data from the DB; phone is only ever shown masked).
 */
import type { Metadata } from "next";
import TrackForm from "./TrackForm";

export const metadata: Metadata = {
  title: "অর্ডার ট্র্যাকিং — Advance Ecommerce",
  description: "অর্ডার নম্বর ও মোবাইল নম্বর দিয়ে আপনার অর্ডারের অবস্থা দেখুন।",
  robots: { index: false, follow: false },
};

export default function TrackPage() {
  return (
    <main className="mx-auto w-full max-w-md px-4 py-8 sm:py-10">
      <h1 className="font-display text-2xl font-bold text-text-main">অর্ডার ট্র্যাক করুন</h1>
      <p className="mt-1.5 text-sm leading-6 text-text-muted">
        অর্ডার নম্বর ও অর্ডারের সময় দেওয়া মোবাইল নম্বর দিন।
      </p>
      <div className="mt-4">
        <TrackForm />
      </div>
    </main>
  );
}
