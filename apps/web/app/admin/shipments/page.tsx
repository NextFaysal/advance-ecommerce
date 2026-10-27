import { PageHeader } from "@/components/ui/page-header";
import { getShipmentsBoard } from "@/shipments/board";
import { getRequestLocale } from "@/i18n/server";
import { pick } from "@/i18n/locale";
import { ShipmentsBoard } from "./shipments-board";
import { SHIPMENTS_STRINGS } from "./strings";

// Admin > Shipments — real cross-order board (doc 21 W0-C, G3-7a).
// This page used to be a TEMPORARY DEMO over ./demo-data.ts with
// page-state booking minting SBX-…-DEMO ids. It now reads REAL
// Shipment rows (src/shipments/board.ts — the same read the
// GET /api/v1/admin/shipments/board route serves): every row is a
// persisted booking with its stored charge/COD and its real event
// history. The board is a VIEW: booking and status actions live
// per-order in the order workspace (its shipments panel), and each
// row links there. Courier adapters behind those bookings are still
// sandbox (SBX tracking ids, no real courier contacted) until live
// providers land (doc 21 W2) — the header says so plainly.

export const dynamic = "force-dynamic";

export default async function ShipmentsPage() {
  const locale = await getRequestLocale();
  const s = pick(locale, SHIPMENTS_STRINGS);
  const board = await getShipmentsBoard();

  return (
    <div className="space-y-6">
      <PageHeader title={s.pageTitle} description={s.pageDescription} />
      <ShipmentsBoard rows={board.rows} summary={board.summary} />
    </div>
  );
}
