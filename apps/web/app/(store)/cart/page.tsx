import type { Metadata } from "next";
import { CartPageClient } from "@/cart/components";

// /cart — storefront cart page. Agent 33.
// The page itself is a thin server shell for metadata; all cart state is
// browser-side (guest cart in localStorage) so the interactive part lives
// in src/cart/components/CartPageClient.tsx.
export const metadata: Metadata = {
  title: "আপনার কার্ট — Advance Ecommerce",
  description: "আপনার কার্টের পণ্য, কুপন ছাড় ও ডেলিভারি চার্জসহ মোট হিসাব দেখুন।",
};

export default function CartPage() {
  return <CartPageClient />;
}
