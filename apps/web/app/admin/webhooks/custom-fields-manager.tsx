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
const ENTITY_LABEL: Record<string, string> = {
  product: "পণ্য (Product)",
  customer: "ক্রেতা (Customer)",
  order: "অর্ডার (Order)",
};
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
        setLoadError("সংজ্ঞা লোড করা যায়নি (পারমিশন: settings.integrations)।");
        return;
      }
      const json = (await res.json()) as { data?: { definitions: CustomFieldDefinition[] } };
      setDrafts((json.data?.definitions ?? []).map(toDraft));
    } catch {
      setLoadError("নেটওয়ার্ক ত্রুটি — সংজ্ঞা লোড হয়নি।");
    } finally {
      setLoaded(true);
    }
  }, []);

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
        setError(json.error?.message ?? "সংরক্ষণ ব্যর্থ হয়েছে।");
        return;
      }
      if (json.data) setDrafts(json.data.definitions.map(toDraft));
      setReason("");
      setNotice("সংজ্ঞা সংরক্ষিত হয়েছে। মান (values) প্রতিটি পণ্য/ক্রেতা/অর্ডারের নিজের স্ক্রিনে বসাতে হয়।");
    } catch {
      setError("নেটওয়ার্ক ত্রুটি — আবার চেষ্টা করুন।");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-lg border border-border bg-surface-2/50 px-4 py-4">
      <h2 className="text-body font-semibold text-text-main">কাস্টম ফিল্ড (Custom Fields)</h2>
      <p className="mt-1 text-small text-text-muted">
        পণ্য / ক্রেতা / অর্ডারের উপর মার্চেন্ট-সংজ্ঞায়িত অতিরিক্ত ফিল্ড। সংজ্ঞা এখানে বানান —
        মান বসান প্রতিটি এনটিটির নিজের অ্যাডমিন স্ক্রিনে। মান থাকলে partner API-তেও{" "}
        <span className="font-mono text-xs">customFields</span> হিসেবে যায়। কোনো সংজ্ঞা না থাকলে
        কোথাও কিছুই বদলায় না।
      </p>

      {loadError ? (
        <p className="mt-3 rounded-lg border border-border bg-card px-3 py-2 text-small text-danger">{loadError}</p>
      ) : null}

      {loaded && !loadError && drafts.length === 0 ? (
        <p className="mt-3 text-small text-text-muted">এখনো কোনো কাস্টম ফিল্ড সংজ্ঞায়িত নেই।</p>
      ) : null}

      <div className="mt-3 space-y-3">
        {drafts.map((draft, index) => (
          <div key={draft.id} className="rounded-md border border-border bg-card px-3 py-3">
            <div className="flex flex-wrap gap-3">
              <label className="block">
                <span className={LBL}>এনটিটি</span>
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
                <span className={LBL}>কী (snake_case)</span>
                <Input
                  value={draft.key}
                  onChange={(e) => patch(index, { key: e.target.value })}
                  className="w-44 font-mono"
                  placeholder="যেমন: warranty_months"
                />
              </label>
              <label className="block">
                <span className={LBL}>ধরন</span>
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
                <span className={LBL}>লেবেল (বাংলা)</span>
                <Input value={draft.labelBn} onChange={(e) => patch(index, { labelBn: e.target.value })} className="w-full min-w-40" />
              </label>
              <label className="block grow">
                <span className={LBL}>লেবেল (English)</span>
                <Input value={draft.labelEn} onChange={(e) => patch(index, { labelEn: e.target.value })} className="w-full min-w-40" />
              </label>
            </div>
            <div className="mt-2 flex flex-wrap items-end gap-3">
              {draft.type === "select" || draft.type === "multiselect" ? (
                <label className="block grow">
                  <span className={LBL}>অপশন (কমা দিয়ে)</span>
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
                    <span className={LBL}>সর্বনিম্ন</span>
                    <Input type="number" value={draft.minText} onChange={(e) => patch(index, { minText: e.target.value })} className="w-24" />
                  </label>
                  <label className="block">
                    <span className={LBL}>সর্বোচ্চ</span>
                    <Input type="number" value={draft.maxText} onChange={(e) => patch(index, { maxText: e.target.value })} className="w-24" />
                  </label>
                </>
              ) : null}
              {draft.type === "text" || draft.type === "textarea" ? (
                <label className="block">
                  <span className={LBL}>সর্বোচ্চ দৈর্ঘ্য</span>
                  <Input type="number" value={draft.maxLengthText} onChange={(e) => patch(index, { maxLengthText: e.target.value })} className="w-24" />
                </label>
              ) : null}
              <label className="block">
                <span className={LBL}>ক্রম</span>
                <Input
                  type="number"
                  value={String(draft.sortOrder)}
                  onChange={(e) => patch(index, { sortOrder: Number(e.target.value) || 0 })}
                  className="w-20"
                />
              </label>
              <label className="flex items-center gap-1.5 pb-1.5 text-small">
                <input type="checkbox" checked={draft.required} onChange={(e) => patch(index, { required: e.target.checked })} />
                আবশ্যক
              </label>
              <label className="flex items-center gap-1.5 pb-1.5 text-small">
                <input type="checkbox" checked={draft.adminOnly} onChange={(e) => patch(index, { adminOnly: e.target.checked })} />
                শুধু অ্যাডমিনে
              </label>
              <Button size="sm" variant="outline" onClick={() => remove(index)}>মুছুন</Button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3">
        <Button size="sm" variant="outline" onClick={add}>+ নতুন ফিল্ড</Button>
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
          <span className={LBL}>কারণ (অডিটের জন্য আবশ্যক)</span>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} className="w-full" placeholder="কেন বদলাচ্ছেন?" />
        </label>
        <Button onClick={() => void save()} disabled={busy || !loaded || reason.trim() === ""}>
          {busy ? "সংরক্ষণ হচ্ছে…" : "সব সংজ্ঞা সংরক্ষণ"}
        </Button>
      </div>
    </section>
  );
}
