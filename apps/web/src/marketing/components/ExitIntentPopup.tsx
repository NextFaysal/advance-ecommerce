"use client";

// Exit-intent popup (ADV-18 remainder) — mounted once in the
// storefront shell beside InstallPrompt / ResellerRefCapture, so it
// only ever exists on storefront routes (the shell itself renders
// bare children on /admin and /offline).
//
// Behaviour contract:
// - Config comes from GET /api/v1/public/marketing/exit-intent,
//   which returns null unless the module flag is on, the popup is
//   enabled, and — for the coupon code — the Coupon row validates
//   at that moment. Nothing configured = this renders nothing.
// - Trigger: desktop pointer leaving through the top of the
//   viewport (mouseleave, clientY <= 0), OR — on coarse-pointer
//   (touch) devices — a 60s dwell fallback, since touch has no
//   exit gesture.
// - At most ONCE per session (sessionStorage), and after any
//   dismissal it stays suppressed for 7 days (localStorage).
// - Never on /checkout or /account paths (checked at trigger time,
//   not just mount, so client-side navigation is covered).
// - No dark patterns: a clear close button, no fake countdown, no
//   guilt copy, one plain CTA.
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui/icon";

const SESSION_KEY = "ae-exit-intent-shown";
const DISMISS_KEY = "ae-exit-intent-dismissed-at";
const SUPPRESS_MS = 7 * 24 * 60 * 60 * 1000;
const TOUCH_DWELL_MS = 60_000;
const EXCLUDED_PREFIXES = ["/checkout", "/account"];

interface PublicExitIntent {
  headlineBn: string;
  bodyBn: string;
  couponCode: string | null;
}

function suppressed(): boolean {
  try {
    if (sessionStorage.getItem(SESSION_KEY)) return true;
    const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    return dismissedAt > 0 && Date.now() - dismissedAt < SUPPRESS_MS;
  } catch {
    return false;
  }
}

function markDismissed() {
  try {
    sessionStorage.setItem(SESSION_KEY, "1");
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    // Storage unavailable (private mode) — the popup simply behaves
    // like a first visit next time; never throw into the page.
  }
}

export function ExitIntentPopup() {
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const [config, setConfig] = useState<PublicExitIntent | null>(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const firedRef = useRef(false);

  useEffect(() => {
    if (suppressed()) return;
    let live = true;
    fetch("/api/v1/public/marketing/exit-intent")
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { data?: PublicExitIntent | null } | null) => {
        if (live && json?.data) setConfig(json.data);
      })
      .catch(() => {
        // No config — the popup simply never appears.
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (config === null) return;
    const fire = () => {
      if (firedRef.current || suppressed()) return;
      const path = pathnameRef.current ?? "";
      if (EXCLUDED_PREFIXES.some((p) => path.startsWith(p))) return;
      firedRef.current = true;
      try {
        sessionStorage.setItem(SESSION_KEY, "1");
      } catch {
        // ignore — dismissal below still records the 7-day window
      }
      setOpen(true);
    };
    const onMouseLeave = (e: MouseEvent) => {
      if (e.clientY <= 0) fire();
    };
    document.addEventListener("mouseleave", onMouseLeave);
    let dwell: ReturnType<typeof setTimeout> | null = null;
    if (typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches) {
      dwell = setTimeout(fire, TOUCH_DWELL_MS);
    }
    return () => {
      document.removeEventListener("mouseleave", onMouseLeave);
      if (dwell !== null) clearTimeout(dwell);
    };
  }, [config]);

  if (!open || config === null) return null;

  const close = () => {
    markDismissed();
    setOpen(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={config.headlineBn}
      onClick={close}
    >
      <div
        className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-xl font-extrabold text-slate-900">{config.headlineBn}</h2>
          <button
            type="button"
            onClick={close}
            aria-label="বন্ধ করুন"
            className="rounded-full p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
          >
            <Icon name="x" size={20} />
          </button>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">{config.bodyBn}</p>
        {config.couponCode ? (
          <div className="mt-4 flex items-center gap-3 rounded-2xl bg-brand-50 px-4 py-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-500">চেকআউটে ব্যবহার করুন</p>
              <code className="font-mono text-lg font-bold tracking-wider text-slate-900">
                {config.couponCode}
              </code>
            </div>
            <button
              type="button"
              className="ml-auto shrink-0 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700"
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(config.couponCode ?? "")
                  .then(() => setCopied(true))
                  .catch(() => setCopied(false));
              }}
            >
              {copied ? "কপি হয়েছে" : "কপি করুন"}
            </button>
          </div>
        ) : null}
        <div className="mt-5 flex gap-3">
          <a
            href="/shop"
            onClick={close}
            className="flex-1 rounded-xl bg-brand-600 px-4 py-2.5 text-center text-sm font-bold text-white transition hover:bg-brand-700"
          >
            কেনাকাটা দেখুন
          </a>
          <button
            type="button"
            onClick={close}
            className="rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-100"
          >
            না, ধন্যবাদ
          </button>
        </div>
      </div>
    </div>
  );
}
