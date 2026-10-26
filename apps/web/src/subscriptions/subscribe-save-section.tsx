/**
 * PDP mount point for Subscribe & Save (ADV-18 remainder) — a server
 * component so the module flag + the configured discount are read
 * server-side (the PDP is ISR; the section re-evaluates at
 * revalidation like the PDP's other sections). Flag OFF -> renders
 * nothing at all; there is no placeholder UI for a locked module.
 */
import { subscriptionsEnabled } from "./flags";
import { loadSubscriptionDiscountBps } from "./service";
import { SubscribeSaveCard, type SubscribeVariantOption } from "./subscribe-save-card";

export async function SubscribeSaveSection({ variants }: { variants: SubscribeVariantOption[] }) {
  if (variants.length === 0) return null;
  if (!subscriptionsEnabled()) return null;
  const discountBps = await loadSubscriptionDiscountBps();
  return <SubscribeSaveCard variants={variants} discountBps={discountBps} />;
}
