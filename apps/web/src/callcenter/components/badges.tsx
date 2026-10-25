/**
 * Call-center badges + chips — CD0 (doc 20 §2).
 *
 * Rendered from the ONE visual language in ./visuals, exactly the way
 * OD0's OrderStatusBadge renders from the order maps: ui Badge +
 * verified Icon, serialisable props only (enum strings + an optional
 * lang), so these are safe on either side of the RSC boundary.
 */
import { Badge } from "../../components/ui/badge";
import { Icon } from "../../components/ui/icon";
import type { StatusVisual } from "../../orders/components/labels";
import type { CallDisposition } from "../dispositions";
import type { CallOutcome, CallQueueSource, CallTaskStatus } from "../types";
import type { SlaState } from "./sla";
import {
  DISPOSITION_VISUAL,
  OUTCOME_VISUAL,
  SLA_VISUAL,
  SOURCE_VISUAL,
  TASK_STATUS_VISUAL,
} from "./visuals";

export type VisualLang = "bn" | "en";

function VisualBadge({ visual, lang }: { visual: StatusVisual; lang: VisualLang }) {
  return (
    <Badge tone={visual.tone} icon={<Icon name={visual.icon} size={12} />}>
      {lang === "bn" ? visual.labelBn : visual.labelEn}
    </Badge>
  );
}

export function OutcomeBadge({
  outcome,
  lang = "bn",
}: {
  outcome: CallOutcome;
  lang?: VisualLang;
}) {
  return <VisualBadge visual={OUTCOME_VISUAL[outcome]} lang={lang} />;
}

export function DispositionChip({
  disposition,
  lang = "bn",
}: {
  disposition: CallDisposition;
  lang?: VisualLang;
}) {
  return <VisualBadge visual={DISPOSITION_VISUAL[disposition]} lang={lang} />;
}

export function SourceChip({
  source,
  lang = "bn",
}: {
  source: CallQueueSource;
  lang?: VisualLang;
}) {
  return <VisualBadge visual={SOURCE_VISUAL[source]} lang={lang} />;
}

export function TaskStatusBadge({
  status,
  lang = "bn",
}: {
  status: CallTaskStatus;
  lang?: VisualLang;
}) {
  return <VisualBadge visual={TASK_STATUS_VISUAL[status]} lang={lang} />;
}

/**
 * SLA state chip. `label` overrides the default text (e.g. a caller
 * that knows the concrete deadline — "কলব্যাক ১৫ মিনিট পেরিয়ে" —
 * passes it); the tone + icon always come from SLA_VISUAL so the
 * state reads identically everywhere.
 */
export function SlaChip({
  state,
  lang = "bn",
  label,
}: {
  state: SlaState;
  lang?: VisualLang;
  label?: string;
}) {
  const visual = SLA_VISUAL[state];
  return (
    <Badge tone={visual.tone} icon={<Icon name={visual.icon} size={12} />}>
      {label ?? (lang === "bn" ? visual.labelBn : visual.labelEn)}
    </Badge>
  );
}
