"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { Toast } from "@/components/ui/toast";
import type { AdminCategory } from "@/catalog/taxonomy-admin";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { CATEGORIES_STRINGS } from "./strings";

// Categories manager (Wave P2a) — tree list + create/edit modal +
// active toggle + guarded delete, all against the real
// /api/v1/admin/categories API. Delete refusals (category still has
// products / sub-categories) come back from the API as 409 and are
// shown verbatim — the row is never optimistically removed.

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

interface CategoryForm {
  nameBn: string;
  nameEn: string;
  slug: string;
  parentId: string; // "" = root
  imageUrl: string;
  sortOrder: string;
  isActive: boolean;
  seoTitleBn: string;
  seoTitleEn: string;
  seoDescriptionBn: string;
  seoDescriptionEn: string;
}

const EMPTY_FORM: CategoryForm = {
  nameBn: "",
  nameEn: "",
  slug: "",
  parentId: "",
  imageUrl: "",
  sortOrder: "0",
  isActive: true,
  seoTitleBn: "",
  seoTitleEn: "",
  seoDescriptionBn: "",
  seoDescriptionEn: "",
};

function buildTreeRows(categories: AdminCategory[]): { cat: AdminCategory; depth: number }[] {
  const ids = new Set(categories.map((c) => c.id));
  const byParent = new Map<string | null, AdminCategory[]>();
  for (const c of categories) {
    const key = c.parentId && ids.has(c.parentId) ? c.parentId : null;
    const arr = byParent.get(key) ?? [];
    arr.push(c);
    byParent.set(key, arr);
  }
  const out: { cat: AdminCategory; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const c of byParent.get(parentId) ?? []) {
      out.push({ cat: c, depth });
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

function descendantIds(categories: AdminCategory[], id: string): Set<string> {
  const out = new Set<string>();
  const walk = (parentId: string) => {
    for (const c of categories) {
      if (c.parentId === parentId && !out.has(c.id)) {
        out.add(c.id);
        walk(c.id);
      }
    }
  };
  walk(id);
  return out;
}

export function CategoriesManager({ initial }: { initial: AdminCategory[] }) {
  const { locale, t: common } = useLocale();
  const s = pick(locale, CATEGORIES_STRINGS);
  const apiL = <T,>(url: string, init?: RequestInit): Promise<T> =>
    api<T>(url, init, (status) => interpolate(s.requestFailed, { status }));
  const [categories, setCategories] = useState<AdminCategory[]>(initial);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AdminCategory | null>(null);
  const [form, setForm] = useState<CategoryForm>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<AdminCategory | null>(null);

  const rows = useMemo(() => buildTreeRows(categories), [categories]);

  const parentOptions = useMemo(() => {
    if (!editing) return categories;
    const blocked = descendantIds(categories, editing.id);
    blocked.add(editing.id);
    return categories.filter((c) => !blocked.has(c.id));
  }, [categories, editing]);

  async function refresh() {
    const data = await apiL<{ categories: AdminCategory[] }>("/api/v1/admin/categories");
    setCategories(data.categories);
  }

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  }

  function openEdit(cat: AdminCategory) {
    setEditing(cat);
    setForm({
      nameBn: cat.nameBn,
      nameEn: cat.nameEn,
      slug: cat.slug,
      parentId: cat.parentId ?? "",
      imageUrl: cat.imageUrl ?? "",
      sortOrder: String(cat.sortOrder),
      isActive: cat.isActive,
      seoTitleBn: cat.seoTitleBn ?? "",
      seoTitleEn: cat.seoTitleEn ?? "",
      seoDescriptionBn: cat.seoDescriptionBn ?? "",
      seoDescriptionEn: cat.seoDescriptionEn ?? "",
    });
    setFormOpen(true);
  }

  async function submitForm() {
    const payload: Record<string, unknown> = {
      nameBn: form.nameBn.trim(),
      nameEn: form.nameEn.trim(),
      parentId: form.parentId === "" ? null : form.parentId,
      imageUrl: form.imageUrl.trim(),
      sortOrder: Number.parseInt(form.sortOrder, 10) || 0,
      isActive: form.isActive,
      // SEO fields are always sent ("" → stored as null by the API),
      // so clearing a field in the form really clears it.
      seoTitleBn: form.seoTitleBn.trim(),
      seoTitleEn: form.seoTitleEn.trim(),
      seoDescriptionBn: form.seoDescriptionBn.trim(),
      seoDescriptionEn: form.seoDescriptionEn.trim(),
    };
    if (form.slug.trim() !== "") payload.slug = form.slug.trim();
    setBusyId(editing?.id ?? "new");
    try {
      if (editing) {
        await apiL(`/api/v1/admin/categories/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        setNotice({ tone: "success", text: s.updated });
      } else {
        await apiL("/api/v1/admin/categories", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setNotice({ tone: "success", text: s.created });
      }
      setFormOpen(false);
      await refresh();
    } catch (e) {
      setNotice({ tone: "error", text: e instanceof Error ? e.message : s.saveFailed });
    } finally {
      setBusyId(null);
    }
  }

  async function toggleActive(cat: AdminCategory) {
    setBusyId(cat.id);
    try {
      await apiL(`/api/v1/admin/categories/${cat.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !cat.isActive }),
      });
      await refresh();
    } catch (e) {
      setNotice({ tone: "error", text: e instanceof Error ? e.message : s.statusFailed });
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setBusyId(deleteTarget.id);
    try {
      await apiL(`/api/v1/admin/categories/${deleteTarget.id}`, { method: "DELETE" });
      setNotice({ tone: "success", text: s.deleted });
      setDeleteTarget(null);
      await refresh();
    } catch (e) {
      // 409 refusals (has products / children) land here with the API's
      // own explanation — show it, keep the row.
      setNotice({ tone: "error", text: e instanceof Error ? e.message : s.deleteFailed });
      setDeleteTarget(null);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      {notice ? (
        <div className="mb-4">
          <Toast tone={notice.tone}>{notice.text}</Toast>
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2.5 text-sm text-text-muted">
          <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-brand-50 text-brand-600">
            <Icon name="grid" size={17} />
          </span>
          {interpolate(s.totalLabel, { count: categories.length })}
        </p>
        <Button variant="gradient" onClick={openCreate} className="max-sm:w-full">
          <Icon name="plus" size={16} /> {s.newCategory}
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card px-6 py-14 text-center shadow-card">
          <span aria-hidden="true" className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand-50 text-brand-500">
            <Icon name="grid" size={28} />
          </span>
          <p className="mt-4 text-sm leading-relaxed text-text-muted">
            {s.empty}
          </p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {rows.map(({ cat, depth }) => (
            <li
              key={cat.id}
              className="relative"
              style={{ marginLeft: Math.min(depth * 26, 52) }}
            >
              {depth > 0 ? (
                <>
                  {/* Indent guides: vertical rail in the gutter + a
                      horizontal tick into the card, so the tree reads
                      at a glance even on a narrow phone screen. */}
                  <span aria-hidden="true" className="absolute -left-3.5 top-0 h-full w-px bg-brand-200/80" />
                  <span aria-hidden="true" className="absolute -left-3.5 top-1/2 h-px w-3.5 bg-brand-200/80" />
                </>
              ) : null}
              <div
                className={`flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-border/70 bg-card px-4 py-3 shadow-card transition motion-fast hover:shadow-lift ${
                  cat.isActive ? "" : "bg-surface-2/50"
                }`}
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  {cat.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={cat.imageUrl} alt="" className="h-11 w-11 shrink-0 rounded-xl object-cover ring-1 ring-border" />
                  ) : (
                    <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-500 ring-1 ring-brand-100">
                      <Icon name="grid" size={19} />
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-text-main">{cat.nameBn}</span>
                    <span className="block truncate text-xs text-text-muted">{cat.nameEn}</span>
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex h-6 items-center rounded-full bg-surface-2 px-2.5 font-mono text-xs text-text-muted ring-1 ring-inset ring-black/5">
                    {cat.slug}
                  </span>
                  <span className="inline-flex h-6 items-center rounded-full bg-surface-2 px-2.5 text-xs text-text-muted ring-1 ring-inset ring-black/5">
                    {interpolate(s.productsCount, { count: cat.productCount })}
                  </span>
                  <span className="inline-flex h-6 items-center rounded-full bg-surface-2 px-2.5 text-xs text-text-muted ring-1 ring-inset ring-black/5">
                    {interpolate(s.sortOrderChip, { n: cat.sortOrder })}
                  </span>
                  {cat.isActive ? (
                    <Badge tone="success" dot>{s.active}</Badge>
                  ) : (
                    <Badge tone="neutral" dot>{s.inactive}</Badge>
                  )}
                </div>
                <div className="flex gap-1.5 max-sm:w-full max-sm:[&>*]:flex-1">
                  <Button size="sm" variant="secondary" loading={busyId === cat.id} onClick={() => toggleActive(cat)}>
                    {cat.isActive ? s.deactivate : s.activate}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => openEdit(cat)}>
                    {s.edit}
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => setDeleteTarget(cat)}>
                    {s.deleteBtn}
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
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
        <div className="grid gap-5">
          <section>
            <p className="section-eyebrow mb-3">{s.basicInfo}</p>
            <div className="grid gap-3">
              <Input
                label={s.nameBn}
                name="nameBn"
                required
                value={form.nameBn}
                onChange={(e) => setForm({ ...form, nameBn: e.target.value })}
                placeholder={s.nameBnPh}
              />
              <Input
                label={s.nameEn}
                name="nameEn"
                required
                value={form.nameEn}
                onChange={(e) => setForm({ ...form, nameEn: e.target.value })}
                placeholder={s.nameEnPh}
              />
              <Input
                label={s.slugLabel}
                name="slug"
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value })}
                placeholder={s.slugPh}
              />
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-text-main">{s.parentLabel}</span>
                <select
                  value={form.parentId}
                  onChange={(e) => setForm({ ...form, parentId: e.target.value })}
                  className="h-11 w-full rounded-md border border-border bg-card px-3 text-sm text-text-main transition motion-fast focus:border-brand-500 focus:outline-none focus:ring-[3px] focus:ring-brand-100"
                >
                  <option value="">{s.parentNone}</option>
                  {parentOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nameBn} ({c.nameEn})
                    </option>
                  ))}
                </select>
              </label>
              <Input
                label={s.imageUrl}
                name="imageUrl"
                value={form.imageUrl}
                onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
                placeholder={s.imagePh}
              />
              <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
                <Input
                  label={s.sortOrderLabel}
                  name="sortOrder"
                  type="number"
                  value={form.sortOrder}
                  onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
                />
                <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5 self-end rounded-md border border-border bg-card px-3 transition motion-fast hover:bg-surface-2">
                  <input
                    type="checkbox"
                    checked={form.isActive}
                    onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                    className="h-5 w-5 shrink-0 accent-brand-600"
                  />
                  <span className="text-sm text-text-main">{s.activeInStore}</span>
                </label>
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-brand-100 bg-brand-50/40 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-text-main">
              <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-100 text-brand-700">
                <Icon name="search" size={14} />
              </span>
              {s.seoHeading}
            </p>
            <p className="mb-3 mt-2 text-xs leading-relaxed text-text-muted">
              {s.seoHelp}
            </p>
            <div className="grid gap-3">
              <Input
                label={s.seoTitleBn}
                name="seoTitleBn"
                maxLength={300}
                value={form.seoTitleBn}
                onChange={(e) => setForm({ ...form, seoTitleBn: e.target.value })}
                placeholder={s.seoTitleBnPh}
              />
              <Input
                label={s.seoTitleEn}
                name="seoTitleEn"
                maxLength={300}
                value={form.seoTitleEn}
                onChange={(e) => setForm({ ...form, seoTitleEn: e.target.value })}
                placeholder={s.seoTitleEnPh}
              />
              <Textarea
                label={s.seoDescBn}
                name="seoDescriptionBn"
                rows={2}
                maxLength={1000}
                value={form.seoDescriptionBn}
                onChange={(e) => setForm({ ...form, seoDescriptionBn: e.target.value })}
                placeholder={s.seoDescBnPh}
              />
              <Textarea
                label={s.seoDescEn}
                name="seoDescriptionEn"
                rows={2}
                maxLength={1000}
                value={form.seoDescriptionEn}
                onChange={(e) => setForm({ ...form, seoDescriptionEn: e.target.value })}
                placeholder={s.seoDescEnPh}
              />
            </div>
          </section>
        </div>
      </Drawer>

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={s.deleteTitle}
        onConfirm={confirmDelete}
      >
        <div className="flex gap-3">
          <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-600 ring-1 ring-inset ring-rose-100">
            <Icon name="alert" size={20} />
          </span>
          <p className="text-sm leading-relaxed text-text-muted">
            {interpolate(s.deleteBody, { name: deleteTarget?.nameBn ?? "" })}
          </p>
        </div>
      </Modal>
    </div>
  );
}
