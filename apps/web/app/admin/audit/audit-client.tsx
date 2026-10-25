"use client";

// Audit log browser — wired to the real DB-backed API
// (GET /api/v1/admin/audit-log, permission audit.view) on 2026-10-25,
// replacing the hardcoded SAMPLE rows this page used to render.
// Filters (actor / action / entity / date range) and pagination are
// the API's own query parameters. Export posts to
// POST /api/v1/admin/audit-log/export with a mandatory reason — the
// export itself is recorded in the AuditLog table.
import { useCallback, useEffect, useState } from "react";
import { StatCard } from "@/components/ui/stat-card";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { Modal } from "@/components/ui/modal";

interface AuditEntry {
  id: string;
  actorId: string | null;
  actorLabel: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  reason: string | null;
  sensitive: boolean;
  createdAt: string; // ISO
}

interface Filters {
  actor: string;
  action: string;
  entity: string;
  from: string;
  to: string;
}

const EMPTY_FILTERS: Filters = { actor: "", action: "", entity: "", from: "", to: "" };
const PAGE_SIZE = 20;

function formatDhakaTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("bn-BD", {
    timeZone: "Asia/Dhaka",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

function buildQuery(filters: Filters, page: number): string {
  const params = new URLSearchParams();
  if (filters.actor.trim() !== "") params.set("actor", filters.actor.trim());
  if (filters.action.trim() !== "") params.set("action", filters.action.trim());
  if (filters.entity.trim() !== "") params.set("entity", filters.entity.trim());
  if (filters.from !== "") params.set("from", filters.from);
  if (filters.to !== "") params.set("to", filters.to);
  params.set("page", String(page));
  params.set("pageSize", String(PAGE_SIZE));
  return params.toString();
}

export function AuditClient() {
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [exportOpen, setExportOpen] = useState(false);
  const [exportReason, setExportReason] = useState("");
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState("");
  const [exportDone, setExportDone] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/admin/audit-log?${buildQuery(applied, page)}`);
      const body = (await res.json().catch(() => null)) as
        | { data?: { entries: AuditEntry[]; total: number }; error?: { code: string; message: string } }
        | null;
      if (res.ok && body?.data) {
        setEntries(body.data.entries);
        setTotal(body.data.total);
      } else {
        setEntries([]);
        setTotal(0);
        setError(body?.error ? `${body.error.code}: ${body.error.message}` : `HTTP ${res.status}`);
      }
    } catch {
      setEntries([]);
      setTotal(0);
      setError("নেটওয়ার্ক সমস্যা — API-তে পৌঁছানো যায়নি।");
    } finally {
      setLoading(false);
    }
  }, [applied, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const sensitiveOnPage = entries.filter((e) => e.sensitive).length;
  const withReasonOnPage = entries.filter((e) => e.reason !== null && e.reason.trim() !== "").length;

  const rows = entries.map((e) => ({
    time: <span className="whitespace-nowrap">{formatDhakaTime(e.createdAt)}</span>,
    actor: <span className="font-medium">{e.actorLabel ?? e.actorId ?? "সিস্টেম"}</span>,
    action: (
      <span className="inline-flex items-center gap-2">
        <span className="font-mono text-xs">{e.action}</span>
        {e.sensitive ? <Badge tone="warning">সংবেদনশীল</Badge> : null}
      </span>
    ),
    entity: (
      <span className="font-mono text-xs">
        {e.entityType}
        {e.entityId ? ` · ${e.entityId}` : ""}
      </span>
    ),
    reason: e.sensitive ? (
      <span className="block rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900">
        কারণ আবশ্যক: {e.reason ?? "—"}
      </span>
    ) : e.reason !== null ? (
      <span className="text-xs">{e.reason}</span>
    ) : (
      <span className="text-xs text-text-subtle">প্রযোজ্য নয়</span>
    ),
  }));

  function applyFilters() {
    setPage(1);
    setApplied(draft);
  }

  function resetFilters() {
    setDraft(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setPage(1);
  }

  async function confirmExport() {
    if (exportBusy) return;
    if (exportReason.trim() === "") {
      setExportError("এক্সপোর্টের কারণ লিখুন — এটি অডিট লগে সংরক্ষিত থাকে।");
      return;
    }
    setExportBusy(true);
    setExportError("");
    setExportDone("");
    try {
      const payload: Record<string, string> = { reason: exportReason.trim() };
      if (applied.actor.trim() !== "") payload.actor = applied.actor.trim();
      if (applied.action.trim() !== "") payload.action = applied.action.trim();
      if (applied.entity.trim() !== "") payload.entity = applied.entity.trim();
      if (applied.from !== "") payload.from = applied.from;
      if (applied.to !== "") payload.to = applied.to;
      const res = await fetch("/api/v1/admin/audit-log/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => null)) as
        | { data?: { filename: string; csv: string; rowCount: number }; error?: { code: string; message: string } }
        | null;
      if (res.ok && body?.data) {
        const blob = new Blob([body.data.csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = body.data.filename;
        a.click();
        URL.revokeObjectURL(url);
        setExportDone(`এক্সপোর্ট তৈরি হয়েছে — ${body.data.rowCount}টি সারি। এই এক্সপোর্টটিও অডিট লগে রেকর্ড হয়েছে।`);
        setExportOpen(false);
        setExportReason("");
        void load();
      } else {
        setExportError(body?.error ? `${body.error.code}: ${body.error.message}` : `HTTP ${res.status}`);
      }
    } catch {
      setExportError("নেটওয়ার্ক সমস্যা — API-তে পৌঁছানো যায়নি।");
    } finally {
      setExportBusy(false);
    }
  }

  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="মোট লগ এন্ট্রি" value={String(total)} delta="আসল লগ" icon={<Icon name="info" size={22} />} />
        <StatCard label="সংবেদনশীল কাজ (এই পৃষ্ঠায়)" value={String(sensitiveOnPage)} delta="কারণ আবশ্যক" deltaTone="down" icon={<Icon name="alert" size={22} />} />
        <StatCard label="কারণসহ এন্ট্রি (এই পৃষ্ঠায়)" value={String(withReasonOnPage)} delta="সংবেদনশীল কাজে বাধ্যতামূলক" icon={<Icon name="check" size={22} />} />
        <StatCard label="রিটেনশন" value="স্থায়ী" delta="লগ মুছে ফেলা যায় না" icon={<Icon name="shield" size={22} />} />
      </div>

      <Card className="mb-6">
        <p className="mb-3 text-sm font-medium">ফিল্টার</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <Input
            name="audit-actor"
            label="কর্মী (নাম / ইমেইল / ID)"
            placeholder="যেমন: Rahim"
            value={draft.actor}
            onChange={(e) => setDraft((d) => ({ ...d, actor: e.target.value }))}
          />
          <Input
            name="audit-action"
            label="কাজ (Action)"
            placeholder="যেমন: payments.refund"
            value={draft.action}
            onChange={(e) => setDraft((d) => ({ ...d, action: e.target.value }))}
          />
          <Input
            name="audit-entity"
            label="এনটিটি (Entity type)"
            placeholder="যেমন: Order"
            value={draft.entity}
            onChange={(e) => setDraft((d) => ({ ...d, entity: e.target.value }))}
          />
          <Input
            name="audit-from"
            label="শুরুর তারিখ (From)"
            type="date"
            value={draft.from}
            onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
          />
          <Input
            name="audit-to"
            label="শেষের তারিখ (To)"
            type="date"
            value={draft.to}
            onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
          />
        </div>
        <div className="mt-4 flex gap-2">
          <Button type="button" onClick={applyFilters}>
            ফিল্টার করুন
          </Button>
          <Button type="button" variant="outline" onClick={resetFilters}>
            রিসেট
          </Button>
        </div>
      </Card>

      <h2 className="mb-3 text-lg font-semibold">সাম্প্রতিক কার্যকলাপ</h2>
      {error ? (
        <Card className="border-rose-300 bg-rose-50 text-sm text-rose-900">
          অডিট লগ পড়া যায়নি: {error}
        </Card>
      ) : loading ? (
        <Card>
          <p className="text-sm text-text-muted">লোড হচ্ছে…</p>
        </Card>
      ) : entries.length === 0 ? (
        <Card>
          <p className="text-sm text-text-muted">
            কোনো অডিট এন্ট্রি পাওয়া যায়নি — এই ফিল্টারে কোনো লগ নেই, অথবা এখনো কোনো লগ সংরক্ষিত
            হয়নি। সংবেদনশীল কাজ (দাম বদল, রিফান্ড, ফ্ল্যাগ বদল ইত্যাদি) হলেই এখানে এন্ট্রি আসে।
          </p>
        </Card>
      ) : (
        <>
          <DataTable
            caption="অডিট লগ — সংবেদনশীল কাজের কারণ হাইলাইট করা; গোপন তথ্য (পাসওয়ার্ড, টোকেন, OTP) লগে কখনো থাকে না — sanitizeAuditJson() সেগুলো [REDACTED] করে"
            columns={[
              { key: "time", header: "সময় (Asia/Dhaka)" },
              { key: "actor", header: "কে করেছে" },
              { key: "action", header: "কাজ (Action)" },
              { key: "entity", header: "এনটিটি" },
              { key: "reason", header: "কারণ" },
            ]}
            rows={rows}
          />
          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-sm text-text-muted">
              মোট {total}টি এন্ট্রি — পৃষ্ঠা {page} / {totalPages}
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                আগের পৃষ্ঠা
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                পরের পৃষ্ঠা
              </Button>
            </div>
          </div>
        </>
      )}

      <Card className="mt-6">
        <p className="text-sm font-medium">এক্সপোর্ট নিয়ম</p>
        <p className="mt-1 text-sm text-text-muted">
          অডিট লগ এক্সপোর্ট নিজেই একটি সংবেদনশীল কাজ: কারণ লেখা বাধ্যতামূলক, এক্সপোর্টটি নিজেও
          অডিট লগে রেকর্ড হয়, এবং তৈরি CSV-র হেডারে ওয়াটারমার্ক থাকে — কে এক্সপোর্ট করেছে, কখন
          (Asia/Dhaka), এবং কারণ। এক্সপোর্টে বর্তমান ফিল্টার প্রযোজ্য হয়।
        </p>
        {exportDone ? (
          <p role="status" className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {exportDone}
          </p>
        ) : null}
        <div className="mt-4">
          <Button type="button" variant="outline" onClick={() => setExportOpen(true)}>
            অডিট লগ এক্সপোর্ট (CSV)
          </Button>
        </div>
      </Card>

      <Modal
        open={exportOpen}
        onClose={() => {
          if (!exportBusy) setExportOpen(false);
        }}
        title="অডিট লগ এক্সপোর্ট"
        onConfirm={() => void confirmExport()}
      >
        <p className="text-small leading-relaxed">
          বর্তমান ফিল্টার অনুযায়ী অডিট লগ CSV আকারে ডাউনলোড হবে। এই এক্সপোর্টটি নিজেও অডিট লগে
          রেকর্ড হবে।
        </p>
        <label className="mb-1.5 mt-4 block text-small font-medium" htmlFor="audit-export-reason">
          এক্সপোর্টের কারণ (আবশ্যক)
        </label>
        <input
          id="audit-export-reason"
          value={exportReason}
          onChange={(e) => setExportReason(e.target.value)}
          placeholder="যেমন: মাসিক হিসাব মেলানো"
          className="h-11 w-full rounded-md border border-border bg-card px-3 text-sm shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        />
        {exportError && (
          <p role="alert" className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-small text-rose-700">
            {exportError}
          </p>
        )}
        {exportBusy && <p className="mt-3 text-small text-text-muted">এক্সপোর্ট তৈরি হচ্ছে…</p>}
      </Modal>
    </>
  );
}
