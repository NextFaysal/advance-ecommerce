import { redirect } from "next/navigation";

// The shop lives at /shop; /products is the URL shoppers guess first.
export default function ProductsRedirect() {
  redirect("/shop");
}
