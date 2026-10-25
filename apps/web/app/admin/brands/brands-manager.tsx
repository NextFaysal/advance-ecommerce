"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Toast } from "@/components/ui/toast";
import type { AdminBrand } from "@/catalog/taxonomy-admin";

// Brands manager (Wave P2a) — list + create/edit modal + guarded
// delete against the real /api/v1/admin/brands API. A brand that
// still has products cannot be deleted (API answers 409 with the
// reason, shown verbatim). The Brand model has no description /
// isActive column, so the form carries name/slug/logo only.

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

interface BrandForm {
  name: string;
  slug: string;
  logoUrl: string;
}

const EMPTY_FORM: BrandForm = { name: "", slug: "", logoUrl: "" };

export function BrandsManager({ initial }: { initial: AdminBrand[] }) {
  const [brands, setBrands] = useState<AdminBrand[]>(initial);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AdminBrand | null>(null);
  const [form, setForm] = useState<BrandForm>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<AdminBrand | null>(null);

  async function refresh() {
    const data = await api<{ brands: AdminBrand[] }>("/api/v1/admin/brands");
    setBrands(data.brands);
  }

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  }

  function openEdit(brand: AdminBrand) {
    setEditing(brand);
    setForm({ name: brand.name, slug: brand.slug, logoUrl: brand.logoUrl ?? "" });
    setFormOpen(true);
  }

  async function submitForm() {
    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      logoUrl: form.logoUrl.trim(),
    };
    if (form.slug.trim() !== "") payload.slug = form.slug.trim();
    try {
      if (editing) {
        await api(`/api/v1/admin/brands/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        setNotice({ tone: "success", text: "ব্র্যান্ড আপডেট হয়েছে।" });
      } else {
        await api("/api/v1/admin/brands", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setNotice({ tone: "success", text: "নতুন ব্র্যান্ড তৈরি হয়েছে।" });
      }
      setFormOpen(false);
      await refresh();
    } catch (e) {
      setNotice({ tone: "error", text: e instanceof Error ? e.message : "সংরক্ষণ ব্যর্থ হয়েছে।" });
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    try {
      await api(`/api/v1/admin/brands/${deleteTarget.id}`, { method: "DELETE" });
      setNotice({ tone: "success", text: "ব্র্যান্ড মুছে ফেলা হয়েছে।" });
      setDeleteTarget(null);
      await refresh();
    } catch (e) {
      setNotice({ tone: "error", text: e instanceof Error ? e.message : "মুছে ফেলা যায়নি।" });
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

      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-text-muted">মোট {brands.length}টি ব্র্যান্ড।</p>
        <Button onClick={openCreate}>+ নতুন ব্র্যান্ড</Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2 text-left text-xs uppercase tracking-wide text-text-muted">
              <th className="px-4 py-3 font-medium">ব্র্যান্ড</th>
              <th className="px-4 py-3 font-medium">স্লাগ</th>
              <th className="px-4 py-3 font-medium">পণ্য</th>
              <th className="px-4 py-3 text-right font-medium">কাজ</th>
            </tr>
          </thead>
          <tbody>
            {brands.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-text-muted">
                  এখনো কোনো ব্র্যান্ড নেই — প্রথমটি তৈরি করুন।
                </td>
              </tr>
            ) : (
              brands.map((brand) => (
                <tr key={brand.id} className="border-b border-border/60 last:border-0 hover:bg-surface-2/60">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {brand.logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={brand.logoUrl} alt="" className="h-9 w-9 rounded-md object-contain ring-1 ring-border" />
                      ) : (
                        <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-md bg-surface-2 text-base ring-1 ring-border">🏷️</span>
                      )}
                      <span className="font-medium text-text-main">{brand.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-text-muted">{brand.slug}</td>
                  <td className="px-4 py-3">{brand.productCount}টি</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1.5">
                      <Button size="sm" variant="secondary" onClick={() => openEdit(brand)}>
                        এডিট
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => setDeleteTarget(brand)}>
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
        title={editing ? "ব্র্যান্ড এডিট" : "নতুন ব্র্যান্ড"}
        onConfirm={submitForm}
      >
        <div className="grid gap-3">
          <Input
            label="ব্র্যান্ডের নাম"
            name="name"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. Walton"
          />
          <Input
            label="স্লাগ (খালি রাখলে নাম থেকে তৈরি হবে)"
            name="slug"
            value={form.slug}
            onChange={(e) => setForm({ ...form, slug: e.target.value })}
            placeholder="walton"
          />
          <Input
            label="লোগোর URL"
            name="logoUrl"
            value={form.logoUrl}
            onChange={(e) => setForm({ ...form, logoUrl: e.target.value })}
            placeholder="https://…"
          />
          {form.logoUrl.trim() !== "" ? (
            <div className="flex items-center gap-3 rounded-md bg-surface-2 px-3 py-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={form.logoUrl.trim()} alt="লোগো প্রিভিউ" className="h-10 w-10 rounded object-contain" />
              <span className="text-xs text-text-muted">লোগো প্রিভিউ</span>
            </div>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="ব্র্যান্ড মুছে ফেলবেন?"
        onConfirm={confirmDelete}
      >
        <p className="text-sm leading-relaxed text-text-muted">
          “{deleteTarget?.name}” মুছে ফেলা হবে। এই ব্র্যান্ডে পণ্য থাকলে মুছতে দেওয়া
          হবে না — আগে সেই পণ্যগুলো অন্য ব্র্যান্ডে নিন।
        </p>
      </Modal>
    </div>
  );
}
