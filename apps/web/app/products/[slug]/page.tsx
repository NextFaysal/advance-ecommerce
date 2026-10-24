import { redirect } from "next/navigation";

// Product detail pages live at /product/<slug>.
export default async function ProductSlugRedirect({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  redirect(`/product/${slug}`);
}
