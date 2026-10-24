/**
 * POST /api/v1/public/carts/merge — merge a guest cart into a user cart.
 * Body: { guestCart: Cart, userCart: Cart } (both validated for shape only;
 * prices are re-validated again at checkout, never here).
 * REAL here: pure mergeGuestIntoUserCart() (same variant -> quantities add).
 * TEMPORARY: carts are caller-supplied values, not DB rows — once Cart tables
 * land (Agent 6), this route must load both carts from the DB in one
 * transaction and delete the guest cart row after merging.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { mergeGuestIntoUserCart } from "@/cart/types";

const cartItemSchema = z.object({
  variantId: z.string().min(1),
  productId: z.string().min(1),
  name: z.string().min(1),
  sku: z.string().min(1),
  unitPricePoisha: z.number().int().nonnegative(),
  quantity: z.number().int().positive(),
  availableStock: z.number().int().nonnegative(),
  imageUrl: z.string().optional(),
});

const cartSchema = z.object({
  ownerKey: z.string().min(1),
  ownerType: z.enum(["guest", "user"]),
  items: z.array(cartItemSchema),
  couponCode: z.string().optional(),
  updatedAt: z.string(),
});

const bodySchema = z.object({ guestCart: cartSchema, userCart: cartSchema });

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Cart merge input invalid.",
          details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        },
      },
      { status: 400 },
    );
  }
  const merged = mergeGuestIntoUserCart(parsed.data.guestCart, parsed.data.userCart);
  return NextResponse.json({
    data: { cart: merged },
    meta: { db: "NOT_WIRED", note: "Merge is computed from caller-supplied carts, not DB rows, until Cart tables land." },
  });
}
