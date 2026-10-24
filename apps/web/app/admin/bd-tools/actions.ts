"use server";

/**
 * BD Tools — payment-link server actions (Agent 41).
 *
 * Why a server action: src/bd/payment-link.ts uses node:crypto
 * (SHA-256 token hashing, random token generation), so it can never be
 * imported by a client component. These actions are the thin server
 * bridge the /admin/bd-tools payment-link panel calls — the same
 * service + demo store the API route (app/api/v1/admin/bd/payment-links,
 * RBAC payments.view / payments.verify_manual) uses.
 *
 * SECURITY: the list view NEVER carries the full token hash — only a
 * short prefix for staff recognition. The plain token is returned
 * exactly once, from createBdPaymentLinkAction, mirroring
 * createPaymentLink()'s contract.
 *
 * Persistence: demoPaymentLinkStore is IN-MEMORY-DEMO (process-local,
 * lost on restart) — same store the public /pay/[token] page resolves
 * against, so a link created here really does open there locally.
 */
import {
  createPaymentLink,
  createPaymentLinkSchema,
  demoPaymentLinkStore,
  withEffectiveStatus,
  type PaymentLinkRecord,
  type PaymentLinkStatus,
} from "@/bd/payment-link";

export interface PaymentLinkListItemView {
  id: string;
  orderId: string;
  amountPoisha: number;
  purpose: string;
  status: PaymentLinkStatus;
  /** First 10 hex chars of the token hash — recognition only, never the token. */
  tokenHashPrefix: string;
  createdAt: string;
  expiresAt: string;
  paidAt: string | null;
}

function toListItem(record: PaymentLinkRecord): PaymentLinkListItemView {
  const effective = withEffectiveStatus(record);
  return {
    id: effective.id,
    orderId: effective.orderId,
    amountPoisha: effective.amountPoisha,
    purpose: effective.purpose,
    status: effective.status,
    tokenHashPrefix: effective.tokenHash.slice(0, 10),
    createdAt: effective.createdAt,
    expiresAt: effective.expiresAt,
    paidAt: effective.paidAt,
  };
}

export type CreateBdPaymentLinkResult =
  | { ok: true; link: PaymentLinkListItemView; plainToken: string; url: string }
  | { ok: false; error: string };

export async function createBdPaymentLinkAction(input: {
  orderId: string;
  amountPoisha: number;
  purpose: string;
  ttlMinutes: number;
}): Promise<CreateBdPaymentLinkResult> {
  const parsed = createPaymentLinkSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "তথ্য সঠিক নয় — অর্ডার আইডি, পরিমাণ (পয়সায় ধনাত্মক পূর্ণসংখ্যা) ও মেয়াদ যাচাই করুন।" };
  }
  const created = createPaymentLink(parsed.data);
  demoPaymentLinkStore.add(created.record);
  return {
    ok: true,
    link: toListItem(created.record),
    plainToken: created.plainToken,
    url: created.url,
  };
}

export async function listBdPaymentLinksAction(orderId: string): Promise<PaymentLinkListItemView[]> {
  return demoPaymentLinkStore.listByOrder(orderId).map(toListItem);
}
