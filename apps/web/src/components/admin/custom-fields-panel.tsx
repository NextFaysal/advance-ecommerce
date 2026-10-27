"use client";

/**
 * Custom-fields values panel — admin entity screens (ADV-26 wiring,
 * doc 23 wave 53). Mounted on the product edit page, the customer
 * profile card and the order detail rail.
 *
 * Self-fetching: GET /api/v1/admin/custom-fields/values returns the
 * entity's definitions + stored values in one payload. Renders
 * NOTHING until loaded, and nothing at all when the merchant has
 * defined no fields for this entity — screens stay byte-identical
 * in the default state.
 *
 * Saving goes through the same route's PUT, which validates via the
 * extensibility engine; the engine's per-field errors come back as
 * error.details [{ key, message }] and are shown under their fields.
 */
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { CustomFieldDefinition, CustomFieldValue } from "@/extensibility/types";
import { useLocale } from "@/i18n/LocaleProvider";
import { pick } from "@/i18n/locale";
import { ADMIN_STRINGS } from "@/admin/strings";

type Entity = "product" | "customer" | "order";

interface ValuesPayload {
  entity: Entity;
  entityId: string;
  definitions: CustomFieldDefinition[];
  values: Record<string, CustomFieldValue>;
}

const SELECT_CLASS = "rounded-md border border-border bg-card px-2 py-1.5 text-small";

export function CustomFieldsPanel({ entity, entityId }: { entity: Entity; entityId: string }) {
  const { locale } = useLocale();
  const s = pick(locale, ADMIN_STRINGS);
  const [payload, setPayload] = useState<ValuesPayload | null>(null);
  const [loaded, setLoaded] = useState(false);
  // Form-space draft: scalars as strings, multiselect as string[],
  // boolean as "true" | "false" | "" (unset) — converted on save.
  const [draft, setDraft] = useState<Record<string, string | string[]>>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const seedDraft = useCallback((values: Record<string, CustomFieldValue>) => {
    const next: Record<string, string | string[]> = {};
    for (const [key, value] of Object.entries(values)) {
      if (Array.isArray(value)) next[key] = [...value];
      else if (typeof value === "boolean") next[key] = value ? "true" : "false";
      else if (value !== null && value !== undefined) next[key] = String(value);
    }
    setDraft(next);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/v1/admin/custom-fields/values?entity=${entity}&entityId=${encodeURIComponent(entityId)}`,
      );
      if (!res.ok) {
        setPayload(null);
        return;
      }
      const json = (await res.json()) as { data?: ValuesPayload };
      setPayload(json.data ?? null);
      if (json.data) seedDraft(json.data.values);
    } catch {
      setPayload(null);
    } finally {
      setLoaded(true);
    }
  }, [entity, entityId, seedDraft]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!loaded || !payload || payload.definitions.length === 0) return null;

  const buildValues = (): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const def of payload.definitions) {
      const raw = draft[def.key];
      if (raw === undefined) continue;
      if (Array.isArray(raw)) {
        if (raw.length > 0) out[def.key] = raw;
        continue;
      }
      if (raw === "") continue;
      if (def.type === "integer" || def.type === "number_poisha") {
        // Send a real number: a float for a poisha field is rejected
        // by the engine (never rounded), exactly as designed.
        out[def.key] = Number(raw);
      } else if (def.type === "boolean") {
        out[def.key] = raw === "true";
      } else {
        out[def.key] = raw;
      }
    }
    return out;
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    setFieldErrors({});
    try {
      const res = await fetch("/api/v1/admin/custom-fields/values", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entity, entityId, values: buildValues(), reason: reason.trim() }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        data?: { values: Record<string, CustomFieldValue> };
        error?: { message?: string; details?: Array<{ key: string; message: string }> | string[] };
      };
      if (!res.ok) {
        const details = json.error?.details;
        if (Array.isArray(details) && details.length > 0 && typeof details[0] === "object") {
          const byKey: Record<string, string> = {};
          for (const d of details as Array<{ key: string; message: string }>) byKey[d.key] = d.message;
          setFieldErrors(byKey);
        }
        setError(json.error?.message ?? s.cfSaveFailed);
        return;
      }
      const savedValues = json.data?.values;
      if (savedValues) {
        setPayload((p) => (p ? { ...p, values: savedValues } : p));
        seedDraft(savedValues);
      }
      setReason("");
      setNotice(s.cfSaved);
    } catch {
      setError(s.cfNetworkError);
    } finally {
      setBusy(false);
    }
  };

  const setScalar = (key: string, value: string) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const toggleMulti = (key: string, option: string, checked: boolean) =>
    setDraft((d) => {
      const current = Array.isArray(d[key]) ? (d[key] as string[]) : [];
      return { ...d, [key]: checked ? [...current, option] : current.filter((v) => v !== option) };
    });

  return (
    <Card className="p-4 shadow-card">
      <h3 className="text-sm font-bold text-text-main">{s.cfTitle}</h3>
      <p className="mt-1 text-caption text-text-muted">
        {s.cfDesc}
      </p>

      <div className="mt-3 space-y-3">
        {payload.definitions.map((def) => {
          const value = draft[def.key];
          const scalar = typeof value === "string" ? value : "";
          const multi = Array.isArray(value) ? value : [];
          return (
            <div key={def.key}>
              <label className="block">
                <span className="mb-1 block text-caption text-text-subtle">
                  {locale === "bn" ? def.labelBn : def.labelEn}
                  {def.required ? <span className="text-danger"> *</span> : null}
                  {def.type === "number_poisha" ? (
                    <span className="text-text-muted">{s.cfPoishaSuffix}</span>
                  ) : null}
                </span>
                {def.type === "textarea" ? (
                  <Textarea
                    value={scalar}
                    onChange={(e) => setScalar(def.key, e.target.value)}
                    rows={3}
                    className="w-full"
                  />
                ) : def.type === "select" ? (
                  <select
                    value={scalar}
                    onChange={(e) => setScalar(def.key, e.target.value)}
                    className={SELECT_CLASS}
                  >
                    <option value="">—</option>
                    {(def.options ?? []).map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                ) : def.type === "boolean" ? (
                  <select
                    value={scalar}
                    onChange={(e) => setScalar(def.key, e.target.value)}
                    className={SELECT_CLASS}
                  >
                    <option value="">—</option>
                    <option value="true">{s.cfYes}</option>
                    <option value="false">{s.cfNo}</option>
                  </select>
                ) : def.type === "multiselect" ? (
                  <span className="flex flex-wrap gap-2">
                    {(def.options ?? []).map((option) => (
                      <label
                        key={option}
                        className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-small"
                      >
                        <input
                          type="checkbox"
                          checked={multi.includes(option)}
                          onChange={(e) => toggleMulti(def.key, option, e.target.checked)}
                        />
                        {option}
                      </label>
                    ))}
                  </span>
                ) : (
                  <Input
                    type={def.type === "date" ? "date" : def.type === "integer" || def.type === "number_poisha" ? "number" : "text"}
                    value={scalar}
                    onChange={(e) => setScalar(def.key, e.target.value)}
                    className="w-full"
                  />
                )}
              </label>
              {fieldErrors[def.key] ? (
                <p className="mt-1 text-caption text-danger">{fieldErrors[def.key]}</p>
              ) : null}
            </div>
          );
        })}
      </div>

      {error ? (
        <p className="mt-3 rounded-lg border border-border bg-surface-2/50 px-3 py-2 text-small text-danger">{error}</p>
      ) : null}
      {notice ? (
        <p className="mt-3 rounded-lg border border-border bg-surface-2/50 px-3 py-2 text-small text-text-main">{notice}</p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="block grow">
          <span className="mb-1 block text-caption text-text-subtle">{s.cfReason}</span>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} className="w-full" placeholder={s.cfReasonPlaceholder} />
        </label>
        <Button onClick={() => void save()} disabled={busy || reason.trim() === ""}>
          {busy ? s.cfSaving : s.cfSave}
        </Button>
      </div>
    </Card>
  );
}
