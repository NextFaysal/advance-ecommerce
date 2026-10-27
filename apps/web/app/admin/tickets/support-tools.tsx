"use client";

/**
 * Support tools for /admin/tickets (ADV-16 remainder):
 *
 * - <CannedReplyPicker> — used inside the ticket reply box: picks a
 *   canned reply and hands its body to the parent, which inserts it
 *   into the reply textarea (staff can still edit before sending —
 *   nothing is ever auto-sent).
 * - <CannedRepliesEditor> — CRUD for the `support.canned_replies`
 *   Setting doc via /api/v1/admin/support/canned-replies.
 * - <KbArticlesEditor> — CRUD for the `support.kb_articles` Setting
 *   doc via /api/v1/admin/support/kb-articles; only published
 *   articles appear on the public /kb pages.
 *
 * Both editors replace the whole list on save and require a reason
 * (the API audits the change); a failed save never claims success.
 */
import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { TICKETS_STRINGS } from "./strings";

interface CannedReply {
  id: string;
  title: string;
  body: string;
}

interface KbArticle {
  id: string;
  slug: string;
  titleBn: string;
  titleEn: string;
  bodyBn: string;
  bodyEn: string;
  published: boolean;
}

interface ListResponse<T> {
  data?: T;
  error?: { code: string; message: string; details?: unknown };
}

const inputClass =
  "w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm text-text-main outline-none focus:border-brand-500";
const labelClass = "mb-1 block text-xs font-semibold text-text-muted";

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function detailsText(details: unknown): string {
  if (Array.isArray(details)) {
    return details
      .map((d) =>
        typeof d === "string"
          ? d
          : typeof d === "object" && d !== null && "message" in d
            ? String((d as { message: unknown }).message)
            : "",
      )
      .filter(Boolean)
      .join(" · ");
  }
  return "";
}

/* ------------------------- canned reply picker ------------------------ */

export function CannedReplyPicker({ onInsert }: { onInsert: (body: string) => void }) {
  const { locale } = useLocale();
  const s = pick(locale, TICKETS_STRINGS);
  const [replies, setReplies] = useState<CannedReply[]>([]);
  const [picked, setPicked] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/v1/admin/support/canned-replies");
        const json = (await res.json().catch(() => null)) as ListResponse<{ replies: CannedReply[] }> | null;
        if (!cancelled && res.ok && json?.data) setReplies(json.data.replies);
      } catch {
        // Picker is a convenience — a failed load just hides it.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (replies.length === 0) return null;

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <label className="text-xs font-semibold text-text-muted" htmlFor="canned-reply-picker">
        {s.pickerLabel}
      </label>
      <select
        id="canned-reply-picker"
        value={picked}
        onChange={(e) => setPicked(e.target.value)}
        className="h-9 rounded-lg border border-border bg-surface px-2.5 text-sm text-text-main outline-none focus:border-brand-500"
      >
        <option value="">{s.pickerPlaceholder}</option>
        {replies.map((r) => (
          <option key={r.id} value={r.id}>
            {r.title}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={!picked}
        onClick={() => {
          const reply = replies.find((r) => r.id === picked);
          if (reply) onInsert(reply.body);
          setPicked("");
        }}
        className="h-9 rounded-lg border border-border bg-card px-3 text-sm font-semibold text-text-main transition hover:bg-surface-2 disabled:opacity-50"
      >
        {s.pickerInsert}
      </button>
    </div>
  );
}

/* --------------------------- editor shell ----------------------------- */

function useDocEditor<T>(url: string) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  return { items, setItems, loading, setLoading, busy, setBusy, reason, setReason, error, setError, message, setMessage, url };
}

/* ------------------------- canned replies editor ---------------------- */

export function CannedRepliesEditor() {
  const { locale, t } = useLocale();
  const s = pick(locale, TICKETS_STRINGS);
  const ed = useDocEditor<CannedReply>("/api/v1/admin/support/canned-replies");
  const { setItems, setLoading, setError } = ed;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/admin/support/canned-replies");
      const json = (await res.json().catch(() => null)) as ListResponse<{ replies: CannedReply[] }> | null;
      if (!res.ok || !json?.data) {
        setError(json?.error?.message ?? s.cannedLoadFailed);
        return;
      }
      setItems(json.data.replies);
    } catch {
      setError(s.networkError);
    } finally {
      setLoading(false);
    }
  }, [setError, setItems, setLoading, s]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    ed.setBusy(true);
    ed.setError(null);
    ed.setMessage(null);
    try {
      const res = await fetch("/api/v1/admin/support/canned-replies", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replies: ed.items, reason: ed.reason.trim() }),
      });
      const json = (await res.json().catch(() => null)) as ListResponse<{ replies: CannedReply[] }> | null;
      if (!res.ok || !json?.data) {
        const extra = detailsText(json?.error?.details);
        ed.setError((json?.error?.message ?? s.saveFailed) + (extra ? ` (${extra})` : ""));
        return;
      }
      ed.setItems(json.data.replies);
      ed.setReason("");
      ed.setMessage(s.cannedSaved);
    } catch {
      ed.setError(s.networkError);
    } finally {
      ed.setBusy(false);
    }
  }

  return (
    <Card>
      <h3 className="text-base font-bold text-text-main">{s.cannedTitle}</h3>
      <p className="mt-1 text-xs leading-5 text-text-muted">
        {s.cannedDesc}
      </p>
      {ed.error ? (
        <p role="alert" className="mt-3 text-sm font-medium text-rose-600">{ed.error}</p>
      ) : null}
      {ed.message ? <p className="mt-3 text-sm font-medium text-emerald-600">{ed.message}</p> : null}
      {ed.loading ? (
        <p className="mt-4 text-sm text-text-muted">{t.loading}</p>
      ) : (
        <div className="mt-4 space-y-4">
          {ed.items.map((r, i) => (
            <div key={r.id} className="rounded-xl border border-border p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-text-muted">{interpolate(s.replyN, { n: i + 1 })}</span>
                <button
                  type="button"
                  onClick={() => ed.setItems(ed.items.filter((x) => x.id !== r.id))}
                  className="text-xs font-semibold text-rose-600 hover:underline"
                >
                  {t.delete}
                </button>
              </div>
              <label className={`${labelClass} mt-2`}>{s.cannedTitleLabel}</label>
              <input
                value={r.title}
                maxLength={120}
                onChange={(e) =>
                  ed.setItems(ed.items.map((x) => (x.id === r.id ? { ...x, title: e.target.value } : x)))
                }
                className={inputClass}
                placeholder={s.cannedTitlePlaceholder}
              />
              <label className={`${labelClass} mt-2`}>{s.cannedBodyLabel}</label>
              <textarea
                value={r.body}
                rows={3}
                maxLength={5000}
                onChange={(e) =>
                  ed.setItems(ed.items.map((x) => (x.id === r.id ? { ...x, body: e.target.value } : x)))
                }
                className={inputClass}
              />
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              ed.setItems([...ed.items, { id: newId("canned"), title: "", body: "" }])
            }
            className="h-10 rounded-xl border border-border bg-card px-4 text-sm font-semibold text-text-main transition hover:bg-surface-2"
          >
            {s.addCanned}
          </button>
          <div>
            <label className={labelClass} htmlFor="canned-replies-reason">{s.reasonLabel}</label>
            <input
              id="canned-replies-reason"
              value={ed.reason}
              onChange={(e) => ed.setReason(e.target.value)}
              className={inputClass}
              placeholder={s.reasonPlaceholder}
            />
          </div>
          <button
            type="button"
            onClick={() => void save()}
            disabled={ed.busy || !ed.reason.trim()}
            className="brand-gradient h-10 rounded-xl px-4 text-sm font-bold text-white shadow transition hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
          >
            {ed.busy ? s.saving : s.saveCanned}
          </button>
        </div>
      )}
    </Card>
  );
}

/* ----------------------------- KB editor ------------------------------ */

export function KbArticlesEditor() {
  const { locale, t } = useLocale();
  const s = pick(locale, TICKETS_STRINGS);
  const ed = useDocEditor<KbArticle>("/api/v1/admin/support/kb-articles");
  const { setItems, setLoading, setError } = ed;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/admin/support/kb-articles");
      const json = (await res.json().catch(() => null)) as ListResponse<{ articles: KbArticle[] }> | null;
      if (!res.ok || !json?.data) {
        setError(json?.error?.message ?? s.kbLoadFailed);
        return;
      }
      setItems(json.data.articles);
    } catch {
      setError(s.networkError);
    } finally {
      setLoading(false);
    }
  }, [setError, setItems, setLoading, s]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    ed.setBusy(true);
    ed.setError(null);
    ed.setMessage(null);
    try {
      const res = await fetch("/api/v1/admin/support/kb-articles", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ articles: ed.items, reason: ed.reason.trim() }),
      });
      const json = (await res.json().catch(() => null)) as ListResponse<{ articles: KbArticle[] }> | null;
      if (!res.ok || !json?.data) {
        const extra = detailsText(json?.error?.details);
        ed.setError((json?.error?.message ?? s.saveFailed) + (extra ? ` (${extra})` : ""));
        return;
      }
      ed.setItems(json.data.articles);
      ed.setReason("");
      ed.setMessage(s.kbSaved);
    } catch {
      ed.setError(s.networkError);
    } finally {
      ed.setBusy(false);
    }
  }

  function patch(id: string, part: Partial<KbArticle>) {
    ed.setItems(ed.items.map((x) => (x.id === id ? { ...x, ...part } : x)));
  }

  return (
    <Card>
      <h3 className="text-base font-bold text-text-main">{s.kbTitle}</h3>
      <p className="mt-1 text-xs leading-5 text-text-muted">
        {s.kbDescA} <span className="font-mono">delivery-charge</span>{s.kbDescB}
      </p>
      {ed.error ? (
        <p role="alert" className="mt-3 text-sm font-medium text-rose-600">{ed.error}</p>
      ) : null}
      {ed.message ? <p className="mt-3 text-sm font-medium text-emerald-600">{ed.message}</p> : null}
      {ed.loading ? (
        <p className="mt-4 text-sm text-text-muted">{t.loading}</p>
      ) : (
        <div className="mt-4 space-y-4">
          {ed.items.map((a, i) => (
            <div key={a.id} className="rounded-xl border border-border p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold text-text-muted">{interpolate(s.articleN, { n: i + 1 })}</span>
                <span className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-text-main">
                    <input
                      type="checkbox"
                      checked={a.published}
                      onChange={(e) => patch(a.id, { published: e.target.checked })}
                    />
                    {s.publishedLabel}
                  </label>
                  <button
                    type="button"
                    onClick={() => ed.setItems(ed.items.filter((x) => x.id !== a.id))}
                    className="text-xs font-semibold text-rose-600 hover:underline"
                  >
                    {t.delete}
                  </button>
                </span>
              </div>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>{s.slugLabel}</label>
                  <input
                    value={a.slug}
                    maxLength={80}
                    onChange={(e) => patch(a.id, { slug: e.target.value })}
                    className={`${inputClass} font-mono`}
                    placeholder="delivery-charge"
                  />
                </div>
                <div>
                  <label className={labelClass}>{s.kbTitleBnLabel}</label>
                  <input
                    value={a.titleBn}
                    maxLength={200}
                    onChange={(e) => patch(a.id, { titleBn: e.target.value })}
                    className={inputClass}
                  />
                </div>
              </div>
              <label className={`${labelClass} mt-2`}>{s.kbTitleEnLabel}</label>
              <input
                value={a.titleEn}
                maxLength={200}
                onChange={(e) => patch(a.id, { titleEn: e.target.value })}
                className={inputClass}
              />
              <label className={`${labelClass} mt-2`}>{s.kbBodyBnLabel}</label>
              <textarea
                value={a.bodyBn}
                rows={4}
                maxLength={20000}
                onChange={(e) => patch(a.id, { bodyBn: e.target.value })}
                className={inputClass}
              />
              <label className={`${labelClass} mt-2`}>{s.kbBodyEnLabel}</label>
              <textarea
                value={a.bodyEn}
                rows={3}
                maxLength={20000}
                onChange={(e) => patch(a.id, { bodyEn: e.target.value })}
                className={inputClass}
              />
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              ed.setItems([
                ...ed.items,
                { id: newId("kb"), slug: "", titleBn: "", titleEn: "", bodyBn: "", bodyEn: "", published: false },
              ])
            }
            className="h-10 rounded-xl border border-border bg-card px-4 text-sm font-semibold text-text-main transition hover:bg-surface-2"
          >
            {s.addArticle}
          </button>
          <div>
            <label className={labelClass} htmlFor="kb-articles-reason">{s.reasonLabel}</label>
            <input
              id="kb-articles-reason"
              value={ed.reason}
              onChange={(e) => ed.setReason(e.target.value)}
              className={inputClass}
              placeholder={s.reasonPlaceholder}
            />
          </div>
          <button
            type="button"
            onClick={() => void save()}
            disabled={ed.busy || !ed.reason.trim()}
            className="brand-gradient h-10 rounded-xl px-4 text-sm font-bold text-white shadow transition hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
          >
            {ed.busy ? s.saving : s.saveArticles}
          </button>
        </div>
      )}
    </Card>
  );
}
