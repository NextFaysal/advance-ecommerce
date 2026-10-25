// OD0 (doc 19 §2.1) — badges rendered from the ONE status language in
// labels.ts. Serialisable props only (a status string + an optional lang
// variant) so these are safe on either side of the RSC boundary. The
// existing ui/status-badge components stay untouched for non-order
// surfaces; order surfaces should use these so the 13 statuses, the 6
// payment states (incl. PARTIALLY_REFUNDED) and the refund states all
// read in one vocabulary.
import { Badge } from "../../components/ui/badge";
import { Icon } from "../../components/ui/icon";
import {
  ORDER_STATUS_VISUAL,
  PAYMENT_STATUS_VISUAL,
  REFUND_STATUS_VISUAL,
  type StatusVisual,
} from "./labels";
import type { OrderStatus, PaymentStatus } from "../types";
import type { RefundStatus } from "../refunds";

export type StatusLang = "bn" | "en";

function VisualBadge({ visual, lang }: { visual: StatusVisual; lang: StatusLang }) {
  return (
    <Badge tone={visual.tone} icon={<Icon name={visual.icon} size={12} />}>
      {lang === "bn" ? visual.labelBn : visual.labelEn}
    </Badge>
  );
}

export function OrderStatusBadge({
  status,
  lang = "bn",
}: {
  status: OrderStatus;
  lang?: StatusLang;
}) {
  return <VisualBadge visual={ORDER_STATUS_VISUAL[status]} lang={lang} />;
}

export function OrderPaymentBadge({
  status,
  lang = "bn",
}: {
  status: PaymentStatus;
  lang?: StatusLang;
}) {
  return <VisualBadge visual={PAYMENT_STATUS_VISUAL[status]} lang={lang} />;
}

export function RefundStatusBadge({
  status,
  lang = "bn",
}: {
  status: RefundStatus;
  lang?: StatusLang;
}) {
  return <VisualBadge visual={REFUND_STATUS_VISUAL[status]} lang={lang} />;
}
