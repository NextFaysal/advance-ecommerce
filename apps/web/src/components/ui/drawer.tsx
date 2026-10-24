"use client";

import type { ReactNode } from "react";

export function Drawer({ open, onClose, title, children }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 bg-black/50" onClick={onClose}>
      <aside className="absolute right-0 top-0 h-full w-full max-w-[480px] overflow-auto bg-card p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" aria-label="Close drawer" onClick={onClose} className="min-h-[44px] min-w-[44px] rounded-md hover:bg-surface-2">✕</button>
        </div>
        <div className="mt-4">{children}</div>
      </aside>
    </div>
  );
}
