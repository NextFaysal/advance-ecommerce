"use client";

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Icon } from "./icon";
import { useLocale } from "@/i18n/LocaleProvider";
import { pick } from "@/i18n/locale";
import { UI_STRINGS } from "./strings";

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Drawer (Design System v4, doc 31 D3) — slides in from the right on
 * the raised surface step with rounded-3xl leading corners, xl shadow
 * and a blurred overlay-token backdrop; sticky header/footer.
 * Optional `footer` slot; Escape closes. While open the body scroll
 * is locked, focus is trapped inside the panel and returned to the
 * opener on close, and scroll chaining is contained (doc 35 wave 4).
 */
export function Drawer({ open, onClose, title, children, footer }: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { locale } = useLocale();
  const s = pick(locale, UI_STRINGS);
  const panelRef = useRef<HTMLElement>(null);
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
    <div role="dialog" aria-modal="true" aria-label={title} className="anim-fade-in fixed inset-0 z-50 overscroll-contain bg-overlay/60 backdrop-blur-[2px]" onClick={onClose}>
      <aside
        ref={panelRef}
        tabIndex={-1}
        className="anim-drawer-in absolute right-0 top-0 flex h-full w-full max-w-[480px] flex-col rounded-l-3xl bg-surface-raised shadow-xl outline-none"
        onClick={(e) => e.stopPropagation()}
      >
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
        <div className="flex-1 overflow-auto overscroll-contain p-5">{children}</div>
        {footer ? <div className="border-t border-border/70 bg-surface-2/60 px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</div> : null}
      </aside>
    </div>
  );
}
