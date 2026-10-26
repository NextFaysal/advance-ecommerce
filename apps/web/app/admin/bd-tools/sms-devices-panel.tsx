"use client";

/**
 * BD Tools — ডিভাইস টোকেন panel (wave 58 server companion).
 *
 * Provisions per-device tokens for the Android SMS forwarder app
 * (apps/android-sms-forwarder/): instead of holding a staff session
 * (7-day expiry, unusable with TOTP accounts), each forwarder phone
 * gets its OWN revocable token, sent as
 * `Authorization: Bearer ae_dev_…` to POST /api/v1/admin/bd/sms-ingest.
 *
 * SECRETS: the server stores only a SHA-256 hash (src/bd/devices.ts).
 * The plaintext token is returned ONCE by the create API and lives
 * in this panel's state only until dismissed — it is never written
 * to storage, never re-fetched, and the list API cannot return it.
 * Token hashes never reach the browser either: rows come from the
 * hash-free SmsDeviceView.
 */
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface DeviceView {
  id: string;
  label: string;
  createdAt: string;
  createdById: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
  status: "active" | "revoked";
}

function fmtDhaka(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("bn-BD", {
    timeZone: "Asia/Dhaka",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

export function SmsDevicesPanel() {
  const [devices, setDevices] = useState<DeviceView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [createReason, setCreateReason] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  /** The one-time plaintext token — component state only, cleared on dismiss. */
  const [freshToken, setFreshToken] = useState<{ label: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokeReason, setRevokeReason] = useState<Record<string, string>>({});
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/admin/bd/devices", { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setLoadError(json?.error?.message ?? `ডিভাইস তালিকা লোড হয়নি (HTTP ${res.status})`);
        return;
      }
      setDevices(json.data.devices as DeviceView[]);
      setLoadError(null);
    } catch {
      setLoadError("ডিভাইস তালিকা লোড হয়নি (নেটওয়ার্ক ত্রুটি)।");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setCreateError(null);
    if (!label.trim()) return setCreateError("ডিভাইসের নাম (লেবেল) দিন।");
    if (!createReason.trim()) return setCreateError("কারণ লিখুন — টোকেন তৈরি অডিটে থাকে।");
    setCreating(true);
    try {
      const res = await fetch("/api/v1/admin/bd/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim(), reason: createReason.trim() }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setCreateError(json?.error?.message ?? `তৈরি হয়নি (HTTP ${res.status})`);
        return;
      }
      setFreshToken({ label: json.data.device.label as string, token: json.data.token as string });
      setCopied(false);
      setLabel("");
      setCreateReason("");
      await load();
    } catch {
      setCreateError("তৈরি হয়নি (নেটওয়ার্ক ত্রুটি)।");
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (device: DeviceView) => {
    setRevokeError(null);
    const reason = (revokeReason[device.id] ?? "").trim();
    if (!reason) return setRevokeError("বাতিলের কারণ লিখুন — অডিটে থাকে।");
    try {
      const res = await fetch(`/api/v1/admin/bd/devices/${device.id}/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setRevokeError(json?.error?.message ?? `বাতিল হয়নি (HTTP ${res.status})`);
        return;
      }
      setConfirmingId(null);
      await load();
    } catch {
      setRevokeError("বাতিল হয়নি (নেটওয়ার্ক ত্রুটি)।");
    }
  };

  return (
    <div className="space-y-5">
      <p className="text-sm text-text-muted">
        SMS ফরওয়ার্ডার ফোনের জন্য আলাদা ডিভাইস টোকেন — স্টাফ সেশন নয়। ফোনটি ইনজেস্ট API-তে{" "}
        <span className="font-mono text-xs">Authorization: Bearer ae_dev_…</span> পাঠায়; সেশন মেয়াদ
        (৭ দিন) বা TOTP-র ঝামেলা নেই। সার্ভারে শুধু টোকেনের SHA-256 হ্যাশ থাকে; কোনো ডিভাইস
        হারালে/বদলালে এখান থেকেই বাতিল করুন — বাতিল পরের অনুরোধ থেকেই কার্যকর। সর্বোচ্চ ২০টি
        সক্রিয় ডিভাইস।
      </p>

      {freshToken ? (
        <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">
            “{freshToken.label}” ডিভাইসের টোকেন — শুধু এই একবারই দেখা যাচ্ছে
          </p>
          <p className="mt-1 text-sm text-amber-800">
            টোকেনটি এখনই কপি করে ফরওয়ার্ডার ফোনে বসান। এই বাক্স বন্ধ করলে টোকেনটি আর কোনোদিন
            দেখা যাবে না — সার্ভারে শুধু এর হ্যাশ আছে, নতুন করে তৈরি করা ছাড়া উপায় নেই।
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="break-all rounded-md bg-white px-3 py-2 font-mono text-sm text-amber-950 ring-1 ring-amber-200">
              {freshToken.token}
            </code>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                void navigator.clipboard?.writeText(freshToken.token);
                setCopied(true);
              }}
            >
              {copied ? "✓ কপি হয়েছে" : "কপি করুন"}
            </Button>
            <Button type="button" onClick={() => setFreshToken(null)}>
              সংরক্ষণ করেছি — বন্ধ করুন
            </Button>
          </div>
        </div>
      ) : null}

      <div className="rounded-lg border border-border bg-surface-2 p-4">
        <h3 className="text-sm font-semibold">নতুন ডিভাইস টোকেন</h3>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="block min-w-52 flex-1">
            <span className="mb-1 block text-xs font-medium text-text-muted">ডিভাইসের নাম *</span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={80}
              className="h-10 w-full rounded-[10px] border border-border bg-card px-3 text-sm outline-none focus:border-brand-500 focus:ring-[3px] focus:ring-brand-100"
              placeholder="যেমন: দোকানের bKash ফোন"
            />
          </label>
          <label className="block min-w-52 flex-1">
            <span className="mb-1 block text-xs font-medium text-text-muted">কারণ *</span>
            <input
              value={createReason}
              onChange={(e) => setCreateReason(e.target.value)}
              className="h-10 w-full rounded-[10px] border border-border bg-card px-3 text-sm outline-none focus:border-brand-500 focus:ring-[3px] focus:ring-brand-100"
              placeholder="কেন এই ডিভাইসটি যোগ হচ্ছে"
            />
          </label>
          <Button type="button" onClick={create} disabled={creating}>
            {creating ? "তৈরি হচ্ছে…" : "টোকেন তৈরি করুন"}
          </Button>
        </div>
        {createError ? (
          <p role="alert" className="mt-2 text-sm text-rose-700">{createError}</p>
        ) : null}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">ডিভাইসসমূহ</h3>
        {loadError ? (
          <p role="alert" className="text-sm text-rose-700">{loadError}</p>
        ) : devices === null ? (
          <p className="text-sm text-text-muted">লোড হচ্ছে…</p>
        ) : devices.length === 0 ? (
          <p className="text-sm text-text-muted">
            এখনো কোনো ডিভাইস টোকেন নেই — ফরওয়ার্ডার ফোন এখন স্টাফ সেশন দিয়েই চলছে (লেগ্যাসি পথ)।
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {devices.map((device) => (
              <li key={device.id} className="space-y-2 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {device.label}
                    {device.status === "active" ? (
                      <Badge tone="success">সক্রিয়</Badge>
                    ) : (
                      <Badge tone="danger">বাতিল</Badge>
                    )}
                  </span>
                  <span className="font-mono text-xs text-text-muted">{device.id}</span>
                </div>
                <p className="text-xs text-text-muted">
                  তৈরি: {fmtDhaka(device.createdAt)} · সর্বশেষ দেখা:{" "}
                  {device.lastSeenAt ? fmtDhaka(device.lastSeenAt) : "এখনো কোনো SMS পাঠায়নি"}
                  {device.revokedAt ? ` · বাতিল: ${fmtDhaka(device.revokedAt)}` : ""}
                </p>
                {device.status === "active" ? (
                  confirmingId === device.id ? (
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="block min-w-52 flex-1">
                        <span className="mb-1 block text-xs font-medium text-text-muted">বাতিলের কারণ *</span>
                        <input
                          value={revokeReason[device.id] ?? ""}
                          onChange={(e) =>
                            setRevokeReason((prev) => ({ ...prev, [device.id]: e.target.value }))
                          }
                          className="h-10 w-full rounded-[10px] border border-border bg-card px-3 text-sm outline-none focus:border-brand-500 focus:ring-[3px] focus:ring-brand-100"
                          placeholder="যেমন: ফোন বদল হয়েছে"
                        />
                      </label>
                      <Button type="button" variant="destructive" onClick={() => void revoke(device)}>
                        নিশ্চিত — টোকেন বাতিল করুন
                      </Button>
                      <Button type="button" variant="ghost" onClick={() => setConfirmingId(null)}>
                        ফিরে যান
                      </Button>
                    </div>
                  ) : (
                    <Button type="button" variant="secondary" onClick={() => setConfirmingId(device.id)}>
                      টোকেন বাতিল করুন
                    </Button>
                  )
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {revokeError ? (
          <p role="alert" className="mt-2 text-sm text-rose-700">{revokeError}</p>
        ) : null}
      </div>
    </div>
  );
}
