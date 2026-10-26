/**
 * PDP mount point for subscription boxes (ADV-23 vertical 4) — a
 * server component, rendered by the PDP INSTEAD of the generic
 * Subscribe & Save section when the page's getBoxPdpData() read
 * says this product has a listed box variant (both flags ON). All
 * gating + data loading happened in that read (src/boxes/service
 * .ts); this wrapper only narrows the variant list to the box
 * variants and hands serializable props to the client card — no
 * function props cross the boundary.
 */
import type { SubscribeVariantOption } from "@/subscriptions/subscribe-save-card";
import type { BoxPdpData } from "./service";
import { BoxSubscribeCard } from "./box-subscribe-card";

export function BoxSubscribeSection({
  variants,
  data,
}: {
  variants: SubscribeVariantOption[];
  data: BoxPdpData;
}) {
  const boxVariants = variants.filter((v) => data.previews[v.id] !== undefined);
  if (boxVariants.length === 0) return null;
  return <BoxSubscribeCard variants={boxVariants} data={data} />;
}
