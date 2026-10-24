"use client";

import type { ReactNode } from "react";
import { Button } from "./button";

export function Modal({ open, onClose, title, children, onConfirm }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; onConfirm?: () => void;
}) {
  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div className="w-full max-w-[560px] rounded-xl bg-card p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" aria-label="Close dialog" onClick={onClose} className="min-h-[44px] min-w-[44px] rounded-md hover:bg-surface-2">✕</button>
        </div>
        <div className="mt-4">{children}</div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          {onConfirm ? <Button onClick={onConfirm}>Confirm</Button> : null}
        </div>
      </div>
    </div>
  );
}
