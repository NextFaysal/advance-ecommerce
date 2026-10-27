"use client";

/**
 * Custom-field definitions manager — /admin/webhooks (ADV-26 wiring,
 * doc 23 wave 53). Mounted under the WebhooksPanel: definitions are
 * part of the same developer-platform surface as the partner API
 * keys (values surface through the partner API), and this page is
 * where that surface already lives; Settings is for integration
 * credentials, not merchant data shapes.
 *
 * Self-fetching: GET /api/v1/admin/custom-fields for the list,
 * whole-list PUT (reason-required, audited) on save — the same
 * contract as the other machine-shaped Setting docs. Only the
 * wired entities (product / customer / order) can be defined here;
 * the API refuses the engine's "variant" entity until it is wired.
 * Field VALUES are edited on each entity's own admin screen.
 */
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CustomFieldDefinition, CustomFieldType } from "@/extensibility/types";
import { useLocale } from "@/i18n/LocaleProvider";
import { pick } from "@/i18n/locale";
import { WEBHOOKS_STRINGS } from "./strings";

const ENTITIES = ["product", "customer", "order"] as const;
const TYPES: CustomFieldType[] = [
  "text",
  "textarea",
  "number_poisha",
  "integer",
  "boolean",
  "date",
  "select",
  "multiselect",
];

const SELECT_CLASS = "rounded-md border border-border bg-card px-2 py-1.5 text-small";
const LBL = "mb-1 block text-caption text-text-subtle";

interface DraftDef extends Omit<CustomFieldDefinition, "options" | "min" | "max" | "maxLength"> {
  optionsText: string;
  minText: string;
  maxText: string;
  maxLengthText: string;
}

function toDraft(def: CustomFieldDefinition): DraftDef {
  const { options, min, max, maxLength, ...rest } = def;
  return {
    ...rest,
    optionsText: (options ?? []).join(", "),
    minText: min === undefined ? "" : String(min),
    maxText: max === undefined ? "" : String(max),
    maxLengthText: maxLength === undefined ? "" : String(maxLength),
  };
}

function fromDraft(draft: DraftDef): CustomFieldDefinition {
  const def: CustomFieldDefinition = {
    id: draft.id,
    entity: draft.entity,
    key: draft.key.trim(),
    labelBn: draft.labelBn,
    labelEn: draft.labelEn,
    type: draft.type,
    required: draft.required,
    adminOnly: draft.adminOnly,
    sortOrder: draft.sortOrder,
  };
  if (draft.type === "select" || draft.type === "multiselect") {
    def.options = draft.optionsText.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  }
  if (draft.minText.trim() !== "") def.min = Number(draft.minText);
  if (draft.maxText.trim() !== "") def.max = Number(draft.maxText);
  if (draft.maxLengthText.trim() !== "") def.maxLength = Number(draft.maxLengthText);
  return def;
}

let newIdCounter = 0;

export function CustomFieldsManager() {
  const { locale } = useLocale();
  const s = pick(locale, WEBHOOKS_STRINGS);
  const ENTITY_LABEL: Record<string, string> = {
    product: s.cfEntityProduct,
    customer: s.cfEntityCustomer,
    order: s.cfEntityOrder,
  };
  const [drafts, setDrafts] = useState<DraftDef[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/admin/custom-fields");
      if (!res.ok) {
        setLoadError(s.cfLoadFailed);
        return;
      }
      const json = (await res.json()) as { data?: { definitions: CustomFieldDefinition[] } };
      setDrafts((json.data?.definitions ?? []).map(toDraft));
    } catch {
      setLoadError(s.cfNetworkLoadFailed);
    } finally {
      setLoaded(true);
    }
  }, [s]);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = (index: number, part: Partial<DraftDef>) =>
    setDrafts((list) => list.map((d, i) => (i === index ? { ...d, ...part } : d)));
  const remove = (index: number) => setDrafts((list) => list.filter((_, i) => i !== index));
  const add = () => {
    newIdCounter += 1;
    setDrafts((list) => [
      ...list,
      {
        id: `cf_${Date.now().toString(36)}${newIdCounter}`,
        entity: "product",
        key: "",
        labelBn: "",
        labelEn: "",
        type: "text",
        required: false,
        adminOnly: false,
        sortOrder: list.length * 10,
        optionsText: "",
        minText: "",
        maxText: "",
        maxLengthText: "",
      },
    ]);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    setProblems([]);
    try {
      const res = await fetch("/api/v1/admin/custom-fields", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ definitions: drafts.map(fromDraft), reason: reason.trim() }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        data?: { definitions: CustomFieldDefinition[] };
        error?: { message?: string; details?: string[] };
      };
      if (!res.ok) {
        setProblems(json.error?.details ?? []);
        setError(json.error?.message ?? s.cfSaveFailed);
        return;
      }
      if (json.data) setDrafts(json.data.definitions.map(toDraft));
      setReason("");
      setNotice(s.cfSaved);
    } catch {
      setError(s.cfNetworkError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-lg border border-border bg-surface-2/50 px-4 py-4">
      <h2 className="text-body font-semibold text-text-main">{s.cfTitle}</h2>
      <p className="mt-1 text-small text-text-muted">
        {s.cfDescBefore}
        <span className="font-mono text-xs">customFields</span>{s.cfDescAfter}
      </p>

      {loadError ? (
        <p className="mt-3 rounded-lg border border-border bg-card px-3 py-2 text-small text-danger">{loadError}</p>
      ) : null}

      {loaded && !loadError && drafts.length === 0 ? (
        <p className="mt-3 text-small text-text-muted">{s.cfEmpty}</p>
      ) : null}

      <div className="mt-3 space-y-3">
        {drafts.map((draft, index) => (
          <div key={draft.id} className="rounded-md border border-border bg-card px-3 py-3">
            <div className="flex flex-wrap gap-3">
              <label className="block">
                <span className={LBL}>{s.cfFieldEntity}</span>
                <select
                  value={draft.entity}
                  onChange={(e) => patch(index, { entity: e.target.value as DraftDef["entity"] })}
                  className={SELECT_CLASS}
                >
                  {ENTITIES.map((entity) => (
                    <option key={entity} value={entity}>{ENTITY_LABEL[entity]}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className={LBL}>{s.cfFieldKey}</span>
                <Input
                  value={draft.key}
                  onChange={(e) => patch(index, { key: e.target.value })}
                  className="w-44 font-mono"
                  placeholder={s.cfKeyPlaceholder}
                />
              </label>
              <label className="block">
                <span className={LBL}>{s.cfFieldType}</span>
                <select
                  value={draft.type}
                  onChange={(e) => patch(index, { type: e.target.value as CustomFieldType })}
                  className={SELECT_CLASS}
                >
                  {TYPES.map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </label>
              <label className="block grow">
                <span className={LBL}>{s.cfFieldLabelBn}</span>
                <Input value={draft.labelBn} onChange={(e) => patch(index, { labelBn: e.target.value })} className="w-full min-w-40" />
              </label>
              <label className="block grow">
                <span className={LBL}>{s.cfFieldLabelEn}</span>
                <Input value={draft.labelEn} onChange={(e) => patch(index, { labelEn: e.target.value })} className="w-full min-w-40" />
              </label>
            </div>
            <div className="mt-2 flex flex-wrap items-end gap-3">
              {draft.type === "select" || draft.type === "multiselect" ? (
                <label className="block grow">
                  <span className={LBL}>{s.cfFieldOptions}</span>
                  <Input
                    value={draft.optionsText}
                    onChange={(e) => patch(index, { optionsText: e.target.value })}
                    className="w-full min-w-56"
                    placeholder="red, green, blue"
                  />
                </label>
              ) : null}
              {draft.type === "integer" || draft.type === "number_poisha" ? (
                <>
                  <label className="block">
                    <span className={LBL}>{s.cfFieldMin}</span>
                    <Input type="number" value={draft.minText} onChange={(e) => patch(index, { minText: e.target.value })} className="w-24" />
                  </label>
                  <label className="block">
                    <span className={LBL}>{s.cfFieldMax}</span>
                    <Input type="number" value={draft.maxText} onChange={(e) => patch(index, { maxText: e.target.value })} className="w-24" />
                  </label>
                </>
              ) : null}
              {draft.type === "text" || draft.type === "textarea" ? (
                <label className="block">
                  <span className={LBL}>{s.cfFieldMaxLength}</span>
                  <Input type="number" value={draft.maxLengthText} onChange={(e) => patch(index, { maxLengthText: e.target.value })} className="w-24" />
                </label>
              ) : null}
              <label className="block">
                <span className={LBL}>{s.cfFieldSort}</span>
                <Input
                  type="number"
                  value={String(draft.sortOrder)}
                  onChange={(e) => patch(index, { sortOrder: Number(e.target.value) || 0 })}
                  className="w-20"
                />
              </label>
              <label className="flex items-center gap-1.5 pb-1.5 text-small">
                <input type="checkbox" checked={draft.required} onChange={(e) => patch(index, { required: e.target.checked })} />
                {s.cfRequired}
              </label>
              <label className="flex items-center gap-1.5 pb-1.5 text-small">
                <input type="checkbox" checked={draft.adminOnly} onChange={(e) => patch(index, { adminOnly: e.target.checked })} />
                {s.cfAdminOnly}
              </label>
              <Button size="sm" variant="outline" onClick={() => remove(index)}>{s.cfDeleteBtn}</Button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3">
        <Button size="sm" variant="outline" onClick={add}>{s.cfAddBtn}</Button>
      </div>

      {problems.length > 0 ? (
        <ul className="mt-3 list-inside list-disc rounded-lg border border-border bg-card px-3 py-2 text-small text-danger">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}
      {error ? <p className="mt-3 text-small text-danger">{error}</p> : null}
      {notice ? <p className="mt-3 text-small text-text-main">{notice}</p> : null}

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="block grow">
          <span className={LBL}>{s.cfReasonLabel}</span>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} className="w-full" placeholder={s.cfReasonPlaceholder} />
        </label>
        <Button onClick={() => void save()} disabled={busy || !loaded || reason.trim() === ""}>
          {busy ? s.cfSaving : s.cfSaveBtn}
        </Button>
      </div>
    </section>
  );
}
