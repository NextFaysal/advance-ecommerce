import { addQty, isValidQtyNumber } from "@/lib/quantity";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@advance-ecommerce/db";
import { guardError, requireAdmin } from "@/reports/guard";
import { parseCsv } from "@/catalog/import";
import { normalizeBdPhone } from "@/checkout/validation";
import { zoneForDistrict } from "@/checkout/shipping-core";
import { createManualOrder, type ManualCreateInput } from "@/orders/manual-create";

// Bulk order import from CSV — doc 17 batch O4 (wave 22).
// Guard: orders.create (src/reports/guard), same as the other admin
// order mutations. Body mirrors the product import: JSON { csv }.
//
// FORMAT — one row per ITEM; rows sharing a phone are ONE order:
//   phone,name,division,district,upazila,addressLine,sku,quantity[,paymentMethod][,note]
//   - phone         BD mobile (01XXXXXXXXX or +8801XXXXXXXXX) — the
//                   grouping key (with the group name from its first row).
//   - name          customer name (>= 2 chars).
//   - division/district/upazila/addressLine — the delivery address
//                   (taken from the group's first row).
//   - sku           a ProductVariant SKU; prices are the CATALOG
//                   prices — the file never sets prices.
//   - quantity      positive number (fractions to 3 decimals allowed
//                   since wave 59 — the create path gates fractions to
//                   weighted variants); the same SKU twice in a group
//                   is merged into one line with summed quantity.
//   - paymentMethod optional: cod (default) | bkash | nagad.
//   - note          optional; distinct row notes are joined onto the
//                   order note.
// Shipping is computed by the shared engine from the district
// (zoneForDistrict), never read from the file.
//
// Each group is its own createManualOrder call — its own create
// transaction — so one bad group (unknown SKU, bad phone, stock,
// fraud block) fails alone with a per-group reason and never leaves
// a half-imported order behind; the other groups still import.
// Caps: 200 data rows / 50 groups per upload (422 beyond).
const MAX_ROWS = 200;
const MAX_GROUPS = 50;

const REQUIRED_HEADERS = [
  "phone",
  "name",
  "division",
  "district",
  "upazila",
  "addressline",
  "sku",
  "quantity",
] as const;

const bodySchema = z.object({ csv: z.string().min(1) });

interface ImportGroup {
  /** Grouping key: normalized phone when valid, else the raw cell. */
  key: string;
  phoneRaw: string;
  name: string;
  division: string;
  district: string;
  upazila: string;
  addressLine: string;
  paymentMethodRaw: string;
  notes: string[];
  /** sku -> summed quantity, first-seen order. */
  items: Map<string, number>;
  /** First row-level problem found (bad quantity / empty sku). */
  rowError: string | null;
}

export interface OrderImportGroupResult {
  phone: string;
  ok: boolean;
  orderId?: string;
  orderNo?: string;
  error?: string;
}

function groupError(group: ImportGroup, error: string): OrderImportGroupResult {
  return { phone: group.phoneRaw, ok: false, error };
}

export async function POST(req: Request) {
  const guard = await requireAdmin("orders.create");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });

  const parsedBody = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "CSV পাঠান { csv: string } আকারে। / Send the CSV as { csv: string }.",
        },
      },
      { status: 400 },
    );
  }

  const { headers, rows } = parseCsv(parsedBody.data.csv);
  const missing = REQUIRED_HEADERS.filter((h) => !headers.includes(h));
  if (missing.length > 0) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: `CSV-তে প্রয়োজনীয় কলাম নেই: ${missing.join(", ")}। / The CSV is missing required columns: ${missing.join(", ")}.`,
          details: { missing },
        },
      },
      { status: 400 },
    );
  }
  if (rows.length > MAX_ROWS) {
    return NextResponse.json(
      {
        error: {
          code: "IMPORT_TOO_LARGE",
          message: `একবারে সর্বোচ্চ ${MAX_ROWS}টি সারি ইমপোর্ট করা যাবে (পেয়েছি ${rows.length}টি)। / At most ${MAX_ROWS} rows can be imported at once (got ${rows.length}).`,
        },
      },
      { status: 422 },
    );
  }

  // Group rows by phone (+ the name/address of the first row).
  const groups = new Map<string, ImportGroup>();
  for (const row of rows) {
    const phoneRaw = row.phone ?? "";
    const normalized = normalizeBdPhone(phoneRaw);
    const key = normalized ?? `raw:${phoneRaw}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        phoneRaw,
        name: row.name ?? "",
        division: row.division ?? "",
        district: row.district ?? "",
        upazila: row.upazila ?? "",
        addressLine: row.addressline ?? "",
        paymentMethodRaw: (row.paymentmethod ?? "").toLowerCase(),
        notes: [],
        items: new Map(),
        rowError: null,
      };
      groups.set(key, group);
    }
    const note = (row.note ?? "").trim();
    if (note && !group.notes.includes(note)) group.notes.push(note);
    const sku = (row.sku ?? "").trim();
    const qty = Number(row.quantity ?? "");
    if (!sku) {
      group.rowError ??= "SKU খালি / SKU is empty on a row.";
    } else if (!isValidQtyNumber(qty)) {
      // Wave 59: fractional quantities (weighted goods) import fine;
      // the create path still gates fractions to weighted variants.
      group.rowError ??= `SKU ${sku}-এর পরিমাণ সঠিক নয় / Invalid quantity for SKU ${sku}.`;
    } else {
      group.items.set(sku, addQty(group.items.get(sku) ?? 0, qty));
    }
  }
  if (groups.size > MAX_GROUPS) {
    return NextResponse.json(
      {
        error: {
          code: "IMPORT_TOO_LARGE",
          message: `একবারে সর্বোচ্চ ${MAX_GROUPS}টি গ্রাহক-গ্রুপ ইমপোর্ট করা যাবে (পেয়েছি ${groups.size}টি)। / At most ${MAX_GROUPS} customer groups can be imported at once (got ${groups.size}).`,
        },
      },
      { status: 422 },
    );
  }

  // Resolve every referenced SKU once (catalog prices only).
  const allSkus = [...new Set([...groups.values()].flatMap((g) => [...g.items.keys()]))];
  const variants =
    allSkus.length > 0
      ? await prisma.productVariant.findMany({
          where: { sku: { in: allSkus }, deletedAt: null },
          select: { id: true, sku: true, pricePoisha: true },
        })
      : [];
  const variantBySku = new Map(variants.map((v) => [v.sku, v]));

  const actor = {
    id: guard.userId,
    permissions: guard.permissions,
    ip: req.headers.get("x-forwarded-for") ?? undefined,
    userAgent: req.headers.get("user-agent") ?? undefined,
  };

  const results: OrderImportGroupResult[] = [];
  for (const group of groups.values()) {
    if (group.rowError) {
      results.push(groupError(group, group.rowError));
      continue;
    }
    const phone = normalizeBdPhone(group.phoneRaw);
    if (!phone) {
      results.push(
        groupError(group, "ফোন নম্বর সঠিক নয় / Invalid BD phone number."),
      );
      continue;
    }
    const paymentMethod = group.paymentMethodRaw === "" ? "cod" : group.paymentMethodRaw;
    if (paymentMethod !== "cod" && paymentMethod !== "bkash" && paymentMethod !== "nagad") {
      results.push(
        groupError(
          group,
          `অজানা পেমেন্ট মাধ্যম: ${group.paymentMethodRaw} / Unknown paymentMethod: ${group.paymentMethodRaw} (cod | bkash | nagad).`,
        ),
      );
      continue;
    }
    const unknownSku = [...group.items.keys()].find((sku) => !variantBySku.has(sku));
    if (unknownSku) {
      results.push(
        groupError(group, `অজানা SKU: ${unknownSku} / Unknown SKU: ${unknownSku}.`),
      );
      continue;
    }
    const items: ManualCreateInput["items"] = [...group.items.entries()].map(([sku, quantity]) => {
      const variant = variantBySku.get(sku)!;
      return { variantId: variant.id, quantity, unitPricePoisha: variant.pricePoisha };
    });
    try {
      const result = await createManualOrder(
        {
          phone,
          customerName: group.name,
          address: {
            division: group.division,
            district: group.district,
            upazila: group.upazila,
            addressLine: group.addressLine,
          },
          items,
          paymentMethod,
          shippingMethod: zoneForDistrict(group.district),
          note: group.notes.length > 0 ? group.notes.join("; ").slice(0, 500) : undefined,
          source: "import",
          internalNote: `CSV ইমপোর্ট থেকে তৈরি / Created via CSV order import`,
        },
        actor,
      );
      if (!result.ok) {
        results.push(groupError(group, `${result.code}: ${result.message}`));
      } else {
        results.push({ phone, ok: true, orderId: result.orderId, orderNo: result.orderNo });
      }
    } catch (e) {
      results.push(
        groupError(group, `অপ্রত্যাশিত ত্রুটি / Unexpected error: ${e instanceof Error ? e.message : String(e)}`),
      );
    }
  }

  const created = results.filter((r) => r.ok).length;
  return NextResponse.json({
    data: { results, created, failed: results.length - created },
    meta: { db: "PRISMA", source: "DATABASE", rows: rows.length, groups: groups.size },
  });
}
