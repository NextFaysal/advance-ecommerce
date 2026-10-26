// ADV-26 (BUILD-LITE) — the workflow-stage chip rendered NEXT TO the
// canonical OrderStatusBadge on order surfaces. A stage is a merchant
// label anchored at a canonical status (src/orders/stages.ts); it is
// never a status itself, so this chip deliberately uses the plain
// Badge with a dot (tone + text, never colour-only — the OD0 rule)
// rather than the status badge's icon language. Serialisable props
// only, safe on either side of the RSC boundary.
import { Badge } from "../../components/ui/badge";
import type { WorkflowStageTone } from "../stages";

export function WorkflowStageChip({
  label,
  tone,
  lang = "bn",
}: {
  /** Pre-resolved display label (labelBn or labelEn). */
  label: string;
  tone: WorkflowStageTone;
  lang?: "bn" | "en";
}) {
  return (
    <Badge tone={tone} dot>
      {lang === "bn" ? "ধাপ: " : "Stage: "}
      {label}
    </Badge>
  );
}
