import { NextResponse } from "next/server";
import { getPublicSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const settings = await getPublicSettings();
    return NextResponse.json({
      data: {
        storeName: settings["general.store_name"] || "Advance Ecommerce",
        logoUrl: settings["branding.logo_url"] || "",
        faviconUrl: settings["branding.favicon_url"] || "",
        supportPhone: settings["general.support_phone"] || "",
        supportEmail: settings["general.support_email"] || "",
        storeAddress: settings["general.store_address"] || "",
        currency: settings["general.currency"] || "BDT",
        locale: settings["general.locale"] || "bn",
        settings,
      },
    });
  } catch (err) {
    return NextResponse.json({
      data: {
        storeName: "Advance Ecommerce",
        logoUrl: "",
        faviconUrl: "",
        supportPhone: "",
        supportEmail: "",
        storeAddress: "",
        currency: "BDT",
        locale: "bn",
        settings: {},
      },
    });
  }
}
