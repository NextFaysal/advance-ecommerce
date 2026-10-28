"use client";

// Feature-flag toggle list — REAL writes (rewired 2026-10-25).
// Flipping a switch opens a reason dialog (a flag change is the
// sensitive action `feature_flags.manage`, so a reason is mandatory),
// then PATCHes /api/v1/admin/feature-flags. The API persists to the
// feature_flags table and writes an audit entry; only a successful
// response updates the switch, and router.refresh() re-reads the
// stored state from the DB so the page always reflects reality.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate } from "@/i18n/locale";
import { FEATURE_FLAGS_STRINGS } from "./strings";

export interface FlagListItem {
  key: string;
  /** Description resolved to the active locale server-side (bn text or the exact seed.ts FEATURE_FLAGS string). */
  description: string;
  linkPath: string | null;
  linkLabel: string | null;
  /** Stored state from the feature_flags table (read server-side). */
  enabled: boolean;
}

export function FlagList({ items }: { items: FlagListItem[] }) {
  const router = useRouter();
  const { locale } = useLocale();
  const t = FEATURE_FLAGS_STRINGS[locale];
  // Local overrides sit on top of the server-read props until the next
  // refresh replaces them with the stored state.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const signature = items.map((i) => `${i.key}:${i.enabled}`).join(",");
  useEffect(() => {
    setOverrides({});
  }, [signature]);

  const [pending, setPending] = useState<{ key: string; target: boolean } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const pendingItem = pending ? items.find((i) => i.key === pending.key) : undefined;

  async function confirmToggle() {
    if (!pending || busy) return;
    if (reason.trim() === "") {
      setError(t.reasonRequired);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/v1/admin/feature-flags", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: pending.key, enabled: pending.target, reason: reason.trim() }),
      });
      const body = (await res.json().catch(() => null)) as
        | { data?: { enabled: boolean; persisted: boolean }; error?: { code: string; message: string } }
        | null;
      if (res.ok && body?.data?.persisted) {
        setOverrides((o) => ({ ...o, [pending.key]: pending.target }));
        setPending(null);
        setReason("");
        router.refresh();
      } else {
        setError(body?.error ? `${body.error.code}: ${body.error.message}` : `HTTP ${res.status}`);
      }
    } catch {
      setError(t.networkError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ul className="divide-y divide-border/60">
        {items.map((item) => {
          const on = overrides[item.key] ?? item.enabled;
          return (
            <li key={item.key} className="flex flex-wrap items-center gap-3 py-4 first:pt-0 last:pb-0">
              <div className="min-w-[240px] flex-1">
                <p className="font-mono text-sm font-medium text-text-main">{item.key}</p>
                <p className="mt-0.5 text-sm text-text-muted">{item.description}</p>
                {item.linkPath ? (
                  <a href={item.linkPath} className="mt-1 inline-block text-sm font-medium text-brand-700 hover:underline">
                    {interpolate(t.modulePage, { label: item.linkLabel ?? "" })}
                  </a>
                ) : (
                  <p className="mt-1 text-xs text-text-subtle">{t.noPage}</p>
                )}
              </div>
              <Badge tone={on ? "success" : "neutral"}>{on ? "ON" : "OFF"}</Badge>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={interpolate(t.toggleAria, { key: item.key })}
                onClick={() => {
                  setError("");
                  setReason("");
                  setPending({ key: item.key, target: !on });
                }}
                className={`relative h-7 w-12 shrink-0 rounded-full shadow-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 ${on ? "bg-brand-600" : "border border-border bg-surface-2"}`}
              >
                <span
                  className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow-card transition-all ${on ? "left-[22px]" : "left-0.5"}`}
                />
              </button>
            </li>
          );
        })}
      </ul>

      <Modal
        open={pending !== null}
        onClose={() => {
          if (!busy) setPending(null);
        }}
        title={pending ? (pending.target ? t.modalTitleOn : t.modalTitleOff) : t.modalTitleChange}
        onConfirm={() => void confirmToggle()}
      >
        <p className="text-small leading-relaxed">
          <span className="font-mono font-medium">{pending?.key}</span>
          {t.modalBodyA}
          {pendingItem ? <>{interpolate(t.modalModule, { description: pendingItem.description })}</> : null}
        </p>
        <label className="mb-1.5 mt-4 block text-small font-medium" htmlFor="flag-toggle-reason">
          {t.reasonLabel}
        </label>
        <input
          id="flag-toggle-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t.reasonPlaceholder}
          className="h-11 w-full rounded-md border border-border bg-card px-3 text-sm shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        />
        {error && (
          <p role="alert" className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-small text-danger">
            {error}
          </p>
        )}
        {busy && <p className="mt-3 text-small text-text-muted">{t.saving}</p>}
      </Modal>
    </>
  );
}
