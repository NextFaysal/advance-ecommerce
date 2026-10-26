"use client";

/**
 * Staff passkeys card — /admin/security (doc 23 wave 55).
 *
 * Self-fetching: lists the signed-in staff member's own passkeys
 * from GET /api/v1/admin/auth/passkey/credentials. Registration runs
 * the WebAuthn ceremony in the browser (@simplewebauthn/browser):
 * options from the server, create() on the authenticator, verify on
 * the server — the card never sees or stores any secret (a passkey
 * has none to show). Delete is a two-step inline confirm, mirroring
 * the sessions card. Browsers without WebAuthn get an honest note
 * instead of a dead button.
 */
import { useCallback, useEffect, useState } from "react";
import {
  browserSupportsWebAuthn,
  startRegistration,
} from "@simplewebauthn/browser";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface PasskeyRow {
  id: string;
  deviceLabel: string;
  createdAt: string;
  lastUsedAt: string | null;
}

interface ListResponse {
  data?: { passkeys: PasskeyRow[] };
  error?: { message?: string };
}

function absoluteBn(iso: string): string {
  return new Date(iso).toLocaleString("bn-BD", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function PasskeyCard() {
  const [rows, setRows] = useState<PasskeyRow[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const [deviceLabel, setDeviceLabel] = useState("");
  const [registering, setRegistering] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);

  useEffect(() => {
    setSupported(browserSupportsWebAuthn());
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/admin/auth/passkey/credentials");
      const json = (await res.json().catch(() => ({}))) as ListResponse;
      if (!res.ok) {
        setError(json.error?.message ?? "পাসকি তালিকা লোড করা যায়নি।");
        return;
      }
      setError("");
      setRows(json.data?.passkeys ?? []);
    } catch {
      setError("সার্ভারে পৌঁছানো যাচ্ছে না — নেটওয়ার্ক দেখে আবার চেষ্টা করুন।");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleRegister() {
    const label = deviceLabel.trim();
    if (label === "") {
      setActionError("আগে ডিভাইসের একটা নাম দিন (যেমন: আমার ফোন)।");
      return;
    }
    setRegistering(true);
    setActionError("");
    setNotice("");
    try {
      const optionsRes = await fetch("/api/v1/admin/auth/passkey/register/options", {
        method: "POST",
      });
      const optionsJson = (await optionsRes.json().catch(() => ({}))) as {
        data?: { options: Parameters<typeof startRegistration>[0]["optionsJSON"] };
        error?: { message?: string };
      };
      if (!optionsRes.ok || !optionsJson.data?.options) {
        setActionError(optionsJson.error?.message ?? "পাসকি নিবন্ধন শুরু করা যায়নি।");
        return;
      }
      let attestation;
      try {
        attestation = await startRegistration({ optionsJSON: optionsJson.data.options });
      } catch {
        // NotAllowedError (cancelled / timed out) and unsupported
        // authenticators both land here — say so plainly, no blame.
        setActionError("পাসকি তৈরি সম্পন্ন হয়নি — প্রম্পট বাতিল হয়ে থাকতে পারে। আবার চেষ্টা করুন।");
        return;
      }
      const verifyRes = await fetch("/api/v1/admin/auth/passkey/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: attestation, deviceLabel: label }),
      });
      const verifyJson = (await verifyRes.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      if (!verifyRes.ok) {
        setActionError(verifyJson.error?.message ?? "পাসকি সংরক্ষণ করা যায়নি।");
        return;
      }
      setDeviceLabel("");
      setNotice("পাসকি যোগ হয়েছে — এখন থেকে লগইন পেজে “পাসকি দিয়ে প্রবেশ” দিয়ে এই ডিভাইস দিয়ে লগইন করা যাবে।");
      await load();
    } catch {
      setActionError("সার্ভারে পৌঁছানো যাচ্ছে না — নেটওয়ার্ক দেখে আবার চেষ্টা করুন।");
    } finally {
      setRegistering(false);
    }
  }

  async function handleDelete(row: PasskeyRow) {
    setBusyId(row.id);
    setActionError("");
    setNotice("");
    try {
      const res = await fetch("/api/v1/admin/auth/passkey/credentials", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!res.ok) {
        setActionError(json.error?.message ?? "পাসকি মুছে ফেলা যায়নি।");
        return;
      }
      setConfirmDeleteId(null);
      setNotice(`“${row.deviceLabel}” পাসকি মুছে ফেলা হয়েছে — ওই ডিভাইস দিয়ে আর পাসকি লগইন হবে না।`);
      await load();
    } catch {
      setActionError("সার্ভারে পৌঁছানো যাচ্ছে না — নেটওয়ার্ক দেখে আবার চেষ্টা করুন।");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-text-main">পাসকি (Passkey)</h2>
          <p className="mt-1 text-sm text-text-muted">
            ফিঙ্গারপ্রিন্ট, ফেস বা ডিভাইসের PIN দিয়ে পাসওয়ার্ড ছাড়াই লগইন। পাসকি এই ডিভাইসেই থাকে —
            সার্ভারে শুধু পাবলিক কী থাকে, তাই ফাঁস হওয়ার মতো গোপন কিছু নেই। পাসওয়ার্ড লগইন আগের মতোই চালু থাকবে।
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
          রিফ্রেশ
        </Button>
      </div>

      {notice ? (
        <p role="status" className="mt-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {notice}
        </p>
      ) : null}
      {actionError ? (
        <p role="alert" className="mt-4 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {actionError}
        </p>
      ) : null}

      {error ? (
        <div className="mt-4">
          <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void load()}>
            আবার চেষ্টা করুন
          </Button>
        </div>
      ) : rows === null ? (
        <p role="status" className="mt-4 text-sm text-text-muted">
          পাসকি তালিকা লোড হচ্ছে…
        </p>
      ) : rows.length === 0 ? (
        <p role="status" className="mt-4 text-sm text-text-muted">
          এখনো কোনো পাসকি যোগ করা হয়নি।
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p className="text-sm font-semibold text-text-main">{row.deviceLabel}</p>
                <p className="mt-0.5 text-xs text-text-muted">
                  যোগ হয়েছে: {absoluteBn(row.createdAt)}
                  {row.lastUsedAt ? ` · শেষ ব্যবহার: ${absoluteBn(row.lastUsedAt)}` : " · এখনো ব্যবহার হয়নি"}
                </p>
              </div>
              {confirmDeleteId === row.id ? (
                <span className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={busyId === row.id}
                    onClick={() => void handleDelete(row)}
                  >
                    {busyId === row.id ? "মুছছে…" : "নিশ্চিত মুছুন"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setConfirmDeleteId(null)}
                  >
                    থাক
                  </Button>
                </span>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmDeleteId(row.id)}
                >
                  মুছে ফেলুন
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-5 border-t border-border pt-4">
        {supported === false ? (
          <p role="status" className="text-sm text-text-muted">
            এই ব্রাউজারে পাসকি (WebAuthn) সমর্থিত নয় — অন্য আধুনিক ব্রাউজার বা ডিভাইস থেকে যোগ করুন।
          </p>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-56 flex-1">
              <Input
                label="ডিভাইসের নাম"
                value={deviceLabel}
                onChange={(e) => setDeviceLabel(e.target.value)}
                placeholder="যেমন: আমার ফোন / অফিসের ল্যাপটপ"
                maxLength={80}
              />
            </div>
            <Button type="button" disabled={registering} onClick={() => void handleRegister()}>
              {registering ? "পাসকি তৈরি হচ্ছে…" : "নতুন পাসকি যোগ করুন"}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
