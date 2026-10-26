/**
 * Warehouse pick lists — ADV-21 (doc 22).
 *
 * A pick list is a staff work document for a batch of CONFIRMED
 * orders: lines grouped by variant (what to fetch, how many, where
 * the per-order quantities separate at pack time) plus a per-order
 * pack checklist whose ticks are staff attestations.
 *
 * PERSISTENCE: pick lists must survive a page reload for the packer,
 * so they live in ONE zod-validated JSON document in the Setting
 * table (`warehouse.pick_lists`) — the established JSON-doc pattern
 * (src/reports/saved-reports.ts, src/vendors/kyc-store.ts). No new
 * table, no migration. The key/value store is injectable so the
 * logic is smoke-testable; production uses the Prisma store.
 *
 * HONESTY RULES (do not weaken):
 *  - Creating or completing a pick list moves NO stock. Stock was
 *    already reserved when each order was created; the UI says so.
 *    Completing a list is a staff attestation only.
 *  - Pack ticks are attestations recorded on this document. When an
 *    order's lines are ALL ticked, exactly one timeline note is
 *    written on the order (the OrderNote marker seam below) — that
 *    note is the durable "packed" record other surfaces read back.
 *  - Bin locations come from the inventory read model IF it carries
 *    a bin field at runtime (ADV-20 adds batch/bin data in a parallel
 *    slice). The read here is defensive: a row without any known bin
 *    field yields null and the UI renders "—", never an invented
 *    location.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { addOrderTimelineNote } from "@/shipments/split-shipments";

export const PICK_LISTS_KEY = "warehouse.pick_lists";

/** Marker token embedded in the OrderNote text written when an
 *  order's pack checklist completes. The note is the packed record:
 *  `warehouse-packed:<pickListId>`. Read back via getPackedMarkers —
 *  the /admin/shipments board (src/shipments/board.ts) can consume
 *  the same helper to badge packed orders without a schema change. */
export const PACKED_NOTE_MARKER = "warehouse-packed:";

/* ------------------------------------------------------------------ */
/* Document schema                                                     */
/* ------------------------------------------------------------------ */

const pickListItemSchema = z.object({
  orderItemId: z.string().min(1),
  variantId: z.string().min(1),
  sku: z.string(),
  productName: z.string(),
  quantity: z.number().int().positive(),
  packed: z.boolean().default(false),
  packedAt: z.string().nullable().default(null),
  packedBy: z.string().nullable().default(null),
});
export type PickListItem = z.infer<typeof pickListItemSchema>;

const pickListOrderSchema = z.object({
  orderId: z.string().min(1),
  orderNo: z.string().min(1),
  customerName: z.string(),
  district: z.string(),
  items: z.array(pickListItemSchema),
  /** ISO instant the pack-completion note was written; null until
   *  every line is ticked. Once set, this order's ticks lock (the
   *  note is append-only history and cannot be un-written). */
  packCompletedAt: z.string().nullable().default(null),
});
export type PickListOrder = z.infer<typeof pickListOrderSchema>;

const pickListLineSchema = z.object({
  variantId: z.string().min(1),
  sku: z.string(),
  productName: z.string(),
  /** Bin/rack location from the inventory read model when it
   *  carries one at runtime; null = no location recorded. */
  binLocation: z.string().nullable().default(null),
  totalQuantity: z.number().int().positive(),
  /** Separation markers for packers: how many of this variant go to
   *  each order in the batch. */
  perOrder: z.array(
    z.object({
      orderId: z.string().min(1),
      orderNo: z.string().min(1),
      quantity: z.number().int().positive(),
    }),
  ),
});
export type PickListLine = z.infer<typeof pickListLineSchema>;

export const pickListSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["OPEN", "DONE"]),
  createdAt: z.string().min(1),
  createdBy: z.string().min(1),
  createdByName: z.string().nullable().default(null),
  completedAt: z.string().nullable().default(null),
  completedBy: z.string().nullable().default(null),
  orders: z.array(pickListOrderSchema),
  lines: z.array(pickListLineSchema),
});
export type PickList = z.infer<typeof pickListSchema>;

const pickListsDocSchema = z.object({
  version: z.literal(1),
  lists: z.array(pickListSchema),
});
export type PickListsDoc = z.infer<typeof pickListsDocSchema>;

const EMPTY_DOC: PickListsDoc = { version: 1, lists: [] };

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export class WarehouseError extends Error {
  constructor(
    public code: string,
    message: string,
    public httpStatus: number,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "WarehouseError";
  }
}

/* ------------------------------------------------------------------ */
/* Key/value store (Setting JSON doc)                                  */
/* ------------------------------------------------------------------ */

export interface KeyValueStore {
  read(key: string): Promise<string | null>;
  write(key: string, value: string, actorId: string): Promise<void>;
}

/** Production store over the Setting table (prisma imported lazily —
 *  the saved-reports pattern — so importing this module never drags
 *  the DB client into pure-logic consumers/tests). */
export function prismaKeyValueStore(): KeyValueStore {
  return {
    async read(key) {
      const { prisma } = await import("@advance-ecommerce/db");
      const row = await prisma.setting.findUnique({ where: { key } });
      return row?.value ?? null;
    },
    async write(key, value, actorId) {
      const { prisma } = await import("@advance-ecommerce/db");
      await prisma.setting.upsert({
        where: { key },
        create: {
          key,
          value,
          valueEncrypted: false,
          isPublic: false,
          category: "general",
          description: "Warehouse pick lists document (JSON, ADV-21)",
          updatedById: actorId,
        },
        update: { value, updatedById: actorId },
      });
    },
  };
}

export async function readPickListsDoc(store: KeyValueStore): Promise<PickListsDoc> {
  const raw = await store.read(PICK_LISTS_KEY);
  if (!raw) return EMPTY_DOC;
  try {
    const parsed = pickListsDocSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : EMPTY_DOC;
  } catch {
    return EMPTY_DOC;
  }
}

async function writePickListsDoc(store: KeyValueStore, doc: PickListsDoc, actorId: string): Promise<void> {
  await store.write(PICK_LISTS_KEY, JSON.stringify(doc), actorId);
}

/* ------------------------------------------------------------------ */
/* Actors                                                              */
/* ------------------------------------------------------------------ */

export interface WarehouseActor {
  id: string;
  name?: string | null;
}

/* ------------------------------------------------------------------ */
/* Bin locations (defensive runtime read — ADV-20 parallel slice)      */
/* ------------------------------------------------------------------ */

/** Field names a bin/rack location might travel under on an
 *  InventoryItem row once ADV-20's bin data lands. Today the model
 *  carries none of them, so every lookup returns null and the UI
 *  shows "—". */
const BIN_FIELD_CANDIDATES = [
  "binLocation",
  "bin",
  "binCode",
  "rackLocation",
  "rack",
  "shelfLocation",
] as const;

function binFromRow(row: unknown): string | null {
  if (row === null || typeof row !== "object") return null;
  const rec = row as Record<string, unknown>;
  for (const field of BIN_FIELD_CANDIDATES) {
    const value = rec[field];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

/** variantId -> bin location (or null). Prefers the row holding the
 *  most stock. Never throws: a missing column/table state simply
 *  means "no location recorded". */
export async function loadBinLocations(variantIds: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  for (const id of variantIds) out.set(id, null);
  if (variantIds.length === 0) return out;
  try {
    const { prisma } = await import("@advance-ecommerce/db");
    const rows = await prisma.inventoryItem.findMany({
      where: { variantId: { in: variantIds } },
      orderBy: { quantityOnHand: "desc" },
    });
    for (const row of rows) {
      const variantId = (row as { variantId: string }).variantId;
      if (out.get(variantId)) continue; // best (fullest) row already gave a bin
      const bin = binFromRow(row);
      if (bin) out.set(variantId, bin);
    }
  } catch {
    // Inventory read unavailable — locations stay null ("—").
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Create                                                              */
/* ------------------------------------------------------------------ */

interface OrderSnapshotRow {
  id: string;
  orderNo: string;
  customerName: string;
  district: string;
  status: string;
  items: Array<{
    id: string;
    variantId: string;
    sku: string;
    productName: string;
    quantity: number;
  }>;
}

/**
 * Create a pick list from a set of CONFIRMED orders. Snapshots the
 * order lines into the document (later order edits never rewrite a
 * printed pick list) and groups them by variant with per-order
 * separation quantities.
 *
 * Rejects: empty/duplicate selection (400), unknown order (404),
 * any order not CONFIRMED (409, offenders named), any order already
 * on an OPEN pick list (409 — two teams must never pick the same
 * order twice).
 */
export async function createPickList(
  store: KeyValueStore,
  orderIds: string[],
  actor: WarehouseActor,
): Promise<PickList> {
  const uniqueIds = [...new Set(orderIds.map((id) => id.trim()).filter(Boolean))];
  if (uniqueIds.length === 0) {
    throw new WarehouseError("EMPTY_SELECTION", "অন্তত একটি অর্ডার সিলেক্ট করুন।", 400);
  }

  const { prisma } = await import("@advance-ecommerce/db");
  const rows = (await prisma.order.findMany({
    where: { id: { in: uniqueIds }, deletedAt: null },
    include: {
      items: { orderBy: { createdAt: "asc" } },
    },
  })) as OrderSnapshotRow[];

  const byId = new Map(rows.map((r) => [r.id, r]));
  const missing = uniqueIds.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new WarehouseError("ORDER_NOT_FOUND", "কয়েকটি অর্ডার পাওয়া যায়নি।", 404, { missing });
  }
  const notConfirmed = rows.filter((r) => r.status !== "CONFIRMED");
  if (notConfirmed.length > 0) {
    throw new WarehouseError(
      "ORDERS_NOT_CONFIRMED",
      "শুধু CONFIRMED অর্ডার পিক লিস্টে নেওয়া যায়।",
      409,
      { orders: notConfirmed.map((r) => ({ orderNo: r.orderNo, status: r.status })) },
    );
  }

  const doc = await readPickListsDoc(store);
  const openLists = doc.lists.filter((l) => l.status === "OPEN");
  const alreadyListed = new Map<string, string>(); // orderId -> open list id
  for (const list of openLists) {
    for (const order of list.orders) alreadyListed.set(order.orderId, list.id);
  }
  const clashes = rows.filter((r) => alreadyListed.has(r.id));
  if (clashes.length > 0) {
    throw new WarehouseError(
      "ALREADY_IN_OPEN_PICK_LIST",
      "কয়েকটি অর্ডার ইতিমধ্যে একটি খোলা পিক লিস্টে আছে।",
      409,
      { orders: clashes.map((r) => ({ orderNo: r.orderNo, pickListId: alreadyListed.get(r.id) })) },
    );
  }

  // Keep staff selection order for the per-order sections.
  const orderedRows = uniqueIds.map((id) => byId.get(id) as OrderSnapshotRow);
  const variantIds = [...new Set(orderedRows.flatMap((r) => r.items.map((i) => i.variantId)))];
  const bins = await loadBinLocations(variantIds);

  const orders: PickListOrder[] = orderedRows.map((r) => ({
    orderId: r.id,
    orderNo: r.orderNo,
    customerName: r.customerName,
    district: r.district,
    items: r.items.map((i) => ({
      orderItemId: i.id,
      variantId: i.variantId,
      sku: i.sku,
      productName: i.productName,
      quantity: i.quantity,
      packed: false,
      packedAt: null,
      packedBy: null,
    })),
    packCompletedAt: null,
  }));

  const lineMap = new Map<string, PickListLine>();
  for (const order of orders) {
    for (const item of order.items) {
      let line = lineMap.get(item.variantId);
      if (!line) {
        line = {
          variantId: item.variantId,
          sku: item.sku,
          productName: item.productName,
          binLocation: bins.get(item.variantId) ?? null,
          totalQuantity: 0,
          perOrder: [],
        };
        lineMap.set(item.variantId, line);
      }
      line.totalQuantity += item.quantity;
      line.perOrder.push({ orderId: order.orderId, orderNo: order.orderNo, quantity: item.quantity });
    }
  }
  // Fetch order: bin first (known locations first), then name — a
  // picker walks shelves, not alphabet.
  const lines = [...lineMap.values()].sort((a, b) => {
    if (a.binLocation && !b.binLocation) return -1;
    if (!a.binLocation && b.binLocation) return 1;
    if (a.binLocation && b.binLocation && a.binLocation !== b.binLocation) {
      return a.binLocation.localeCompare(b.binLocation);
    }
    return a.productName.localeCompare(b.productName);
  });

  const list: PickList = {
    id: randomUUID(),
    status: "OPEN",
    createdAt: new Date().toISOString(),
    createdBy: actor.id,
    createdByName: actor.name ?? null,
    completedAt: null,
    completedBy: null,
    orders,
    lines,
  };
  doc.lists.push(list);
  await writePickListsDoc(store, doc, actor.id);
  return list;
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export async function listPickLists(store: KeyValueStore): Promise<PickList[]> {
  const doc = await readPickListsDoc(store);
  return [...doc.lists].sort((a, b) => {
    if (a.status !== b.status) return a.status === "OPEN" ? -1 : 1;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

export async function getPickList(store: KeyValueStore, id: string): Promise<PickList | null> {
  const doc = await readPickListsDoc(store);
  return doc.lists.find((l) => l.id === id) ?? null;
}

/** orderId -> the OPEN pick list currently holding it (queue badge). */
export async function openPickListByOrder(store: KeyValueStore): Promise<Map<string, string>> {
  const doc = await readPickListsDoc(store);
  const out = new Map<string, string>();
  for (const list of doc.lists) {
    if (list.status !== "OPEN") continue;
    for (const order of list.orders) out.set(order.orderId, list.id);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Complete (staff attestation only — moves NO stock)                  */
/* ------------------------------------------------------------------ */

export async function completePickList(
  store: KeyValueStore,
  id: string,
  actor: WarehouseActor,
): Promise<PickList> {
  const doc = await readPickListsDoc(store);
  const list = doc.lists.find((l) => l.id === id);
  if (!list) throw new WarehouseError("PICK_LIST_NOT_FOUND", "পিক লিস্ট পাওয়া যায়নি।", 404);
  if (list.status === "DONE") return list; // idempotent
  list.status = "DONE";
  list.completedAt = new Date().toISOString();
  list.completedBy = actor.id;
  await writePickListsDoc(store, doc, actor.id);
  return list;
}

/* ------------------------------------------------------------------ */
/* Pack checklist                                                      */
/* ------------------------------------------------------------------ */

export interface PackTickResult {
  list: PickList;
  /** True when this tick finished the order's checklist and the
   *  pack-completion timeline note was written. */
  orderPackCompleted: boolean;
}

/** The note text recorded on the order timeline when packing
 *  completes. The marker token makes the note machine-findable for
 *  read-back (getPackedMarkers) without a schema field. */
export function buildPackedNoteText(list: PickList, actor: WarehouseActor): string {
  const who = actor.name ? ` — ${actor.name}` : "";
  return `প্যাক সম্পন্ন ✅ পিক লিস্ট ${list.id.slice(0, 8)}${who} · ${PACKED_NOTE_MARKER}${list.id}`;
}

/**
 * Tick (or un-tick) one line of one order's pack checklist.
 *
 * Ticks are attestations on the pick-list document. The tick that
 * completes an order writes exactly one timeline note via the
 * existing note seam (addOrderTimelineNote — the same seam the
 * split-shipment / conversion flows write through) and stamps
 * packCompletedAt; afterwards that order's ticks lock, because the
 * timeline note is append-only history. Un-ticking before
 * completion is free.
 *
 * `noteWriter` is injectable for tests; production passes the real
 * addOrderTimelineNote.
 */
export async function setPackItem(
  store: KeyValueStore,
  listId: string,
  orderId: string,
  orderItemId: string,
  packed: boolean,
  actor: WarehouseActor,
  noteWriter: (orderId: string, text: string) => Promise<void> = addOrderTimelineNote,
): Promise<PackTickResult> {
  const doc = await readPickListsDoc(store);
  const list = doc.lists.find((l) => l.id === listId);
  if (!list) throw new WarehouseError("PICK_LIST_NOT_FOUND", "পিক লিস্ট পাওয়া যায়নি।", 404);
  if (list.status !== "OPEN") {
    throw new WarehouseError("PICK_LIST_CLOSED", "এই পিক লিস্ট সম্পন্ন — আর বদলানো যাবে না।", 409);
  }
  const order = list.orders.find((o) => o.orderId === orderId);
  if (!order) throw new WarehouseError("ORDER_NOT_IN_LIST", "এই অর্ডার এই পিক লিস্টে নেই।", 404);
  if (order.packCompletedAt) {
    throw new WarehouseError(
      "PACK_ALREADY_RECORDED",
      "এই অর্ডারের প্যাক সম্পন্ন হয়ে টাইমলাইনে নোট লেখা হয়ে গেছে — টিক বদলানো যাবে না।",
      409,
    );
  }
  const item = order.items.find((i) => i.orderItemId === orderItemId);
  if (!item) throw new WarehouseError("ITEM_NOT_IN_LIST", "এই আইটেম এই অর্ডারে নেই।", 404);

  item.packed = packed;
  item.packedAt = packed ? new Date().toISOString() : null;
  item.packedBy = packed ? actor.id : null;

  let orderPackCompleted = false;
  if (packed && order.items.every((i) => i.packed)) {
    await noteWriter(order.orderId, buildPackedNoteText(list, actor));
    order.packCompletedAt = new Date().toISOString();
    orderPackCompleted = true;
  }
  await writePickListsDoc(store, doc, actor.id);
  return { list, orderPackCompleted };
}

/* ------------------------------------------------------------------ */
/* Packed markers (read-back over OrderNote)                           */
/* ------------------------------------------------------------------ */

export interface PackedMarker {
  orderId: string;
  pickListId: string;
  at: string;
}

/** orderId -> packed marker, read back from the OrderNote timeline
 *  (the durable packed record). This is the seam the shipments
 *  board can consume to badge packed orders — no Shipment field
 *  exists for it and none was invented. */
export async function getPackedMarkers(orderIds: string[]): Promise<Map<string, PackedMarker>> {
  const out = new Map<string, PackedMarker>();
  if (orderIds.length === 0) return out;
  const { prisma } = await import("@advance-ecommerce/db");
  const notes = await prisma.orderNote.findMany({
    where: { orderId: { in: orderIds }, text: { contains: PACKED_NOTE_MARKER } },
    orderBy: { createdAt: "asc" },
    select: { orderId: true, text: true, createdAt: true },
  });
  for (const note of notes) {
    if (out.has(note.orderId)) continue; // earliest completion wins
    const match = note.text.match(new RegExp(`${PACKED_NOTE_MARKER}(\\S+)`));
    out.set(note.orderId, {
      orderId: note.orderId,
      pickListId: match?.[1] ?? "",
      at: note.createdAt.toISOString(),
    });
  }
  return out;
}
