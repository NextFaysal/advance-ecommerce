"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { Toast } from "@/components/ui/toast";
import type { AdminAttributeSet } from "@/catalog/attributes-admin";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { ATTRIBUTES_STRINGS } from "./strings";

// Attribute sets manager (Wave 13-2) — list + create/edit modal +
// delete against the real /api/v1/admin/attributes API. This manages
// the reusable set LIBRARY only (ProductAttribute rows); values are
// edited one per line. A duplicate key comes back as 409 and is
// shown verbatim.

interface ApiErrorBody {
  error?: { code?: string; message?: string };
}

async function api<T>(url: string, init?: RequestInit, fallback?: (status: number) => string): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as ApiErrorBody & { data?: T };
  if (!res.ok) {
    throw new Error(body.error?.message ?? (fallback ? fallback(res.status) : `Request failed (${res.status})`));
  }
  return body.data as T;
}

interface AttributeForm {
  key: string;
  labelBn: string;
  labelEn: string;
  valuesText: string; // one value per line
}

const EMPTY_FORM: AttributeForm = { key: "", labelBn: "", labelEn: "", valuesText: "" };

function parseValues(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const v = line.trim();
    if (v === "" || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

export function AttributesManager({ initial }: { initial: AdminAttributeSet[] }) {
  const { locale, t: common } = useLocale();
  const s = pick(locale, ATTRIBUTES_STRINGS);
  const apiL = <T,>(url: string, init?: RequestInit): Promise<T> =>
    api<T>(url, init, (status) => interpolate(s.requestFailed, { status }));
  const [sets, setSets] = useState<AdminAttributeSet[]>(initial);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AdminAttributeSet | null>(null);
  const [form, setForm] = useState<AttributeForm>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<AdminAttributeSet | null>(null);

  async function refresh() {
    const data = await apiL<{ attributes: AdminAttributeSet[] }>("/api/v1/admin/attributes");
    setSets(data.attributes);
  }

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  }

  function openEdit(set: AdminAttributeSet) {
    setEditing(set);
    setForm({
      key: set.key,
      labelBn: set.labelBn,
      labelEn: set.labelEn,
      valuesText: set.values.join("\n"),
    });
    setFormOpen(true);
  }

  async function submitForm() {
    const payload: Record<string, unknown> = {
      key: form.key.trim(),
      labelBn: form.labelBn.trim(),
      labelEn: form.labelEn.trim(),
      values: parseValues(form.valuesText),
    };
    try {
      if (editing) {
        await apiL(`/api/v1/admin/attributes/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        setNotice({ tone: "success", text: s.updated });
      } else {
        await apiL("/api/v1/admin/attributes", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setNotice({ tone: "success", text: s.created });
      }
      setFormOpen(false);
      await refresh();
    } catch (e) {
      setNotice({ tone: "error", text: e instanceof Error ? e.message : s.saveFailed });
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    try {
      await apiL(`/api/v1/admin/attributes/${deleteTarget.id}`, { method: "DELETE" });
      setNotice({ tone: "success", text: s.deleted });
      setDeleteTarget(null);
      await refresh();
    } catch (e) {
      setNotice({ tone: "error", text: e instanceof Error ? e.message : s.deleteFailed });
      setDeleteTarget(null);
    }
  }

  return (
    <div>
      {notice ? (
        <div className="mb-4">
          <Toast tone={notice.tone}>{notice.text}</Toast>
        </div>
      ) : null}

      <div className="mb-4 flex gap-3 rounded-2xl border border-info-solid/30 bg-info-soft px-4 py-3.5 shadow-xs">
        <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-info-soft text-info-solid">
          <Icon name="info" size={17} />
        </span>
        <p className="text-sm leading-relaxed text-text-main">
          {s.libraryNote}
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2.5 text-sm text-text-muted">
          <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-brand-soft text-brand-600">
            <Icon name="package" size={17} />
          </span>
          {interpolate(s.totalLabel, { count: sets.length })}
        </p>
        <Button variant="gradient" onClick={openCreate} className="max-sm:w-full">
          <Icon name="plus" size={16} /> {s.newSet}
        </Button>
      </div>

      {sets.length === 0 ? (
        <EmptyState title={s.pageTitle} description={s.empty} actionLabel={s.newSet} onAction={openCreate} />
      ) : (
        <>
          {/* Desktop / tablet: v2 table */}
          <div className="overflow-x-auto rounded-2xl border border-border/60 bg-card shadow-xs max-md:hidden">
            <table className="w-full text-sm">
              <thead className="bg-surface-2/80">
                <tr className="text-left">
                  <th className="sticky top-0 z-10 bg-surface-2 px-4 py-3 text-xs font-semibold text-text-muted">{s.colAttribute}</th>
                  <th className="sticky top-0 z-10 bg-surface-2 px-4 py-3 text-xs font-semibold text-text-muted">{s.colKey}</th>
                  <th className="sticky top-0 z-10 bg-surface-2 px-4 py-3 text-xs font-semibold text-text-muted">{s.colValues}</th>
                  <th className="sticky top-0 z-10 bg-surface-2 px-4 py-3 text-right text-xs font-semibold text-text-muted">{s.colActions}</th>
                </tr>
              </thead>
              <tbody>
                {sets.map((set) => (
                  <tr key={set.id} className="border-t border-border/60 transition duration-fast ease-smooth first:border-t-0 hover:bg-brand-soft/60">
                    <td className="px-4 py-3">
                      <span className="block font-medium text-text-main">{set.labelBn}</span>
                      <span className="block text-xs text-text-muted">{set.labelEn}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex h-6 items-center rounded-full bg-surface-2 px-2.5 font-mono text-xs text-text-muted ring-1 ring-inset ring-border/60">
                        {set.key}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex max-w-md flex-wrap gap-1.5">
                        {set.values.map((v) => (
                          <span key={v} className="inline-flex h-6 items-center rounded-full bg-brand-soft px-2.5 text-xs font-medium text-brand-700 ring-1 ring-inset ring-brand-ink/10">
                            {v}
                          </span>
                        ))}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" variant="secondary" onClick={() => openEdit(set)}>
                          {s.edit}
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => setDeleteTarget(set)}>
                          {s.deleteBtn}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: card list */}
          <ul className="space-y-2.5 md:hidden">
            {sets.map((set) => (
              <li key={set.id} className="rounded-2xl border border-border/60 bg-card p-4 shadow-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-text-main">{set.labelBn}</span>
                    <span className="block truncate text-xs text-text-muted">{set.labelEn}</span>
                  </span>
                  <span className="ml-auto inline-flex h-6 shrink-0 items-center rounded-full bg-surface-2 px-2.5 font-mono text-xs text-text-muted ring-1 ring-inset ring-border/60">
                    {set.key}
                  </span>
                </div>
                <span className="mt-2.5 flex flex-wrap gap-1.5">
                  {set.values.map((v) => (
                    <span key={v} className="inline-flex h-6 items-center rounded-full bg-brand-soft px-2.5 text-xs font-medium text-brand-700 ring-1 ring-inset ring-brand-ink/10">
                      {v}
                    </span>
                  ))}
                </span>
                <div className="mt-3 flex gap-1.5 [&>*]:flex-1">
                  <Button size="sm" variant="secondary" onClick={() => openEdit(set)}>
                    {s.edit}
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => setDeleteTarget(set)}>
                    {s.deleteBtn}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <Drawer
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? s.editTitle : s.createTitle}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setFormOpen(false)}>{common.cancel}</Button>
            <Button variant="gradient" onClick={submitForm}>{s.confirm}</Button>
          </div>
        }
      >
        <div className="grid gap-3">
          <Input
            label={s.keyLabel}
            name="key"
            required
            value={form.key}
            onChange={(e) => setForm({ ...form, key: e.target.value })}
            placeholder={s.keyPh}
            helper={s.keyHelper}
          />
          <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
            <Input
              label={s.labelBn}
              name="labelBn"
              required
              value={form.labelBn}
              onChange={(e) => setForm({ ...form, labelBn: e.target.value })}
              placeholder={s.labelBnPh}
            />
            <Input
              label={s.labelEn}
              name="labelEn"
              required
              value={form.labelEn}
              onChange={(e) => setForm({ ...form, labelEn: e.target.value })}
              placeholder={s.labelEnPh}
            />
          </div>
          <Textarea
            label={s.valuesLabel}
            name="values"
            required
            rows={5}
            value={form.valuesText}
            onChange={(e) => setForm({ ...form, valuesText: e.target.value })}
            placeholder={s.valuesPh}
            helper={s.valuesHelper}
          />
        </div>
      </Drawer>

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={s.deleteTitle}
        onConfirm={confirmDelete}
      >
        <div className="flex gap-3">
          <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-danger-soft text-danger ring-1 ring-inset ring-danger/20">
            <Icon name="alert" size={20} />
          </span>
          <p className="text-sm leading-relaxed text-text-muted">
            {interpolate(s.deleteBody, { name: deleteTarget?.labelBn ?? "" })}
          </p>
        </div>
      </Modal>
    </div>
  );
}
