"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { Toast } from "@/components/ui/toast";
import type { AdminCategory } from "@/catalog/taxonomy-admin";

// Categories manager (Wave P2a) — tree list + create/edit modal +
// active toggle + guarded delete, all against the real
// /api/v1/admin/categories API. Delete refusals (category still has
// products / sub-categories) come back from the API as 409 and are
// shown verbatim — the row is never optimistically removed.

interface ApiErrorBody {
  error?: { code?: string; message?: string };
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as ApiErrorBody & { data?: T };
  if (!res.ok) {
    throw new Error(body.error?.message ?? `অনুরোধ ব্যর্থ হয়েছে (${res.status})`);
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
    const data = await api<{ categories: AdminCategory[] }>("/api/v1/admin/categories");
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
        await api(`/api/v1/admin/categories/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        setNotice({ tone: "success", text: "ক্যাটাগরি আপডেট হয়েছে।" });
      } else {
        await api("/api/v1/admin/categories", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setNotice({ tone: "success", text: "নতুন ক্যাটাগরি তৈরি হয়েছে।" });
      }
      setFormOpen(false);
      await refresh();
    } catch (e) {
      setNotice({ tone: "error", text: e instanceof Error ? e.message : "সংরক্ষণ ব্যর্থ হয়েছে।" });
    } finally {
      setBusyId(null);
    }
  }

  async function toggleActive(cat: AdminCategory) {
    setBusyId(cat.id);
    try {
      await api(`/api/v1/admin/categories/${cat.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !cat.isActive }),
      });
      await refresh();
    } catch (e) {
      setNotice({ tone: "error", text: e instanceof Error ? e.message : "স্ট্যাটাস বদলানো যায়নি।" });
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setBusyId(deleteTarget.id);
    try {
      await api(`/api/v1/admin/categories/${deleteTarget.id}`, { method: "DELETE" });
      setNotice({ tone: "success", text: "ক্যাটাগরি মুছে ফেলা হয়েছে।" });
      setDeleteTarget(null);
      await refresh();
    } catch (e) {
      // 409 refusals (has products / children) land here with the API's
      // own explanation — show it, keep the row.
      setNotice({ tone: "error", text: e instanceof Error ? e.message : "মুছে ফেলা যায়নি।" });
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

      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-text-muted">
          মোট {categories.length}টি ক্যাটাগরি — গাছের মতো সাজানো (সাব-ক্যাটাগরি ভেতরে ঢোকানো)।
        </p>
        <Button onClick={openCreate}>+ নতুন ক্যাটাগরি</Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2 text-left text-xs uppercase tracking-wide text-text-muted">
              <th className="px-4 py-3 font-medium">ক্যাটাগরি</th>
              <th className="px-4 py-3 font-medium">স্লাগ</th>
              <th className="px-4 py-3 font-medium">পণ্য</th>
              <th className="px-4 py-3 font-medium">ক্রম</th>
              <th className="px-4 py-3 font-medium">অবস্থা</th>
              <th className="px-4 py-3 text-right font-medium">কাজ</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-text-muted">
                  এখনো কোনো ক্যাটাগরি নেই — প্রথমটি তৈরি করুন।
                </td>
              </tr>
            ) : (
              rows.map(({ cat, depth }) => (
                <tr key={cat.id} className="border-b border-border/60 last:border-0 hover:bg-surface-2/60">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3" style={{ paddingLeft: depth * 22 }}>
                      {depth > 0 ? <span aria-hidden="true" className="text-text-muted">↳</span> : null}
                      {cat.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={cat.imageUrl} alt="" className="h-9 w-9 rounded-md object-cover ring-1 ring-border" />
                      ) : (
                        <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-md bg-surface-2 text-base ring-1 ring-border">🗂️</span>
                      )}
                      <span>
                        <span className="block font-medium text-text-main">{cat.nameBn}</span>
                        <span className="block text-xs text-text-muted">{cat.nameEn}</span>
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-text-muted">{cat.slug}</td>
                  <td className="px-4 py-3">{cat.productCount}টি</td>
                  <td className="px-4 py-3">{cat.sortOrder}</td>
                  <td className="px-4 py-3">
                    {cat.isActive ? (
                      <Badge tone="success" dot>সক্রিয়</Badge>
                    ) : (
                      <Badge tone="neutral" dot>বন্ধ</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1.5">
                      <Button size="sm" variant="secondary" loading={busyId === cat.id} onClick={() => toggleActive(cat)}>
                        {cat.isActive ? "বন্ধ করুন" : "চালু করুন"}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => openEdit(cat)}>
                        এডিট
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => setDeleteTarget(cat)}>
                        মুছুন
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? "ক্যাটাগরি এডিট" : "নতুন ক্যাটাগরি"}
        onConfirm={submitForm}
      >
        <div className="grid gap-3">
          <Input
            label="নাম (বাংলা)"
            name="nameBn"
            required
            value={form.nameBn}
            onChange={(e) => setForm({ ...form, nameBn: e.target.value })}
            placeholder="যেমন: পোশাক"
          />
          <Input
            label="নাম (English)"
            name="nameEn"
            required
            value={form.nameEn}
            onChange={(e) => setForm({ ...form, nameEn: e.target.value })}
            placeholder="e.g. Fashion"
          />
          <Input
            label="স্লাগ (খালি রাখলে English নাম থেকে তৈরি হবে)"
            name="slug"
            value={form.slug}
            onChange={(e) => setForm({ ...form, slug: e.target.value })}
            placeholder="fashion"
          />
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-text-main">মূল ক্যাটাগরি (প্যারেন্ট)</span>
            <select
              value={form.parentId}
              onChange={(e) => setForm({ ...form, parentId: e.target.value })}
              className="h-11 w-full rounded-md border border-border bg-card px-3 text-sm text-text-main focus:border-brand-500 focus:outline-none"
            >
              <option value="">— মূল ক্যাটাগরি (কোনো প্যারেন্ট নেই) —</option>
              {parentOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nameBn} ({c.nameEn})
                </option>
              ))}
            </select>
          </label>
          <Input
            label="ছবির URL"
            name="imageUrl"
            value={form.imageUrl}
            onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
            placeholder="https://…"
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="ক্রম (sort order)"
              name="sortOrder"
              type="number"
              value={form.sortOrder}
              onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
            />
            <label className="flex items-end gap-2 pb-2">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                className="h-4 w-4 accent-brand-600"
              />
              <span className="text-sm text-text-main">স্টোরে সক্রিয়</span>
            </label>
          </div>

          <div className="border-t border-border pt-4">
            <p className="text-sm font-semibold text-text-main">SEO — সার্চ ইঞ্জিনের জন্য</p>
            <p className="mb-3 mt-0.5 text-xs leading-relaxed text-text-muted">
              এই ক্যাটাগরির পেজ (/shop?category=…) গুগলে যেভাবে দেখাবে। খালি রাখলে
              ক্যাটাগরির নাম থেকেই টাইটেল তৈরি হবে।
            </p>
            <div className="grid gap-3">
              <Input
                label="SEO টাইটেল (বাংলা)"
                name="seoTitleBn"
                maxLength={300}
                value={form.seoTitleBn}
                onChange={(e) => setForm({ ...form, seoTitleBn: e.target.value })}
                placeholder="যেমন: সেরা পোশাক কালেকশন"
              />
              <Input
                label="SEO Title (English)"
                name="seoTitleEn"
                maxLength={300}
                value={form.seoTitleEn}
                onChange={(e) => setForm({ ...form, seoTitleEn: e.target.value })}
                placeholder="e.g. Best Fashion Collection"
              />
              <Textarea
                label="SEO বর্ণনা (বাংলা)"
                name="seoDescriptionBn"
                rows={2}
                maxLength={1000}
                value={form.seoDescriptionBn}
                onChange={(e) => setForm({ ...form, seoDescriptionBn: e.target.value })}
                placeholder="সার্চ রেজাল্টে টাইটেলের নিচে দেখানো এক-দুই লাইনের বর্ণনা"
              />
              <Textarea
                label="SEO Description (English)"
                name="seoDescriptionEn"
                rows={2}
                maxLength={1000}
                value={form.seoDescriptionEn}
                onChange={(e) => setForm({ ...form, seoDescriptionEn: e.target.value })}
                placeholder="One or two lines shown under the title in search results"
              />
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="ক্যাটাগরি মুছে ফেলবেন?"
        onConfirm={confirmDelete}
      >
        <p className="text-sm leading-relaxed text-text-muted">
          “{deleteTarget?.nameBn}” মুছে ফেলা হবে। এতে পণ্য থাকলে বা সাব-ক্যাটাগরি থাকলে
          মুছতে দেওয়া হবে না — সেক্ষেত্রে আগে পণ্য সরান, অথবা ক্যাটাগরিটি শুধু বন্ধ
          (inactive) করে রাখুন।
        </p>
      </Modal>
    </div>
  );
}
