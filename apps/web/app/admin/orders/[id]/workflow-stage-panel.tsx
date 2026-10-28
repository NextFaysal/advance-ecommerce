"use client";

/**
 * Workflow stage panel — order detail page (ADV-26, BUILD-LITE).
 *
 * Talks to /api/v1/admin/orders/[id]/stage (GET picker data, POST
 * set/clear). A stage is a merchant LABEL anchored at the order's
 * canonical status (src/orders/stages.ts) — this panel never touches
 * the status itself, and says so: the canonical badge above remains
 * the status of record for stock, money and courier.
 *
 * Mount contract matches the other detail panels: serialisable props
 * only (the order id), data fetched client-side. While
 * module.workflow_stages is OFF the panel renders NOTHING (the layer
 * is inert); a 403 (no orders.view/orders.edit) degrades to a quiet
 * note instead of breaking the order page.
 */
import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ORDER_STATUS_VISUAL } from "../../../../src/orders/components/labels";
import { WorkflowStageChip } from "../../../../src/orders/components/WorkflowStageChip";
import type { OrderStatus } from "../../../../src/orders/types";
import type { WorkflowStageTone } from "../../../../src/orders/stages";
import { pick } from "../../../../src/i18n/locale";
import { useLocale } from "../../../../src/i18n/LocaleProvider";
import { ORDER_STRINGS } from "../strings";

interface StageDef {
  id: string;
  labelBn: string;
  labelEn: string;
  anchorStatus: OrderStatus;
  color?: WorkflowStageTone;
  sortOrder: number;
}

interface StageView {
  stageId: string;
  labelBn: string;
  labelEn: string;
  tone: WorkflowStageTone;
  anchorStatus: string | null;
}

interface PickerData {
  moduleEnabled: boolean;
  orderStatus: OrderStatus;
  assignedStageId: string | null;
  current: StageView | null;
  stages: StageDef[];
}

export function WorkflowStagePanel({
  orderId,
  onChanged,
}: {
  orderId: string;
  /** Reload the workspace after a change (header chip truth). */
  onChanged?: () => void;
}) {
  const { locale } = useLocale();
  const s = pick(locale, ORDER_STRINGS);
  const [data, setData] = useState<PickerData | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selected, setSelected] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/admin/orders/${encodeURIComponent(orderId)}/stage`);
      const body = (await res.json().catch(() => null)) as { data?: PickerData } | null;
      if (res.ok && body?.data) {
        setData(body.data);
        setSelected(body.data.assignedStageId ?? "");
      } else {
        setLoadFailed(true);
      }
    } catch {
      setLoadFailed(true);
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loadFailed) return null; // quiet degradation, panel precedent
  if (!data) return null;
  if (!data.moduleEnabled) return null; // add-on OFF — layer is inert

  const apply = async (stageId: string | null) => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/admin/orders/${encodeURIComponent(orderId)}/stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stageId }),
      });
      const body = (await res.json().catch(() => null)) as
        | { data?: { current: StageView | null }; error?: { code: string; message: string } }
        | null;
      if (res.ok && body && "data" in body) {
        setData((prev) =>
          prev ? { ...prev, current: body.data?.current ?? null, assignedStageId: stageId } : prev,
        );
        setSelected(stageId ?? "");
        onChanged?.();
      } else {
        setError(
          body && "error" in body && body.error
            ? `${body.error.code}: ${body.error.message}`
            : `HTTP ${res.status}`,
        );
      }
    } catch {
      setError(s.stageNetwork);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <h3 className="font-display text-base font-semibold text-text-main">{s.stageTitle}</h3>
      <p className="mt-1 text-small leading-relaxed text-text-muted">
        {s.stageIntro}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-small text-text-muted">{s.stageCurrent}</span>
        {data.current ? (
          <WorkflowStageChip label={locale === "bn" ? data.current.labelBn : data.current.labelEn} tone={data.current.tone} />
        ) : data.assignedStageId ? (
          <span className="text-small font-medium text-text-main">{data.assignedStageId}</span>
        ) : (
          <span className="text-small font-medium text-text-main">{s.stageNone}</span>
        )}
      </div>

      {data.stages.length === 0 ? (
        <p className="mt-3 text-small text-text-muted">
          {s.stageEmpty}
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            aria-label={s.stagePick}
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="min-h-[40px] rounded-[9px] border border-border bg-card px-2.5 text-small font-medium text-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
          >
            <option value="">{s.stageNoStage}</option>
            {data.stages.map((stage) => {
              const anchoredHere = stage.anchorStatus === data.orderStatus;
              return (
                <option key={stage.id} value={stage.id} disabled={!anchoredHere}>
                  {locale === "bn" ? stage.labelBn : stage.labelEn} ({locale === "bn" ? ORDER_STATUS_VISUAL[stage.anchorStatus].labelBn : ORDER_STATUS_VISUAL[stage.anchorStatus].labelEn}
                  {anchoredHere ? "" : ` ${s.stageAtStatus}`})
                </option>
              );
            })}
          </select>
          <Button
            type="button"
            disabled={busy || selected === (data.assignedStageId ?? "")}
            onClick={() => void apply(selected === "" ? null : selected)}
          >
            {busy ? s.savingStage : s.stageSet}
          </Button>
          {data.assignedStageId ? (
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void apply(null)}>
              {s.stageRemove}
            </Button>
          ) : null}
        </div>
      )}

      {error ? (
        <p role="alert" className="mt-3 rounded-xl border border-danger/25 bg-danger-soft px-3 py-2 text-small text-danger">
          {error}
        </p>
      ) : null}
    </Card>
  );
}
