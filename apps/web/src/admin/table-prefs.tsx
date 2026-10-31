"use client";

// Table v2 — saved filter views + column visibility (shared by the
// admin orders / products / customers lists so all three behave
// identically).
//
// Persistence: there is NO per-user preferences store on the server
// (the encrypted Settings store is global, not keyed by user), so
// views and hidden columns live in localStorage, keyed by the staff
// user's id (fetched once from GET /api/v1/admin/auth/session):
//   ae-admin:views:v1:<userId>:<table>  -> SavedView[] as JSON
//   ae-admin:cols:v1:<userId>:<table>   -> hidden column keys as JSON
// Keying by user id means two staff sharing one browser never see
// each other's views. Prefs are only read/written AFTER the identity
// resolves — before that the tables render with defaults, so nothing
// can leak across accounts. The trade-off (stated in the UI): prefs
// live in THIS browser only and do not follow the user to another
// device.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { ADMIN_STRINGS } from "@/admin/strings";

/* ------------------------------------------------------------------ */
/* Identity                                                           */
/* ------------------------------------------------------------------ */

let identityPromise: Promise<string | null> | null = null;

function fetchStaffUserId(): Promise<string | null> {
  if (!identityPromise) {
    identityPromise = fetch("/api/v1/admin/auth/session")
      .then(async (res) => {
        if (!res.ok) return null;
        const body = (await res.json().catch(() => null)) as
          | { data?: { user?: { id?: string } } }
          | null;
        return body?.data?.user?.id ?? null;
      })
      .catch(() => null);
  }
  return identityPromise;
}

/** The signed-in staff user's id, or null while loading / on failure. */
export function useStaffUserId(): string | null {
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void fetchStaffUserId().then((id) => {
      if (alive) setUserId(id);
    });
    return () => {
      alive = false;
    };
  }, []);
  return userId;
}

/* ------------------------------------------------------------------ */
/* Saved views                                                        */
/* ------------------------------------------------------------------ */

export interface SavedView<S> {
  name: string;
  state: S;
}

function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full / private mode — prefs simply don't persist.
  }
}

export function useSavedViews<S>(table: string): {
  ready: boolean;
  views: SavedView<S>[];
  saveView: (name: string, state: S) => void;
  deleteView: (name: string) => void;
} {
  const userId = useStaffUserId();
  const storageKey = userId ? `ae-admin:views:v1:${userId}:${table}` : null;
  const [views, setViews] = useState<SavedView<S>[]>([]);

  useEffect(() => {
    if (!storageKey) {
      setViews([]);
      return;
    }
    const parsed = readJson<unknown>(storageKey);
    setViews(
      Array.isArray(parsed)
        ? (parsed.filter(
            (v) =>
              v !== null &&
              typeof v === "object" &&
              typeof (v as { name?: unknown }).name === "string" &&
              "state" in (v as object),
          ) as SavedView<S>[])
        : [],
    );
  }, [storageKey]);

  const saveView = useCallback(
    (name: string, state: S) => {
      setViews((prev) => {
        const next = [...prev.filter((v) => v.name !== name), { name, state }];
        if (storageKey) writeJson(storageKey, next);
        return next;
      });
    },
    [storageKey],
  );

  const deleteView = useCallback(
    (name: string) => {
      setViews((prev) => {
        const next = prev.filter((v) => v.name !== name);
        if (storageKey) writeJson(storageKey, next);
        return next;
      });
    },
    [storageKey],
  );

  return { ready: storageKey !== null, views, saveView, deleteView };
}

/* ------------------------------------------------------------------ */
/* Column visibility                                                  */
/* ------------------------------------------------------------------ */

export function useHiddenColumns(
  table: string,
  columnKeys: readonly string[],
): {
  ready: boolean;
  hidden: string[];
  isVisible: (key: string) => boolean;
  toggleColumn: (key: string) => void;
} {
  const userId = useStaffUserId();
  const storageKey = userId ? `ae-admin:cols:v1:${userId}:${table}` : null;
  const [storedHidden, setStoredHidden] = useState<string[]>([]);
  const keysSignature = columnKeys.join(",");

  useEffect(() => {
    if (!storageKey) {
      setStoredHidden([]);
      return;
    }
    const parsed = readJson<unknown>(storageKey);
    setStoredHidden(
      Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : [],
    );
  }, [storageKey]);

  const hidden = useMemo(() => {
    const allowed = new Set(keysSignature.split(","));
    return storedHidden.filter((k) => allowed.has(k));
  }, [storedHidden, keysSignature]);

  const isVisible = useCallback((key: string) => !hidden.includes(key), [hidden]);

  const toggleColumn = useCallback(
    (key: string) => {
      setStoredHidden((prev) => {
        const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
        if (storageKey) writeJson(storageKey, next);
        return next;
      });
    },
    [storageKey],
  );

  return { ready: storageKey !== null, hidden, isVisible, toggleColumn };
}

/* ------------------------------------------------------------------ */
/* UI: saved-views bar                                                */
/* ------------------------------------------------------------------ */

const barBtnCls =
  "min-h-[36px] rounded-md border border-border bg-card px-3 text-small font-semibold text-text-main transition motion-fast hover:border-brand-300 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-50";
const barInputCls =
  "h-9 rounded-md border border-border bg-card px-2.5 text-small shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:opacity-50";

export function SavedViewsBar<S>({
  views,
  ready,
  currentState,
  onApply,
  onSave,
  onDelete,
}: {
  views: SavedView<S>[];
  ready: boolean;
  currentState: S;
  onApply: (view: SavedView<S>) => void;
  onSave: (name: string, state: S) => void;
  onDelete: (name: string) => void;
}) {
  const { locale } = useLocale();
  const s = pick(locale, ADMIN_STRINGS);
  const [selected, setSelected] = useState("");
  const [newName, setNewName] = useState("");
  const [notice, setNotice] = useState("");

  function handleSave() {
    const name = newName.trim();
    if (!name) {
      setNotice(s.tpNameRequired);
      return;
    }
    onSave(name, currentState);
    setSelected(name);
    setNewName("");
    setNotice(interpolate(s.tpViewSaved, { name }));
  }

  function handleApply() {
    const view = views.find((v) => v.name === selected);
    if (!view) {
      setNotice(s.tpSelectFirst);
      return;
    }
    onApply(view);
    setNotice(interpolate(s.tpViewApplied, { name: view.name }));
  }

  function handleDelete() {
    if (!selected) {
      setNotice(s.tpDeleteSelectFirst);
      return;
    }
    onDelete(selected);
    setNotice(interpolate(s.tpViewDeleted, { name: selected }));
    setSelected("");
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-caption font-semibold text-text-muted">{s.tpSavedViews}</span>
      <select
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        disabled={!ready}
        aria-label={s.tpSelectViewLabel}
        className={barInputCls}
      >
        <option value="">{s.tpChooseView}</option>
        {views.map((v) => (
          <option key={v.name} value={v.name}>
            {v.name}
          </option>
        ))}
      </select>
      <button type="button" className={barBtnCls} disabled={!ready || !selected} onClick={handleApply}>
        {s.tpApply}
      </button>
      <button type="button" className={barBtnCls} disabled={!ready || !selected} onClick={handleDelete}>
        {s.tpDeleteView}
      </button>
      <span aria-hidden="true" className="hidden h-5 w-px bg-border sm:block" />
      <input
        value={newName}
        onChange={(e) => setNewName(e.target.value)}
        disabled={!ready}
        placeholder={s.tpNewViewPlaceholder}
        aria-label={s.tpNewViewLabel}
        className={`${barInputCls} w-44`}
      />
      <button type="button" className={barBtnCls} disabled={!ready} onClick={handleSave}>
        {s.tpSaveCurrent}
      </button>
      {notice ? (
        <span role="status" className="text-caption text-text-muted">
          {notice}
        </span>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* UI: column picker                                                  */
/* ------------------------------------------------------------------ */

export function ColumnPicker({
  columns,
  hidden,
  onToggle,
  ready,
}: {
  columns: readonly { key: string; label: string }[];
  hidden: readonly string[];
  onToggle: (key: string) => void;
  ready: boolean;
}) {
  const { locale } = useLocale();
  const s = pick(locale, ADMIN_STRINGS);
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        disabled={!ready}
        className={`${barBtnCls} flex items-center gap-1.5`}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
        {s.tpColumns}
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={`h-3.5 w-3.5 transition motion-fast ${open ? "rotate-180" : ""}`}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <>
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 z-20 mt-2 w-60 rounded-lg border border-border bg-card p-2 shadow-lift" role="group" aria-label={s.tpColumnsLabel}>
            <p className="px-2 pb-1.5 pt-1 text-caption font-semibold text-text-muted">
              {s.tpColumnsHint}
            </p>
            {columns.map((c) => (
              <label
                key={c.key}
                className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-small transition motion-fast hover:bg-surface-2"
              >
                <input
                  type="checkbox"
                  checked={!hidden.includes(c.key)}
                  onChange={() => onToggle(c.key)}
                  className="h-4 w-4 rounded accent-brand-600"
                />
                {c.label}
              </label>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * Legacy bn-pinned export — list pages now render
 * `pick(locale, ADMIN_STRINGS).tpStorageNote` directly (doc 30).
 * Kept only so any not-yet-migrated consumer keeps compiling.
 */
export const TABLE_PREFS_NOTE = ADMIN_STRINGS.bn.tpStorageNote;
