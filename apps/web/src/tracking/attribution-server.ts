// UTM attribution write validation — SERVER ONLY (perf wave, zod diet).
//
// The utmParamsSchema used to live in ./attribution next to the shared
// types + pure helpers. The storefront attribution capture
// (./client/utm-capture, mounted by TrackingProvider on every route)
// imports those helpers, which dragged the zod runtime into the
// browser bundle. The schema now lives here; ./attribution stays
// schema-free so client components can import it safely.
//
// Server validation is unchanged: the public track-events API route
// imports the exact same schema object from this module instead.
import { z } from "zod";

const utmField = z.string().trim().max(120).optional().nullable();

export const utmParamsSchema = z.object({
  utmSource: utmField,
  utmMedium: utmField,
  utmCampaign: utmField,
  utmTerm: utmField,
  utmContent: utmField,
});
