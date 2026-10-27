"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { Toast } from "@/components/ui/toast";
import type { AdminBrand } from "@/catalog/taxonomy-admin";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { BRANDS_STRINGS } from "./strings";

// Brands manager (Wave P2a) — list + create/edit modal + guarded
// delete against the real /api/v1/admin/brands API. A brand that
// still has products cannot be deleted (API answers 409 with the
// reason, shown verbatim). Wave 13: the form also carries the brand
// description (Brand.description). Brand still has no isActive
// column, so there is no active toggle here.

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

interface BrandForm {
  name: string;
  slug: string;
  logoUrl: string;
  description: string;
}

const EMPTY_FORM: BrandForm = { name: "", slug: "", logoUrl: "", description: "" };

export function BrandsManager({ initial }: { initial: AdminBrand[] }) {
  const { locale, t: common } = useLocale();
  const s = pick(locale, BRANDS_STRINGS);
  const apiL = <T,>(url: string, init?: RequestInit): Promise<T> =>
    api<T>(url, init, (status) => interpolate(s.requestFailed, { status }));
  const [brands, setBrands] = useState<AdminBrand[]>(initial);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AdminBrand | null>(null);
  const [form, setForm] = useState<BrandForm>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<AdminBrand | null>(null);

  async function refresh() {
    const data = await apiL<{ brands: AdminBrand[] }>("/api/v1/admin/brands");
    setBrands(data.brands);
  }

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  }

  function openEdit(brand: AdminBrand) {
    setEditing(brand);
    setForm({
      name: brand.name,
      slug: brand.slug,
      logoUrl: brand.logoUrl ?? "",
      description: brand.description ?? "",
    });
    setFormOpen(true);
  }

  async function submitForm() {
    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      logoUrl: form.logoUrl.trim(),
      // Always sent ("" → stored as null by the API) so clearing the
      // field in the form really clears the description.
      description: form.description.trim(),
    };
    if (form.slug.trim() !== "") payload.slug = form.slug.trim();
    try {
      if (editing) {
        await apiL(`/api/v1/admin/brands/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        setNotice({ tone: "success", text: s.updated });
      } else {
        await apiL("/api/v1/admin/brands", {
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
      await apiL(`/api/v1/admin/brands/${deleteTarget.id}`, { method: "DELETE" });
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

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2.5 text-sm text-text-muted">
          <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-brand-50 text-brand-600">
            <Icon name="tag" size={17} />
          </span>
          {interpolate(s.totalLabel, { count: brands.length })}
        </p>
        <Button variant="gradient" onClick={openCreate} className="max-sm:w-full">
          <Icon name="plus" size={16} /> {s.newBrand}
        </Button>
      </div>

      {brands.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card px-6 py-14 text-center shadow-card">
          <span aria-hidden="true" className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand-50 text-brand-500">
            <Icon name="tag" size={28} />
          </span>
          <p className="mt-4 text-sm leading-relaxed text-text-muted">
            {s.empty}
          </p>
        </div>
      ) : (
        <>
          {/* Desktop / tablet: v2 table */}
          <div className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-card max-md:hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-2/80 text-left">
                  <th className="px-4 py-3 text-xs font-semibold text-text-muted">{s.colBrand}</th>
                  <th className="px-4 py-3 text-xs font-semibold text-text-muted">{s.colSlug}</th>
                  <th className="px-4 py-3 text-xs font-semibold text-text-muted">{s.colProducts}</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-text-muted">{s.colActions}</th>
                </tr>
              </thead>
              <tbody>
                {brands.map((brand) => (
                  <tr key={brand.id} className="border-t border-border/60 transition motion-fast first:border-t-0 hover:bg-brand-50/50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {brand.logoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={brand.logoUrl} alt="" className="h-11 w-11 rounded-xl bg-surface-2 object-contain ring-1 ring-border" />
                        ) : (
                          <span aria-hidden="true" className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-500 ring-1 ring-brand-100">
                            <Icon name="tag" size={19} />
                          </span>
                        )}
                        <span className="min-w-0">
                          <span className="block font-medium text-text-main">{brand.name}</span>
                          {brand.description ? (
                            <span className="block max-w-md truncate text-xs text-text-muted">{brand.description}</span>
                          ) : null}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-text-muted">{brand.slug}</td>
                    <td className="px-4 py-3">{interpolate(s.productsCount, { count: brand.productCount })}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" variant="secondary" onClick={() => openEdit(brand)}>
                          {s.edit}
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => setDeleteTarget(brand)}>
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
            {brands.map((brand) => (
              <li key={brand.id} className="rounded-lg border border-border/70 bg-card p-4 shadow-card">
                <div className="flex items-center gap-3">
                  {brand.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={brand.logoUrl} alt="" className="h-11 w-11 shrink-0 rounded-xl bg-surface-2 object-contain ring-1 ring-border" />
                  ) : (
                    <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-500 ring-1 ring-brand-100">
                      <Icon name="tag" size={19} />
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-text-main">{brand.name}</span>
                    <span className="block truncate font-mono text-xs text-text-muted">{brand.slug}</span>
                  </span>
                  <span className="ml-auto inline-flex h-6 shrink-0 items-center rounded-full bg-surface-2 px-2.5 text-xs text-text-muted ring-1 ring-inset ring-black/5">
                    {interpolate(s.productsCountFull, { count: brand.productCount })}
                  </span>
                </div>
                {brand.description ? (
                  <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-text-muted">{brand.description}</p>
                ) : null}
                <div className="mt-3 flex gap-1.5 [&>*]:flex-1">
                  <Button size="sm" variant="secondary" onClick={() => openEdit(brand)}>
                    {s.edit}
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => setDeleteTarget(brand)}>
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
            label={s.nameLabel}
            name="name"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder={s.namePh}
          />
          <Input
            label={s.slugLabel}
            name="slug"
            value={form.slug}
            onChange={(e) => setForm({ ...form, slug: e.target.value })}
            placeholder={s.slugPh}
          />
          <Input
            label={s.logoUrl}
            name="logoUrl"
            value={form.logoUrl}
            onChange={(e) => setForm({ ...form, logoUrl: e.target.value })}
            placeholder={s.logoPh}
          />
          {form.logoUrl.trim() !== "" ? (
            <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={form.logoUrl.trim()} alt={s.logoPreviewAlt} className="h-11 w-11 rounded-lg bg-card object-contain ring-1 ring-border" />
              <span className="text-xs text-text-muted">{s.logoPreview}</span>
            </div>
          ) : null}
          <Textarea
            label={s.descLabel}
            name="description"
            rows={3}
            maxLength={2000}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder={s.descPh}
            helper={s.descHelper}
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
          <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-rose-50 text-rose-600 ring-1 ring-inset ring-rose-100">
            <Icon name="alert" size={20} />
          </span>
          <p className="text-sm leading-relaxed text-text-muted">
            {interpolate(s.deleteBody, { name: deleteTarget?.name ?? "" })}
          </p>
        </div>
      </Modal>
    </div>
  );
}
