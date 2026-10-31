"use client";

// PWA install prompt (Design v3 §6) — a designed bottom card shown only
// when the browser fires `beforeinstallprompt`. Dismissal is remembered
// for 30 days (localStorage) so the shopper is never nagged; nothing
// renders when the event never fires, the app is already installed
// (standalone display mode), or the prompt was recently dismissed.
// NOT mounted by this file — the parent wires <InstallPrompt /> into
// the storefront shell.
import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { isStandalonePwa } from "./register";

const DISMISS_KEY = "advance-ecommerce:install-prompt-dismissed-at";
const DISMISS_DAYS = 30;

/** The (still non-standard) beforeinstallprompt event shape. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

function dismissedRecently(): boolean {
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const at = Number(raw);
    if (!Number.isFinite(at)) return false;
    return Date.now() - at < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

function rememberDismissal() {
  try {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    // Storage unavailable (private mode etc.) — the prompt simply
    // won't be suppressed next visit; never break the page over it.
  }
}

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isStandalonePwa() || dismissedRecently()) return;

    function onBeforeInstallPrompt(e: Event) {
      // Stop the browser's mini-infobar; we show our own designed card.
      e.preventDefault();
      if (dismissedRecently()) return;
      setDeferred(e as BeforeInstallPromptEvent);
      setVisible(true);
    }
    function onAppInstalled() {
      setVisible(false);
      setDeferred(null);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  function dismiss() {
    rememberDismissal();
    setVisible(false);
  }

  async function install() {
    if (!deferred) return;
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === "dismissed") rememberDismissal();
    } catch {
      // A failed prompt() must not crash the storefront.
    }
    setVisible(false);
    setDeferred(null);
  }

  if (!visible || !deferred) return null;

  return (
    <div
      role="dialog"
      aria-label="অ্যাপ ইনস্টল করুন"
      className="anim-drawer-in fixed inset-x-3 bottom-20 z-50 sm:inset-x-auto sm:right-4 sm:w-full sm:max-w-sm lg:bottom-6"
    >
      <div className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4 shadow-pop">
        <span className="bg-primary flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white shadow-lift">
          <Icon name="store" size={24} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-text-main">অ্যাপটি ইনস্টল করুন</p>
          <p className="mt-0.5 text-xs leading-5 text-text-muted">
            হোম স্ক্রিন থেকে এক ট্যাপেই দোকান খুলুন — দ্রুত লোড, সহজ অর্ডার ট্র্যাকিং।
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={install}
              className="brand-gradient flex h-11 items-center rounded-xl px-5 text-sm font-semibold text-white shadow-md transition hover:opacity-90"
            >
              ইনস্টল
            </button>
            <button
              type="button"
              onClick={dismiss}
              className="flex h-11 items-center rounded-xl px-4 text-sm font-semibold text-text-muted transition hover:bg-surface-2"
            >
              পরে
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="বন্ধ করুন"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-text-muted transition hover:bg-surface-2"
        >
          <Icon name="x" size={18} />
        </button>
      </div>
    </div>
  );
}

export default InstallPrompt;
