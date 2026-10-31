"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Button } from "./button";
import { Icon } from "./icon";
import { useLocale } from "@/i18n/LocaleProvider";
import { pick } from "@/i18n/locale";
import { UI_STRINGS } from "./strings";

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal (Design System v4, doc 31 D3) — fade-slide-in panel on the
 * raised surface step, rounded-3xl, xl shadow, blurred overlay-token
 * backdrop, divided header/footer, locale-resolved default action
 * labels (doc 30). Escape closes. While open the body scroll is
 * locked, focus is trapped inside the panel and returned to the
 * opener on close, and scroll chaining is contained (doc 35 wave 4).
 */
export function Modal({ open, onClose, title, children, onConfirm }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; onConfirm?: () => void;
}) {
  const { locale } = useLocale();
  const s = pick(locale, UI_STRINGS);
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const panel = panelRef.current;
    const focusables = () =>
      panel
        ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null)
        : [];
    (focusables()[0] ?? panel)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      opener?.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="anim-fade-in fixed inset-0 z-50 flex items-end justify-center overscroll-contain bg-overlay/60 p-4 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div ref={panelRef} tabIndex={-1} className="animate-fade-slide-in max-h-[calc(100dvh-2rem)] w-full max-w-[560px] overflow-y-auto overscroll-contain rounded-3xl bg-surface-raised shadow-xl outline-none" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border/70 px-5 py-4">
          <h2 className="font-display text-lg font-semibold text-text-main">{title}</h2>
          <button
            type="button"
            aria-label={s.close}
            onClick={onClose}
            className="focus-ring flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-text-muted transition duration-fast ease-smooth hover:bg-surface-2 hover:text-text-main"
          >
            <Icon name="x" size={20} />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        <div className="flex justify-end gap-2 border-t border-border/70 px-5 py-4">
          <Button variant="outline" onClick={onClose}>{s.cancel}</Button>
          {onConfirm ? <Button onClick={onConfirm}>{s.confirm}</Button> : null}
        </div>
      </div>
    </div>
  );
}
