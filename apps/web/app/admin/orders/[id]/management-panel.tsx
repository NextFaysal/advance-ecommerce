"use client";

/**
 * Order management panel — order detail page (doc 17, O6).
 *
 * Talks to /api/v1/admin/orders/[id]/management (GET view, PATCH
 * changes). Covers the handling metadata: assignee (staff list from
 * GET /api/v1/admin/staff), priority, tags, the operational HOLD and
 * internal notes.
 *
 * THE HOLD IS A LOUD UI SIGNAL, NOT A LOCK: setting a hold requires
 * a reason and shows a banner here, but it does not block the
 * status funnel — staff must still respect it manually. The panel
 * says exactly that so nobody mistakes the hold for enforcement.
 *
 * Props are serializable only (the order id); all data is fetched
 * client-side, so a 403 (no orders.edit / orders.view) degrades to
 * a quiet note instead of breaking the order page.
 */
import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Priority = "LOW" | "NORMAL" | "HIGH" | "URGENT";

interface NoteView {
  id: string;
  text: string;
  authorName: string | null;
  createdAt: string;
}

interface ManagementView {
  orderId: string;
  assignedToId: string | null;
  assigneeName: string | null;
  priority: Priority;
  tags: string[];
  held: boolean;
  heldAt: string | null;
  heldReason: string | null;
  notes: NoteView[];
}

interface StaffRow {
  id: string;
  name: string;
  role: string;
  status: string;
}

const PRIORITY_LABEL: Record<Priority, string> = {
  LOW: "কম",
  NORMAL: "সাধারণ",
  HIGH: "বেশি",
  URGENT: "জরুরি",
};

const PRIORITY_TONE: Record<Priority, "success" | "warning" | "danger" | "info" | "neutral"> = {
  LOW: "neutral",
  NORMAL: "info",
  HIGH: "warning",
  URGENT: "danger",
};

const inputCls =
  "h-11 w-full rounded-md border border-border bg-card px-3 text-sm shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("bn-BD", {
    timeZone: "Asia/Dhaka",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function ManagementPanel({ orderId }: { orderId: string }) {
  const [view, setView] = useState<ManagementView | null>(null);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [staffFailed, setStaffFailed] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const [assignedToId, setAssignedToId] = useState<string>("");
  const [priority, setPriority] = useState<Priority>("NORMAL");
  const [tagsText, setTagsText] = useState("");
  const [holdReason, setHoldReason] = useState("");
  const [noteText, setNoteText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/admin/orders/${encodeURIComponent(orderId)}/management`);
      if (res.status === 403 || res.status === 401) {
        setForbidden(true);
        return;
      }
      const json = (await res.json().catch(() => ({}))) as { data?: ManagementView };
      if (json.data) {
        setView(json.data);
        setAssignedToId(json.data.assignedToId ?? "");
        setPriority(json.data.priority);
        setTagsText(json.data.tags.join(", "));
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

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/v1/admin/staff?page=1&pageSize=100");
        const json = (await res.json().catch(() => ({}))) as {
          data?: { staff?: StaffRow[] } | StaffRow[];
        };
        if (!res.ok) {
          setStaffFailed(true);
          return;
        }
        const rows = Array.isArray(json.data) ? json.data : (json.data?.staff ?? []);
        setStaff(rows.filter((s) => s.status === "ACTIVE" || s.status === undefined));
      } catch {
        setStaffFailed(true);
      }
    })();
  }, []);

  async function patch(body: Record<string, unknown>, okMsg: string) {
    setBusy(true);
    setError(null);
    setSavedMsg(null);
    try {
      const res = await fetch(`/api/v1/admin/orders/${encodeURIComponent(orderId)}/management`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as {
        data?: ManagementView;
        error?: { message?: string };
      };
      if (!res.ok || !json.data) {
        setError(json.error?.message ?? "সেভ করা যায়নি।");
        return;
      }
      setSavedMsg(okMsg);
      await load();
    } catch {
      setError("নেটওয়ার্ক সমস্যা — আবার চেষ্টা করুন।");
    } finally {
      setBusy(false);
    }
  }

  if (forbidden) return null;
  if (loadFailed) {
    return (
      <Card className="p-4">
        <p className="text-small text-text-subtle">অর্ডার ব্যবস্থাপনার তথ্য লোড করা যায়নি।</p>
      </Card>
    );
  }
  if (!view) {
    return (
      <Card className="p-4">
        <p className="text-small text-text-subtle">লোড হচ্ছে…</p>
      </Card>
    );
  }

  const fieldsDirty =
    (view.assignedToId ?? "") !== assignedToId ||
    view.priority !== priority ||
    view.tags.join(", ") !== tagsText.trim();

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-small font-semibold">অর্ডার ব্যবস্থাপনা</h3>
        <Badge tone={PRIORITY_TONE[view.priority]}>অগ্রাধিকার: {PRIORITY_LABEL[view.priority]}</Badge>
        {view.held && <Badge tone="danger">হোল্ডে আছে</Badge>}
      </div>

      {view.held && (
        <div
          role="alert"
          className="mt-3 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 dark:border-rose-400/30 dark:bg-rose-500/10"
        >
          <p className="text-sm font-semibold text-rose-900 dark:text-rose-200">
            ⏸ এই অর্ডার হোল্ডে আছে{view.heldAt ? ` — ${fmtDate(view.heldAt)} থেকে` : ""}
          </p>
          <p className="mt-0.5 text-small text-rose-800 dark:text-rose-300">
            কারণ: {view.heldReason ?? "—"}
          </p>
          <p className="mt-1 text-caption text-rose-700 dark:text-rose-300">
            হোল্ড শুধু একটি সতর্ক সংকেত — সিস্টেম স্ট্যাটাস বদল আটকায় না; অর্ডার নিয়ে এগোনোর আগে
            কারণটি মিটিয়ে নিন।
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2"
            disabled={busy}
            onClick={() => void patch({ held: false }, "হোল্ড তোলা হয়েছে।")}
          >
            হোল্ড তুলুন
          </Button>
        </div>
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-caption font-medium text-text-subtle">দায়িত্বপ্রাপ্ত কর্মী</span>
          <select
            className={inputCls}
            value={assignedToId}
            onChange={(e) => setAssignedToId(e.target.value)}
            disabled={busy}
          >
            <option value="">— অনির্ধারিত —</option>
            {view.assignedToId &&
              !staff.some((s) => s.id === view.assignedToId) && (
                <option value={view.assignedToId}>
                  {view.assigneeName ?? "বর্তমান দায়িত্বপ্রাপ্ত"}
                </option>
              )}
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.role})
              </option>
            ))}
          </select>
          {staffFailed && (
            <span className="mt-1 block text-caption text-text-subtle">
              কর্মী তালিকা লোড হয়নি (staff.view অনুমতি লাগতে পারে)।
            </span>
          )}
        </label>
        <label className="block">
          <span className="mb-1 block text-caption font-medium text-text-subtle">অগ্রাধিকার</span>
          <select
            className={inputCls}
            value={priority}
            onChange={(e) => setPriority(e.target.value as Priority)}
            disabled={busy}
          >
            {(Object.keys(PRIORITY_LABEL) as Priority[]).map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]} ({p})
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="mt-3 block">
        <span className="mb-1 block text-caption font-medium text-text-subtle">
          ট্যাগ (কমা দিয়ে আলাদা করুন, সর্বোচ্চ ১০টি)
        </span>
        <input
          className={inputCls}
          value={tagsText}
          onChange={(e) => setTagsText(e.target.value)}
          placeholder="যেমন: জরুরি, আগে কল করুন"
          disabled={busy}
        />
      </label>
      {view.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {view.tags.map((t) => (
            <Badge key={t} tone="neutral">
              {t}
            </Badge>
          ))}
        </div>
      )}

      <div className="mt-3 flex justify-end">
        <Button
          type="button"
          disabled={!fieldsDirty || busy}
          onClick={() =>
            void patch(
              {
                assignedToId: assignedToId === "" ? null : assignedToId,
                priority,
                tags: tagsText
                  .split(",")
                  .map((t) => t.trim())
                  .filter(Boolean),
              },
              "ব্যবস্থাপনা সেভ হয়েছে।",
            )
          }
        >
          {busy ? "সেভ হচ্ছে…" : "সেভ করুন"}
        </Button>
      </div>

      {!view.held && (
        <div className="mt-4 border-t border-border pt-3">
          <p className="text-small font-medium">অর্ডার হোল্ড করুন</p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input
              className={inputCls}
              value={holdReason}
              onChange={(e) => setHoldReason(e.target.value)}
              placeholder="হোল্ডের কারণ (আবশ্যক)"
              disabled={busy}
            />
            <Button
              type="button"
              variant="destructive"
              disabled={busy || holdReason.trim().length === 0}
              onClick={() =>
                void patch({ held: true, heldReason: holdReason.trim() }, "অর্ডার হোল্ড করা হয়েছে।")
              }
            >
              হোল্ড করুন
            </Button>
          </div>
        </div>
      )}

      <div className="mt-4 border-t border-border pt-3">
        <p className="text-small font-medium">অভ্যন্তরীণ নোট</p>
        <textarea
          className="mt-2 min-h-[72px] w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          placeholder="শুধু কর্মীদের জন্য নোট লিখুন…"
          disabled={busy}
        />
        <div className="mt-2 flex justify-end">
          <Button
            type="button"
            variant="secondary"
            disabled={busy || noteText.trim().length === 0}
            onClick={() => {
              void patch({ note: noteText.trim() }, "নোট যোগ হয়েছে।").then(() => setNoteText(""));
            }}
          >
            নোট যোগ করুন
          </Button>
        </div>
        {view.notes.length > 0 ? (
          <ul className="mt-2 space-y-2">
            {view.notes.map((n) => (
              <li key={n.id} className="rounded-md bg-surface-2 px-3 py-2">
                <p className="whitespace-pre-wrap text-small leading-relaxed">{n.text}</p>
                <p className="mt-1 text-caption text-text-subtle">
                  {n.authorName ?? "সিস্টেম"} · {fmtDate(n.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-caption text-text-subtle">এখনো কোনো নোট নেই।</p>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-small text-rose-800 dark:bg-rose-500/10 dark:text-rose-200"
        >
          {error}
        </p>
      )}
      {savedMsg && (
        <p
          role="status"
          className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-small text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200"
        >
          {savedMsg}
        </p>
      )}
    </Card>
  );
}
