import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getRequestLocale } from "@/i18n/server";
import { pick } from "@/i18n/locale";
import { LOGIN_STRINGS } from "./strings";

/**
 * Admin login segment layout — exists to own this segment's document
 * title (doc 35 wave 4). The login page is a client component so it
 * cannot export metadata, and without a segment override the tab
 * inherited the root layout's storefront title. The title follows the
 * request locale like the page's own heading: the login dictionary's
 * `title` ("অ্যাডমিন লগইন" / "Admin Login") plus the brand suffix,
 * mirroring the root title's shape.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const s = pick(locale, LOGIN_STRINGS);
  return { title: `${s.title} — Advance Ecommerce` };
}

export default function AdminLoginLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
