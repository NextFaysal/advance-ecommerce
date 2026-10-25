"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { Toast } from "@/components/ui/toast";
import type { AdminAttributeSet } from "@/catalog/attributes-admin";

// Attribute sets manager (Wave 13-2) — list + create/edit modal +
// delete against the real /api/v1/admin/attributes API. This manages
// the reusable set LIBRARY only (ProductAttribute rows); values are
// edited one per line. A duplicate key comes back as 409 and is
// shown verbatim.

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
  const [sets, setSets] = useState<AdminAttributeSet[]>(initial);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AdminAttributeSet | null>(null);
  const [form, setForm] = useState<AttributeForm>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<AdminAttributeSet | null>(null);

  async function refresh() {
    const data = await api<{ attributes: AdminAttributeSet[] }>("/api/v1/admin/attributes");
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
        await api(`/api/v1/admin/attributes/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        setNotice({ tone: "success", text: "অ্যাট্রিবিউট সেট আপডেট হয়েছে।" });
      } else {
        await api("/api/v1/admin/attributes", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setNotice({ tone: "success", text: "নতুন অ্যাট্রিবিউট সেট তৈরি হয়েছে।" });
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
      await api(`/api/v1/admin/attributes/${deleteTarget.id}`, { method: "DELETE" });
      setNotice({ tone: "success", text: "অ্যাট্রিবিউট সেট মুছে ফেলা হয়েছে।" });
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

      <p className="mb-4 rounded-md bg-surface-2 px-3.5 py-2.5 text-sm leading-relaxed text-text-muted">
        এই পেজে শুধু অ্যাট্রিবিউট সেটের লাইব্রেরি পরিচালনা হয় — পণ্য এডিটরে এই সেট
        ব্যবহারের সংযোগ পরের ধাপে আসছে; এখন পণ্যে অ্যাট্রিবিউট আগের মতোই লিখে দিতে হয়।
      </p>

      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-text-muted">মোট {sets.length}টি অ্যাট্রিবিউট সেট।</p>
        <Button onClick={openCreate}>+ নতুন সেট</Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2 text-left text-xs uppercase tracking-wide text-text-muted">
              <th className="px-4 py-3 font-medium">অ্যাট্রিবিউট</th>
              <th className="px-4 py-3 font-medium">কী (key)</th>
              <th className="px-4 py-3 font-medium">মানসমূহ</th>
              <th className="px-4 py-3 text-right font-medium">কাজ</th>
            </tr>
          </thead>
          <tbody>
            {sets.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-text-muted">
                  এখনো কোনো অ্যাট্রিবিউট সেট নেই — যেমন Size (S/M/L) বা Color দিয়ে প্রথমটি তৈরি করুন।
                </td>
              </tr>
            ) : (
              sets.map((set) => (
                <tr key={set.id} className="border-b border-border/60 last:border-0 hover:bg-surface-2/60">
                  <td className="px-4 py-3">
                    <span className="block font-medium text-text-main">{set.labelBn}</span>
                    <span className="block text-xs text-text-muted">{set.labelEn}</span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-text-muted">{set.key}</td>
                  <td className="px-4 py-3">
                    <span className="flex max-w-md flex-wrap gap-1">
                      {set.values.map((v) => (
                        <span key={v} className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-text-main ring-1 ring-border">
                          {v}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1.5">
                      <Button size="sm" variant="secondary" onClick={() => openEdit(set)}>
                        এডিট
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => setDeleteTarget(set)}>
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
        title={editing ? "অ্যাট্রিবিউট সেট এডিট" : "নতুন অ্যাট্রিবিউট সেট"}
        onConfirm={submitForm}
      >
        <div className="grid gap-3">
          <Input
            label="কী (key)"
            name="key"
            required
            value={form.key}
            onChange={(e) => setForm({ ...form, key: e.target.value })}
            placeholder="size"
            helper="ছোট হাতের ইংরেজি অক্ষর, সংখ্যা, হাইফেন — যেমন: size, color, shoe-size। প্রতিটি সেটের কী আলাদা হতে হবে।"
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="লেবেল (বাংলা)"
              name="labelBn"
              required
              value={form.labelBn}
              onChange={(e) => setForm({ ...form, labelBn: e.target.value })}
              placeholder="সাইজ"
            />
            <Input
              label="Label (English)"
              name="labelEn"
              required
              value={form.labelEn}
              onChange={(e) => setForm({ ...form, labelEn: e.target.value })}
              placeholder="Size"
            />
          </div>
          <Textarea
            label="মানসমূহ (প্রতি লাইনে একটি)"
            name="values"
            required
            rows={5}
            value={form.valuesText}
            onChange={(e) => setForm({ ...form, valuesText: e.target.value })}
            placeholder={"S\nM\nL\nXL"}
            helper="কমপক্ষে একটি মান দরকার। একই মান দুবার লিখলে একবারই থাকবে।"
          />
        </div>
      </Modal>

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="অ্যাট্রিবিউট সেট মুছে ফেলবেন?"
        onConfirm={confirmDelete}
      >
        <p className="text-sm leading-relaxed text-text-muted">
          “{deleteTarget?.labelBn}” সেটটি লাইব্রেরি থেকে পুরোপুরি মুছে যাবে। ইতিমধ্যে
          তৈরি পণ্যের অ্যাট্রিবিউটে কোনো প্রভাব পড়বে না — পণ্যের মান পণ্যের ভেতরেই
          সংরক্ষিত থাকে।
        </p>
      </Modal>
    </div>
  );
}
