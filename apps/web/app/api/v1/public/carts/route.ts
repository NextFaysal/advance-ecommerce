/**
 * Public cart API — /api/v1/public/carts
 *
 * GET  ?ownerKey=<guest key>  -> { data: { cart }, meta }
 * POST { ownerKey?, items: [{ variantId, quantity }] } -> create/replace cart
 *
 * REAL here: Zod validation on every input, integer-poisha pricing from the
 * SERVER price source only (client unitPricePoisha is ignored and overwritten),
 * stock clamping to server stock with a correction flag in meta.
 *
 * TEMPORARY MOCK: carts live in a module-level Map only, prices/stock come from
 * src/catalog/mock.ts. Replace both with Prisma Cart/CartItem (see
 * orders/SCHEMA-ADDITIONS.md) once Agent 6 merges the schema and Prisma
 * generate succeeds. A cart returned here is NOT persisted to a database.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { MOCK_PRODUCTS } from "@/catalog/mock";
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

const SERVER_PRICES = new Map<string, { productId: string; name: string; sku: string; unitPricePoisha: number; stock: number }>();
for (const product of MOCK_PRODUCTS) {
  for (const variant of product.variants) {
    SERVER_PRICES.set(variant.id, {
      productId: product.id,
      name: product.title.en,
      sku: variant.sku,
      unitPricePoisha: variant.pricePoisha,
      stock: variant.stock,
    });
  }
}

// TEMPORARY MOCK store — NOT a DB.
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
    meta: { db: "NOT_WIRED", source: "TEMPORARY_MOCK_STORE" },
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = addCartSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("VALIDATION_ERROR", "Cart input invalid.", 400, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  const ownerKey = parsed.data.ownerKey ?? crypto.randomUUID();
  const items: CartItem[] = [];
  let corrected = false;
  for (const input of parsed.data.items) {
    const server = SERVER_PRICES.get(input.variantId);
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
      meta: { db: "NOT_WIRED", source: "TEMPORARY_MOCK_STORE", corrected },
    },
    { status: 201 },
  );
}
