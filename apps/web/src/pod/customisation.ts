/**
 * Print-on-demand customisation — ADV-23 vertical 5 (doc 23,
 * wave 56).
 *
 * The order-create seam + the admin order projection + the print
 * queue service. There is NO POD table: the customisation is
 * frozen onto the order as an OrderNote at create time (see
 * src/pod/selection.ts for the note format), so everything here
 * works by writing / parsing those notes.
 *
 * Create-path contract (both seams — the public orders route and
 * createManualOrder — run the identical steps):
 *   payload has no `pod` field -> null; nothing changes.
 *   field present + flag OFF   -> 403 FEATURE_LOCKED (a locked
 *                                 module never runs open).
 *   field present + flag ON    -> validate against the stored
 *                                 pod.config + the order's own
 *                                 items; a violation is a 400 with
 *                                 the bilingual message.
 * The validated spec's fee total rides into the callers' pricing
 * pipeline as `printFeePoisha` (src/checkout/pricing.ts — its own
 * breakdown line, added to the grand total at the same stage as
 * the rental deposit), and its note line rides the create-time
 * order note. Unlike services/rentals there is no capacity or
 * availability to enforce inside the create transaction — a print
 * text cannot sell out — so nothing here needs the transaction.
 *
 * The printed attestation is also a note: staff POST to the queue
 * API appends the `[pod-printed]` note (authorId = the staff
 * member), and the queue read + the data.pod projection report
 * `printed` from its presence. No status column exists to drift.
 */
import { prisma } from "@advance-ecommerce/db";
import { maskPhone } from "@advance-ecommerce/validators";
import type { OrderStatus } from "@/orders/types";
import { qtyNumber } from "@/lib/quantity";
import { loadPodConfig } from "./config";
import { isPodEnabled } from "./flags";
import {
  POD_NOTE_MARKER_PREFIX,
  POD_PRINTED_MARKER,
  POD_PRINTED_NOTE_TEXT,
  podSpecFromNoteText,
  validatePodSelection,
  type PodNotePayload,
  type PodSelection,
  type PodWriteSpec,
} from "./selection";

/* ------------------------------------------------------------------ */
/* Create seam                                                         */
/* ------------------------------------------------------------------ */

export type PreparePodResult =
  | { ok: true; pod: PodWriteSpec | null }
  | { ok: false; httpStatus: 403 | 400; code: string; message: string };

/**
 * The shared create-seam gate. Returns pod=null when the payload
 * carried no customisation (the default path — byte-identical
 * behaviour for every non-POD order). `items` are the order's own
 * lines (variant + quantity): v1 allows ONE customised line per
 * order, and the per-item fee is charged on that line's full
 * quantity.
 */
export async function preparePodCustomisation(
  selection: PodSelection | undefined,
  items: Array<{ variantId: string; quantity: number }>,
): Promise<PreparePodResult> {
  if (selection === undefined) return { ok: true, pod: null };
  if (!isPodEnabled()) {
    return {
      ok: false,
      httpStatus: 403,
      code: "FEATURE_LOCKED",
      message:
        "প্রিন্ট-অন-ডিমান্ড মডিউল এই ইনস্টলে বন্ধ আছে। / The print-on-demand module is locked for this install (module.print_on_demand is OFF).",
    };
  }
  const { effective } = await loadPodConfig();
  const validated = validatePodSelection(selection, effective, items);
  if (!validated.ok) {
    return { ok: false, httpStatus: 400, code: validated.code, message: validated.message };
  }
  return { ok: true, pod: validated.spec };
}

/* ------------------------------------------------------------------ */
/* PDP note (storefront)                                               */
/* ------------------------------------------------------------------ */

export interface PodPdpNote {
  textMaxChars: number;
  printFeePoisha: number;
  hasColors: boolean;
}

/**
 * The PDP's "কাস্টম প্রিন্ট" note data: non-null only when the POD
 * module is ON and one of the product's variants is on the
 * printable list (the getBoxPdpData precedent — ~zero cost while
 * the flag is off). The customisation FIELDS are NOT on the PDP
 * in v1: the guest cart carries no print text, so the text +
 * colour are entered at checkout; this note only tells the
 * customer that — and the fee — before they add to cart.
 */
export async function getPodPdpNote(variantIds: string[]): Promise<PodPdpNote | null> {
  if (!isPodEnabled()) return null;
  const { effective } = await loadPodConfig();
  if (!variantIds.some((id) => effective.podVariantIds.includes(id))) return null;
  return {
    textMaxChars: effective.textMaxChars,
    printFeePoisha: effective.printFeePoisha,
    hasColors: effective.colors.length > 0,
  };
}

/* ------------------------------------------------------------------ */
/* Admin order projection (data.pod)                                   */
/* ------------------------------------------------------------------ */

export interface OrderPodView extends PodNotePayload {
  /** True once a staff member has attested the print is done
   *  (the `[pod-printed]` note exists). */
  printed: boolean;
}

/**
 * The order's POD view, parsed from its create-time order note —
 * the rental precedent (getOrderRentalView rides the admin order
 * GET as data.rental), with notes standing in for the table that
 * this vertical deliberately does not have. Null when the order
 * carries no custom print. The detail page + print centre read
 * the frozen fee from here to decompose it out of their money
 * residuals, exactly like the deposit.
 */
export async function getOrderPodView(orderId: string): Promise<OrderPodView | null> {
  const notes = await prisma.orderNote.findMany({
    where: { orderId },
    orderBy: { createdAt: "asc" },
    select: { text: true },
  });
  let payload: PodNotePayload | null = null;
  let printed = false;
  for (const note of notes) {
    if (payload === null) payload = podSpecFromNoteText(note.text);
    if (note.text.includes(POD_PRINTED_MARKER)) printed = true;
  }
  if (payload === null) return null;
  return { ...payload, printed };
}

/* ------------------------------------------------------------------ */
/* Print queue (admin)                                                 */
/* ------------------------------------------------------------------ */

export interface PrintQueueRow {
  orderId: string;
  orderNo: string;
  orderStatus: string;
  /** When the order was placed (ISO) — the queue runs oldest
   *  first, the order the press works in. */
  createdAt: string;
  productName: string;
  printText: string;
  printColor: string | null;
  quantity: number;
  /** Total print fee frozen on the order (poisha). */
  feePoisha: number;
  /** First name only + masked phone — the queue never carries a
   *  customer's full identity (the social-proof privacy rule). */
  customerFirstName: string;
  customerPhoneMasked: string;
}

export interface PrintQueue {
  rows: PrintQueueRow[];
  /** Orders still waiting for the press (== rows.length; kept as
   *  a named field so the board header reads plainly). */
  pendingCount: number;
}

/** Order statuses that never reach the press: the order is closed
 *  (delivered), dead (cancelled), or the money went back
 *  (refunded / returned) — printing any of them would waste the
 *  blank. Everything else with an unprinted `[pod:]` note waits
 *  in the queue, including SHIPPED (a shipped-but-unmarked order
 *  is a process miss staff should still see and clear). */
const PRINT_QUEUE_EXCLUDED_STATUSES: OrderStatus[] = ["CANCELLED", "DELIVERED", "REFUNDED", "RETURNED"];

export async function getPrintQueue(): Promise<PrintQueue> {
  const podNotes = await prisma.orderNote.findMany({
    where: { text: { contains: POD_NOTE_MARKER_PREFIX } },
    orderBy: { createdAt: "asc" },
    take: 1000,
    select: { orderId: true, text: true },
  });
  const specByOrder = new Map<string, PodNotePayload>();
  for (const note of podNotes) {
    if (!specByOrder.has(note.orderId)) {
      const spec = podSpecFromNoteText(note.text);
      if (spec) specByOrder.set(note.orderId, spec);
    }
  }
  const orderIds = [...specByOrder.keys()];
  if (orderIds.length === 0) return { rows: [], pendingCount: 0 };

  const [orders, printedNotes] = await Promise.all([
    prisma.order.findMany({
      where: { id: { in: orderIds }, status: { notIn: PRINT_QUEUE_EXCLUDED_STATUSES } },
      select: {
        id: true,
        orderNo: true,
        status: true,
        customerName: true,
        customerPhone: true,
        createdAt: true,
        items: { select: { variantId: true, productName: true, quantity: true } },
      },
    }),
    prisma.orderNote.findMany({
      where: { orderId: { in: orderIds }, text: { contains: POD_PRINTED_MARKER } },
      select: { orderId: true },
    }),
  ]);
  const printedOrderIds = new Set(printedNotes.map((n) => n.orderId));
  const orderById = new Map(orders.map((o) => [o.id, o]));

  const rows: PrintQueueRow[] = [];
  for (const orderId of orderIds) {
    if (printedOrderIds.has(orderId)) continue;
    const order = orderById.get(orderId);
    const spec = specByOrder.get(orderId);
    if (!order || !spec) continue;
    const line = order.items.find((i) => i.variantId === spec.variantId);
    rows.push({
      orderId: order.id,
      orderNo: order.orderNo,
      orderStatus: order.status,
      createdAt: order.createdAt.toISOString(),
      productName: spec.productName ?? line?.productName ?? "—",
      printText: spec.printText,
      printColor: spec.printColor,
      quantity: line ? qtyNumber(line.quantity) : spec.quantity,
      feePoisha: spec.feePoisha,
      customerFirstName: order.customerName.trim().split(/\s+/)[0] ?? "",
      customerPhoneMasked: maskPhone(order.customerPhone),
    });
  }
  // Oldest first — podNotes were read in note-creation order and
  // orderIds preserved it; the queue is a press line, not a feed.
  return { rows, pendingCount: rows.length };
}

export type MarkPrintedResult =
  | { ok: true; orderId: string; alreadyPrinted: boolean }
  | { ok: false; httpStatus: 404; code: string; message: string };

/**
 * Attest that an order's custom print is done: appends the
 * `[pod-printed]` order note under the staff member's authorship.
 * Idempotent — an order already attested returns
 * alreadyPrinted:true and gains NO second note. An order with no
 * POD customisation is a 404 (there is nothing to print).
 */
export async function markPodPrinted(
  orderId: string,
  authorId: string,
): Promise<MarkPrintedResult> {
  const view = await getOrderPodView(orderId);
  if (view === null) {
    return {
      ok: false,
      httpStatus: 404,
      code: "POD_NOT_FOUND",
      message: "এই অর্ডারে কোনো কাস্টম প্রিন্ট নেই। / This order has no custom print.",
    };
  }
  if (view.printed) return { ok: true, orderId, alreadyPrinted: true };
  await prisma.orderNote.create({
    data: { orderId, authorId, text: POD_PRINTED_NOTE_TEXT },
  });
  return { ok: true, orderId, alreadyPrinted: false };
}
