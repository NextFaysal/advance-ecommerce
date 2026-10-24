"use client";
/**
 * Push notification subscribe toggle — customer-facing client
 * component (no props; safe to render from server components).
 *
 * Flow: read the VAPID public key from GET /api/v1/public/push/config;
 * when push is NOT_CONFIGURED on the server, show that honestly
 * instead of a subscribe button that could never receive anything.
 * Subscribing asks for Notification permission, creates a
 * PushSubscription through the service-worker registration, and stores
 * it via POST /api/v1/public/push/subscriptions (which attaches the
 * logged-in customer from the session cookie). Unsubscribing removes
 * both the browser subscription and the stored row.
 */
import { useCallback, useEffect, useState } from "react";
import { SERVICE_WORKER_PATH } from "./config";

type PushUiState =
  | "loading"
  | "unsupported"
  | "not-configured"
  | "denied"
  | "subscribed"
  | "unsubscribed"
  | "busy"
  | "error";

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

export default function PushSubscribeToggle() {
  const [state, setState] = useState<PushUiState>("loading");
  const [publicKey, setPublicKey] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (
      typeof window === "undefined" ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !("Notification" in window)
    ) {
      setState("unsupported");
      return;
    }
    try {
      const res = await fetch("/api/v1/public/push/config");
      const json = (await res.json()) as { data?: { configured?: boolean; publicKey?: string | null } };
      if (!json.data?.configured || !json.data.publicKey) {
        setState("not-configured");
        return;
      }
      setPublicKey(json.data.publicKey);
      if (Notification.permission === "denied") {
        setState("denied");
        return;
      }
      const registration = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_PATH);
      const existing = registration ? await registration.pushManager.getSubscription() : null;
      setState(existing ? "subscribed" : "unsubscribed");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const subscribe = useCallback(async () => {
    if (!publicKey) return;
    setState("busy");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "unsubscribed");
        return;
      }
      const registration =
        (await navigator.serviceWorker.getRegistration(SERVICE_WORKER_PATH)) ??
        (await navigator.serviceWorker.register(SERVICE_WORKER_PATH, { scope: "/" }));
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      const res = await fetch("/api/v1/public/push/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      if (!res.ok) throw new Error(`subscribe failed: ${res.status}`);
      setState("subscribed");
    } catch {
      setState("error");
    }
  }, [publicKey]);

  const unsubscribe = useCallback(async () => {
    setState("busy");
    try {
      const registration = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_PATH);
      const existing = registration ? await registration.pushManager.getSubscription() : null;
      if (existing) {
        await fetch("/api/v1/public/push/subscriptions", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: existing.endpoint }),
        });
        await existing.unsubscribe();
      }
      setState("unsubscribed");
    } catch {
      setState("error");
    }
  }, []);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-sm font-semibold text-text-main">পুশ নোটিফিকেশন</p>
      {state === "loading" || state === "busy" ? (
        <p className="mt-1 text-sm text-slate-500">লোড হচ্ছে…</p>
      ) : state === "unsupported" ? (
        <p className="mt-1 text-sm text-slate-500">
          এই ব্রাউজারে পুশ নোটিফিকেশন সমর্থিত নয়।
        </p>
      ) : state === "not-configured" ? (
        <p className="mt-1 text-sm text-slate-500">
          পুশ নোটিফিকেশন এখনো চালু হয়নি — সার্ভারে VAPID কী সেট করা হয়নি।
        </p>
      ) : state === "denied" ? (
        <p className="mt-1 text-sm text-slate-500">
          ব্রাউজারে নোটিফিকেশনের অনুমতি বন্ধ আছে। চালু করতে ব্রাউজারের সাইট সেটিংস থেকে
          নোটিফিকেশন অনুমতি দিন।
        </p>
      ) : state === "error" ? (
        <p className="mt-1 text-sm text-slate-500">
          কিছু একটা সমস্যা হয়েছে। আবার চেষ্টা করুন।
        </p>
      ) : state === "subscribed" ? (
        <>
          <p className="mt-1 text-sm text-slate-500">
            চালু আছে — অর্ডারের আপডেট এই ডিভাইসে পুশ নোটিফিকেশন হিসেবে আসবে।
          </p>
          <button
            type="button"
            onClick={() => void unsubscribe()}
            className="mt-3 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            বন্ধ করুন
          </button>
        </>
      ) : (
        <>
          <p className="mt-1 text-sm text-slate-500">
            অর্ডার কনফার্ম, শিপিং ও ডেলিভারির আপডেট সরাসরি এই ডিভাইসে পান।
          </p>
          <button
            type="button"
            onClick={() => void subscribe()}
            className="mt-3 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
          >
            চালু করুন
          </button>
        </>
      )}
    </div>
  );
}
