"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";
import { Button } from "./button";
import { Icon } from "./icon";
import { useLocale } from "@/i18n/LocaleProvider";
import { pick } from "@/i18n/locale";
import { ADMIN_STRINGS } from "@/admin/strings";

/**
 * Modal (Design System v4, doc 31 D3) — fade-slide-in panel on the
 * raised surface step, rounded-3xl, xl shadow, blurred overlay-token
 * backdrop, divided header/footer, locale-resolved default action
 * labels (doc 30). Escape closes.
 */
export function Modal({ open, onClose, title, children, onConfirm }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; onConfirm?: () => void;
}) {
  const { locale } = useLocale();
  const s = pick(locale, ADMIN_STRINGS);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="anim-fade-in fixed inset-0 z-50 flex items-end justify-center bg-overlay/60 p-4 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div className="animate-fade-slide-in w-full max-w-[560px] rounded-3xl bg-surface-raised shadow-xl" onClick={(e) => e.stopPropagation()}>
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
