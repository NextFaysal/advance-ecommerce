import type { Metadata } from "next";
import { CartPageClient } from "@/cart/components";
import { listActivePublicProducts } from "@/catalog/server-read";

// /cart — storefront cart page. Agent 33.
// The page itself is a thin server shell for metadata; all cart state is
// browser-side (guest cart in localStorage) so the interactive part lives
// in src/cart/components/CartPageClient.tsx. The shell feeds the client
// the real ACTIVE catalog (Prisma repository via src/catalog/server-read)
// so cart lines resolve against live products/prices — never mock data.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "আপনার কার্ট — Advance Ecommerce",
  description: "আপনার কার্টের পণ্য, কুপন ছাড় ও ডেলিভারি চার্জসহ মোট হিসাব দেখুন।",
};

export default async function CartPage() {
  // PUBLIC shape (cost stripped): the catalog list is serialized into
  // the client component's props, so it must be the cost-free shape.
  const catalogProducts = await listActivePublicProducts(100);
  return <CartPageClient catalogProducts={catalogProducts} />;
}
