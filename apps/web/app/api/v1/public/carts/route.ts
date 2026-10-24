/**
 * Public cart API — /api/v1/public/carts
 *
 * GET  ?ownerKey=<guest key>  -> { data: { cart }, meta }
 * POST { ownerKey?, items: [{ variantId, quantity }] } -> create/replace cart
 *
 * REAL here: Zod validation on every input, integer-poisha pricing from the
 * SERVER price source only (client unitPricePoisha is ignored and overwritten),
 * stock clamping to server stock with a correction flag in meta. Prices/stock
 * resolve from the REAL catalog DB (ACTIVE products via the Prisma
 * repository) — never from mock data.
 *
 * STILL TEMPORARY: the carts themselves live in a module-level Map only
 * (meta db: "NOT_WIRED"). Replace with Prisma Cart/CartItem (see
 * orders/SCHEMA-ADDITIONS.md) in the orders module's persistence swap.
 * A cart returned here is NOT persisted to a database.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { tryCatalogRepository } from "@/catalog/server-read";
import { cartItemCount, cartSubtotalPoisha, type Cart, type CartItem } from "@/cart/types";

const addCartSchema = z.object({
  ownerKey: z.string().min(1).optional(),
  items: z
    .array(
      z.object({
        variantId: z.string().min(1),
        quantity: z.number().int().positive(),
        // Accepted for client compatibility but NEVER trusted — overwritten server-side.
        unitPricePoisha: z.number().int().nonnegative().optional(),
      }),
    )
    .min(1),
  couponCode: z.string().optional(),
});

interface ServerPrice {
  productId: string;
  name: string;
  sku: string;
  unitPricePoisha: number;
  stock: number;
}

/** Server-side price/stock source: ACTIVE catalog products from the DB. */
async function loadServerPrices(): Promise<Map<string, ServerPrice> | null> {
  const repo = await tryCatalogRepository();
  if (!repo) return null;
  const { products } = await repo.listProducts({ status: "ACTIVE", page: 1, pageSize: 100 });
  const prices = new Map<string, ServerPrice>();
  for (const product of products) {
    for (const variant of product.variants) {
      if (!variant.isActive) continue;
      prices.set(variant.id, {
        productId: product.id,
        name: product.title.en,
        sku: variant.sku,
        unitPricePoisha: variant.pricePoisha,
        stock: variant.stock,
      });
    }
  }
  return prices;
}

// TEMPORARY store — NOT a DB (cart persistence is the orders module's swap).
const TEMPORARY_CARTS = new Map<string, Cart>();

function errorResponse(code: string, message: string, status: number, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

function emptyCart(ownerKey: string): Cart {
  return { ownerKey, ownerType: "guest", items: [], updatedAt: new Date().toISOString() };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const ownerKey = url.searchParams.get("ownerKey") ?? "";
  if (!ownerKey) return errorResponse("VALIDATION_ERROR", "ownerKey is required.", 400);
  const cart = TEMPORARY_CARTS.get(ownerKey) ?? emptyCart(ownerKey);
  return NextResponse.json({
    data: {
      cart,
      subtotalPoisha: cartSubtotalPoisha(cart),
      itemCount: cartItemCount(cart),
    },
    meta: { db: "NOT_WIRED", source: "TEMPORARY_MOCK_STORE", priceSource: "database" },
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = addCartSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("VALIDATION_ERROR", "Cart input invalid.", 400, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  const serverPrices = await loadServerPrices();
  if (!serverPrices) return errorResponse("DB_NOT_READY", "Catalog database is not available.", 503);
  const ownerKey = parsed.data.ownerKey ?? crypto.randomUUID();
  const items: CartItem[] = [];
  let corrected = false;
  for (const input of parsed.data.items) {
    const server = serverPrices.get(input.variantId);
    if (!server) return errorResponse("VARIANT_NOT_FOUND", `Variant not found: ${input.variantId}`, 400);
    const quantity = Math.min(input.quantity, server.stock);
    if (quantity !== input.quantity || (input.unitPricePoisha !== undefined && input.unitPricePoisha !== server.unitPricePoisha)) {
      corrected = true;
    }
    if (quantity > 0) {
      items.push({
        variantId: input.variantId,
        productId: server.productId,
        name: server.name,
        sku: server.sku,
        unitPricePoisha: server.unitPricePoisha, // server price, never the client's
        quantity,
        availableStock: server.stock,
      });
    }
  }
  const cart: Cart = {
    ownerKey,
    ownerType: "guest",
    items,
    couponCode: parsed.data.couponCode,
    updatedAt: new Date().toISOString(),
  };
  TEMPORARY_CARTS.set(ownerKey, cart);
  return NextResponse.json(
    {
      data: { cart, subtotalPoisha: cartSubtotalPoisha(cart), itemCount: cartItemCount(cart) },
      meta: { db: "NOT_WIRED", source: "TEMPORARY_MOCK_STORE", priceSource: "database", corrected },
    },
    { status: 201 },
  );
}
