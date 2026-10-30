"use client";

/**
 * Checkout fields editor (doc 28) — self-fetching client panel.
 * Loads the merchant's checkout-field config from
 * GET /api/v1/admin/checkout-fields and saves through
 * PUT /api/v1/admin/checkout-fields with { config, reason }
 * (settings.edit + mandatory reason, audited server-side).
 *
 * The shape, defaults and coercion come from the PURE contract
 * module src/checkout/fields.ts — the same module the storefront
 * checkout renders from, so what is edited here is exactly what
 * the customer sees. Identity fields (name, phone, the address
 * cascade, the detailed address line) are locked visible/required
 * by the contract; their toggles render disabled with a note.
 * Merchant-added extra fields (extra_1..extra_5) are plain text
 * questions rendered at the end of the address step; their answers
 * ride the order and land on the order's note.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { SETTINGS_STRINGS } from "../strings";
import {
  CHECKOUT_FIELD_GROUPS,
  LOCKED_REQUIRED,
  LOCKED_VISIBLE,
  MAX_EXTRA_FIELDS,
  MAX_LABEL_LENGTH,
  MAX_PLACEHOLDER_LENGTH,
  MAX_VALIDATION_LENGTH,
  coerceCheckoutFieldsConfig,
  type CheckoutFieldCondition,
  type CheckoutFieldDef,
  type CheckoutFieldValidation,
  type CheckoutFieldsConfig,
} from "@/checkout/fields";

const INPUT_CLASS =
  "w-full rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm text-text-main outline-none transition placeholder:text-text-subtle focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30";

function groupOf(key: string): "info" | "address" {
  return (CHECKOUT_FIELD_GROUPS.info as string[]).includes(key) ? "info" : "address";
}

/**
 * Doc 29 eligibility — mirrors the contract's private rails in
 * src/checkout/fields.ts (coercion strips these blocks everywhere
 * else): conditions may live on email / union / note + extras;
 * validation on email / union / addressLine / note + extras.
 * Locked identity/cascade fields get neither block.
 */
const CONDITION_KEYS: ReadonlySet<string> = new Set(["email", "union", "note"]);
const VALIDATION_KEYS: ReadonlySet<string> = new Set(["email", "union", "addressLine", "note"]);

function mayCondition(def: CheckoutFieldDef): boolean {
  return def.extra === true || CONDITION_KEYS.has(def.key);
}

function mayValidate(def: CheckoutFieldDef): boolean {
  return def.extra === true || VALIDATION_KEYS.has(def.key);
}

type ConditionSource = "" | "paymentMethod" | "shippingMethod" | "division" | "cartTotal";

function conditionSourceOptions(s: { chfCondAlways: string; chfCondPayment: string; chfCondShipping: string; chfCondDivision: string; chfCondCartTotal: string }): { value: ConditionSource; label: string }[] {
  return [
    { value: "", label: s.chfCondAlways },
    { value: "paymentMethod", label: s.chfCondPayment },
    { value: "shippingMethod", label: s.chfCondShipping },
    { value: "division", label: s.chfCondDivision },
    { value: "cartTotal", label: s.chfCondCartTotal },
  ];
}

const CONDITION_VALUE_HINTS: Record<string, string> = {
  paymentMethod: "cod, bkash",
  shippingMethod: "inside_dhaka, outside_dhaka, pickup",
  division: "Dhaka, Chattogram",
};

/** Comma-separated editor text → clean value list (trim, drop empties, de-dupe). */
function parseConditionValues(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(",")) {
    const v = part.trim();
    if (v && !out.some((x) => x.toLowerCase() === v.toLowerCase())) out.push(v);
  }
  return out;
}

/**
 * One condition editor (doc 29): a source select plus either a
 * comma-separated values input or a taka amount input. Choosing
 * "Always" clears the condition entirely.
 */
function ConditionEditor({
  title,
  cond,
  onChange,
}: {
  title: string;
  cond: CheckoutFieldCondition | undefined;
  onChange: (next: CheckoutFieldCondition | undefined) => void;
}) {
  const { locale } = useLocale();
  const s = pick(locale, SETTINGS_STRINGS);
  const source: ConditionSource = cond?.source ?? "";
  const isValues = source === "paymentMethod" || source === "shippingMethod" || source === "division";
  // The values input keeps a local draft so commas/spaces survive
  // typing; it re-syncs only when the stored values change from
  // OUTSIDE this editor (load, reload after save, source switch).
  const storedText = cond && cond.source !== "cartTotal" ? cond.values.join(", ") : "";
  const [draft, setDraft] = useState(storedText);
  const lastEmitted = useRef(storedText);
  useEffect(() => {
    if (storedText !== lastEmitted.current) {
      lastEmitted.current = storedText;
      setDraft(storedText);
    }
  }, [storedText]);

  function onSource(next: ConditionSource) {
    if (next === "") {
      onChange(undefined);
      return;
    }
    if (next === "cartTotal") {
      onChange({
        source: "cartTotal",
        minPoisha: cond?.source === "cartTotal" ? cond.minPoisha : 100_000,
      });
      return;
    }
    onChange({
      source: next,
      values: cond && cond.source !== "cartTotal" ? cond.values : [],
    });
  }

  function onValuesText(text: string) {
    setDraft(text);
    if (!isValues) return;
    const values = parseConditionValues(text);
    lastEmitted.current = values.join(", ");
    onChange({ source, values });
  }

  return (
    <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-xs">
      <span className="mb-1.5 block text-xs font-medium text-text-muted">{title}</span>
      <select
        value={source}
        onChange={(e) => onSource(e.target.value as ConditionSource)}
        className={INPUT_CLASS}
      >
        {conditionSourceOptions(s).map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {isValues && (
        <>
          <input
            value={draft}
            onChange={(e) => onValuesText(e.target.value)}
            placeholder={source === "division" ? `Dhaka, Chattogram ${s.chfCondDivisionHint}` : CONDITION_VALUE_HINTS[source]}
            className={`${INPUT_CLASS} mt-2`}
          />
          <span className="mt-1 block text-xs text-text-muted">{s.chfCondValuesHint}</span>
        </>
      )}
      {source === "cartTotal" && (
        <>
          <input
            type="number"
            min={0}
            value={cond?.source === "cartTotal" ? cond.minPoisha / 100 : ""}
            onChange={(e) => {
              const taka = Number.parseFloat(e.target.value);
              onChange({
                source: "cartTotal",
                minPoisha: Number.isFinite(taka) ? Math.max(0, Math.round(taka * 100)) : 0,
              });
            }}
            placeholder={s.chfCondCartPlaceholder}
            className={`${INPUT_CLASS} mt-2`}
          />
          <span className="mt-1 block text-xs text-text-muted">{s.chfCondCartHint}</span>
        </>
      )}
    </div>
  );
}

/** The validation editor (doc 29): min/max answer length + a format preset. */
function ValidationEditor({
  validation,
  onChange,
}: {
  validation: CheckoutFieldValidation | undefined;
  onChange: (next: CheckoutFieldValidation | undefined) => void;
}) {
  const { locale } = useLocale();
  const s = pick(locale, SETTINGS_STRINGS);
  function patch(next: CheckoutFieldValidation) {
    onChange(Object.keys(next).length > 0 ? next : undefined);
  }
  function setLength(which: "minLength" | "maxLength", raw: string) {
    const next: CheckoutFieldValidation = { ...validation };
    const n = Number.parseInt(raw, 10);
    if (raw.trim() === "" || !Number.isFinite(n)) {
      delete next[which];
    } else {
      next[which] = Math.min(MAX_VALIDATION_LENGTH, Math.max(1, n));
    }
    patch(next);
  }
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-text-muted">{s.chfMinLength}</span>
        <input
          type="number"
          min={1}
          max={MAX_VALIDATION_LENGTH}
          value={validation?.minLength ?? ""}
          onChange={(e) => setLength("minLength", e.target.value)}
          placeholder={s.chfEmptyNone}
          className={INPUT_CLASS}
        />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-text-muted">{s.chfMaxLength}</span>
        <input
          type="number"
          min={1}
          max={MAX_VALIDATION_LENGTH}
          value={validation?.maxLength ?? ""}
          onChange={(e) => setLength("maxLength", e.target.value)}
          placeholder={s.chfEmptyNone}
          className={INPUT_CLASS}
        />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-text-muted">{s.chfPatternLabel}</span>
        <select
          value={validation?.pattern ?? ""}
          onChange={(e) => {
            const next: CheckoutFieldValidation = { ...validation };
            if (e.target.value === "digits" || e.target.value === "bd_phone" || e.target.value === "email") {
              next.pattern = e.target.value;
            } else {
              delete next.pattern;
            }
            patch(next);
          }}
          className={INPUT_CLASS}
        >
          <option value="">{s.chfPatternAny}</option>
          <option value="digits">{s.chfPatternDigits}</option>
          <option value="bd_phone">{s.chfPatternPhone}</option>
          <option value="email">{s.chfPatternEmail}</option>
        </select>
      </label>
    </div>
  );
}

/**
 * The doc-29 blocks for one field: conditions (show + required
 * conditions) and validation — rendered only for fields the contract allows
 * to carry them; locked fields show neither.
 */
function FieldRulesBlocks({
  def,
  updateField,
}: {
  def: CheckoutFieldDef;
  updateField: (key: string, patch: Partial<CheckoutFieldDef>) => void;
}) {
  const { locale } = useLocale();
  const s = pick(locale, SETTINGS_STRINGS);
  const cond = mayCondition(def);
  const val = mayValidate(def);
  if (!cond && !val) return null;
  return (
    <div className="mt-4 grid gap-4 border-t border-border pt-4">
      {cond && (
        <div>
          <p className="text-xs font-semibold text-text-main">{s.chfConditionsTitle}</p>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <ConditionEditor
              title={s.chfVisibleWhen}
              cond={def.visibleWhen}
              onChange={(next) => updateField(def.key, { visibleWhen: next })}
            />
            <ConditionEditor
              title={s.chfRequiredWhen}
              cond={def.requiredWhen}
              onChange={(next) => updateField(def.key, { requiredWhen: next })}
            />
          </div>
        </div>
      )}
      {val && (
        <div>
          <p className="text-xs font-semibold text-text-main">{s.chfValidationTitle}</p>
          <div className="mt-2">
            <ValidationEditor
              validation={def.validation}
              onChange={(next) => updateField(def.key, { validation: next })}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export function CheckoutFieldsPanel() {
  const { locale } = useLocale();
  const s = pick(locale, SETTINGS_STRINGS);
  const [fields, setFields] = useState<CheckoutFieldDef[] | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/admin/checkout-fields", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as {
        data?: unknown;
        error?: { message?: string };
      } | null;
      if (!res.ok || !json?.data) {
        setError(json?.error?.message ?? s.chfLoadFailed);
        return;
      }
      // Pass whatever the API returned through the shared coercion —
      // the editor then always works on a valid, complete field set.
      setFields(coerceCheckoutFieldsConfig(json.data).fields);
      setError(null);
    } catch {
      setError(s.chfNetworkLoad);
    }
  }, [s]);

  useEffect(() => {
    void load();
  }, [load]);

  function updateField(key: string, patch: Partial<CheckoutFieldDef>) {
    setFields((prev) =>
      prev ? prev.map((f) => (f.key === key ? { ...f, ...patch } : f)) : prev,
    );
  }

  /** Move a built-in field one step within its own step group. */
  function move(key: string, dir: -1 | 1) {
    setFields((prev) => {
      if (!prev) return prev;
      const group = groupOf(key);
      const memberIdx = prev
        .map((f, i) => ({ f, i }))
        .filter(({ f }) => !f.extra && groupOf(f.key) === group)
        .map(({ i }) => i);
      const pos = memberIdx.findIndex((i) => prev[i]!.key === key);
      const swapPos = pos + dir;
      if (pos < 0 || swapPos < 0 || swapPos >= memberIdx.length) return prev;
      const next = [...prev];
      const a = memberIdx[pos]!;
      const b = memberIdx[swapPos]!;
      const tmp = next[a]!;
      next[a] = next[b]!;
      next[b] = tmp;
      return next;
    });
  }

  function addExtra() {
    setFields((prev) => {
      if (!prev) return prev;
      const extras = prev.filter((f) => f.extra);
      if (extras.length >= MAX_EXTRA_FIELDS) return prev;
      const used = new Set(extras.map((f) => f.key));
      let n = 1;
      while (used.has(`extra_${n}`)) n += 1;
      const def: CheckoutFieldDef = {
        key: `extra_${n}`,
        labelBn: "",
        labelEn: "",
        visible: true,
        required: false,
        extra: true,
      };
      return [...prev, def];
    });
  }

  function removeExtra(key: string) {
    setFields((prev) => (prev ? prev.filter((f) => f.key !== key) : prev));
  }

  async function save() {
    if (busy || !fields) return;
    if (!reason.trim()) {
      setError(s.chfReasonRequired);
      return;
    }
    const labelless = fields.find(
      (f) => f.extra && !f.labelBn.trim() && !f.labelEn.trim(),
    );
    if (labelless) {
      setError(s.chfLabelless);
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      // Doc 29: emit clean defs — a condition whose values list is
      // still empty (source picked, nothing typed yet) and an empty
      // validation block are dropped here; undefined keys vanish
      // from the JSON body entirely. The server coerces regardless.
      const cleanedFields = fields.map((f) => ({
        ...f,
        visibleWhen:
          f.visibleWhen && (f.visibleWhen.source === "cartTotal" || f.visibleWhen.values.length > 0)
            ? f.visibleWhen
            : undefined,
        requiredWhen:
          f.requiredWhen && (f.requiredWhen.source === "cartTotal" || f.requiredWhen.values.length > 0)
            ? f.requiredWhen
            : undefined,
        validation:
          f.validation && Object.keys(f.validation).length > 0 ? f.validation : undefined,
      }));
      const config: CheckoutFieldsConfig = { version: 1, fields: cleanedFields };
      const res = await fetch("/api/v1/admin/checkout-fields", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config, reason: reason.trim() }),
      });
      const json = (await res.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      if (!res.ok) {
        setError(json?.error?.message ?? s.chfSaveFailed);
        return;
      }
      setReason("");
      setNotice(s.chfSaved);
      await load();
    } catch {
      setError(s.chfNetworkSave);
    } finally {
      setBusy(false);
    }
  }

  if (!fields && !error) {
    return <p className="text-sm text-text-muted">{s.chfLoading}</p>;
  }

  const builtins = (fields ?? []).filter((f) => !f.extra);
  const infoFields = builtins.filter((f) => groupOf(f.key) === "info");
  const addressFields = builtins.filter((f) => groupOf(f.key) === "address");
  const extras = (fields ?? []).filter((f) => f.extra);

  /**
   * One-click presets over the only freely-hideable built-ins
   * (email / union / note). Simple hides all three — the customer
   * then fills just name, phone, the cascade and the address line,
   * matching the shipped default; Standard shows all three again.
   * Locked fields and merchant extras are never touched, and the
   * preset only edits the draft — the audited save below applies it.
   */
  const PRESET_KEYS: ReadonlySet<string> = new Set(["email", "union", "note"]);
  function applyPreset(preset: "simple" | "standard") {
    setFields((prev) =>
      (prev ?? []).map((f) =>
        PRESET_KEYS.has(f.key) ? { ...f, visible: preset === "standard" } : f,
      ),
    );
  }

  function renderBuiltinRow(def: CheckoutFieldDef, pos: number, groupSize: number) {
    const visibleLocked = LOCKED_VISIBLE.has(def.key);
    const requiredLocked = LOCKED_REQUIRED.has(def.key);
    return (
      <div key={def.key} className="rounded-xl border border-border bg-surface-2/60 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-text-main">
            {def.labelEn || def.key}{" "}
            <code className="ml-1 rounded bg-card px-1.5 py-0.5 text-xs font-normal text-text-muted">
              {def.key}
            </code>
          </p>
          <span className="flex gap-1.5">
            <button
              type="button"
              aria-label={interpolate(s.chfMoveUpAria, { key: def.key })}
              disabled={pos === 0}
              onClick={() => move(def.key, -1)}
              className="rounded-lg border border-border bg-card px-2.5 py-1 text-sm font-medium text-text-main transition hover:bg-surface-2 disabled:opacity-40"
            >
              {s.chfMoveUp}
            </button>
            <button
              type="button"
              aria-label={interpolate(s.chfMoveDownAria, { key: def.key })}
              disabled={pos === groupSize - 1}
              onClick={() => move(def.key, 1)}
              className="rounded-lg border border-border bg-card px-2.5 py-1 text-sm font-medium text-text-main transition hover:bg-surface-2 disabled:opacity-40"
            >
              {s.chfMoveDown}
            </button>
          </span>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-text-muted">{s.chfLabelBn}</span>
            <input
              value={def.labelBn}
              maxLength={MAX_LABEL_LENGTH}
              onChange={(e) => updateField(def.key, { labelBn: e.target.value })}
              className={INPUT_CLASS}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-text-muted">{s.chfLabelEn}</span>
            <input
              value={def.labelEn}
              maxLength={MAX_LABEL_LENGTH}
              onChange={(e) => updateField(def.key, { labelEn: e.target.value })}
              className={INPUT_CLASS}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-text-muted">{s.chfPlaceholderLabel}</span>
            <input
              value={def.placeholder ?? ""}
              maxLength={MAX_PLACEHOLDER_LENGTH}
              onChange={(e) => updateField(def.key, { placeholder: e.target.value })}
              className={INPUT_CLASS}
            />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
          <span>
            <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-text-main">
              <input
                type="checkbox"
                checked={def.visible}
                disabled={visibleLocked}
                onChange={(e) => updateField(def.key, { visible: e.target.checked })}
                className="h-4 w-4 shrink-0 accent-brand-600 disabled:opacity-50"
              />
              {s.chfVisible}
            </label>
            {visibleLocked && (
              <span className="mt-1 block pl-7 text-xs text-text-muted">
                {s.chfVisibleLocked}
              </span>
            )}
          </span>
          <span>
            <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-text-main">
              <input
                type="checkbox"
                checked={def.required}
                disabled={requiredLocked}
                onChange={(e) => updateField(def.key, { required: e.target.checked })}
                className="h-4 w-4 shrink-0 accent-brand-600 disabled:opacity-50"
              />
              {s.chfRequired}
            </label>
            {requiredLocked && (
              <span className="mt-1 block pl-7 text-xs text-text-muted">
                {s.chfRequiredLocked}
              </span>
            )}
          </span>
        </div>
        <FieldRulesBlocks def={def} updateField={updateField} />
      </div>
    );
  }

  return (
    <section
      aria-label={s.chfAria}
      className="rounded-2xl border border-border bg-card p-5 shadow-card"
    >
      <h2 className="text-base font-semibold text-text-main">{s.chfHeading}</h2>
      <p className="mt-1 text-sm leading-6 text-text-muted">
        {s.chfIntro}
      </p>
      {error && (
        <p role="alert" className="mt-3 rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-600">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
          {notice}
        </p>
      )}

      <div className="mt-4 rounded-xl border border-border bg-background px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-text-main">{s.chfPresetLabel}</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => applyPreset("simple")}
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-text-main transition hover:border-brand-500 disabled:opacity-50"
          >
            {s.chfPresetSimple}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => applyPreset("standard")}
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-text-main transition hover:border-brand-500 disabled:opacity-50"
          >
            {s.chfPresetStandard}
          </button>
        </div>
        <p className="mt-2 text-xs leading-5 text-text-muted">{s.chfPresetHelp}</p>
      </div>

      <h3 className="mt-6 text-sm font-semibold text-text-main">{s.chfStep1}</h3>
      <div className="mt-3 grid gap-3">
        {infoFields.map((def, i) => renderBuiltinRow(def, i, infoFields.length))}
      </div>

      <h3 className="mt-6 text-sm font-semibold text-text-main">{s.chfStep2}</h3>
      <div className="mt-3 grid gap-3">
        {addressFields.map((def, i) => renderBuiltinRow(def, i, addressFields.length))}
      </div>

      <h3 className="mt-6 text-sm font-semibold text-text-main">{s.chfExtrasTitle}</h3>
      <p className="mt-1 text-sm leading-6 text-text-muted">
        {s.chfExtrasIntroA}{MAX_EXTRA_FIELDS}{s.chfExtrasIntroB}
      </p>
      <div className="mt-3 grid gap-3">
        {extras.map((def) => (
          <div key={def.key} className="rounded-xl border border-border bg-surface-2/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-text-main">
                {s.chfExtraField}{" "}
                <code className="ml-1 rounded bg-card px-1.5 py-0.5 text-xs font-normal text-text-muted">
                  {def.key}
                </code>
              </p>
              <button
                type="button"
                onClick={() => removeExtra(def.key)}
                className="rounded-lg border border-border bg-card px-2.5 py-1 text-sm font-medium text-rose-600 transition hover:bg-rose-50"
              >
                {s.chfRemoveField}
              </button>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-text-muted">{s.chfLabelBn}</span>
                <input
                  value={def.labelBn}
                  maxLength={MAX_LABEL_LENGTH}
                  onChange={(e) => updateField(def.key, { labelBn: e.target.value })}
                  className={INPUT_CLASS}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-text-muted">{s.chfLabelEn}</span>
                <input
                  value={def.labelEn}
                  maxLength={MAX_LABEL_LENGTH}
                  onChange={(e) => updateField(def.key, { labelEn: e.target.value })}
                  className={INPUT_CLASS}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-text-muted">{s.chfPlaceholderLabel}</span>
                <input
                  value={def.placeholder ?? ""}
                  maxLength={MAX_PLACEHOLDER_LENGTH}
                  onChange={(e) => updateField(def.key, { placeholder: e.target.value })}
                  className={INPUT_CLASS}
                />
              </label>
            </div>
            <label className="mt-3 flex cursor-pointer items-center gap-2.5 text-sm font-medium text-text-main">
              <input
                type="checkbox"
                checked={def.required}
                onChange={(e) => updateField(def.key, { required: e.target.checked })}
                className="h-4 w-4 shrink-0 accent-brand-600"
              />
              {s.chfRequired}
            </label>
            <FieldRulesBlocks def={def} updateField={updateField} />
          </div>
        ))}
      </div>
      <button
        type="button"
        disabled={extras.length >= MAX_EXTRA_FIELDS}
        onClick={addExtra}
        className="mt-3 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-text-main transition hover:bg-surface-2 disabled:opacity-50"
      >
        {s.chfAddField}
      </button>

      <div className="mt-6 grid gap-4 border-t border-border pt-5 sm:grid-cols-[1fr_auto] sm:items-end">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-text-main">{s.chfReasonLabel}</span>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={300}
            placeholder={s.chfReasonPlaceholder}
            className={INPUT_CLASS}
          />
        </label>
        <button
          type="button"
          disabled={busy || !reason.trim() || !fields}
          onClick={() => void save()}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
        >
          {busy ? s.chfSaving : s.chfSave}
        </button>
      </div>
    </section>
  );
}
