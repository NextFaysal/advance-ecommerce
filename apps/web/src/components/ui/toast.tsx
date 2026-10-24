import type { ReactNode } from "react";

export function Toast({ tone = "success", children }: { tone?: "success" | "error" | "info"; children: ReactNode }) {
  const tones: Record<string, string> = {
    success: "border-emerald-200 bg-emerald-50 text-emerald-800",
    error: "border-rose-200 bg-rose-50 text-rose-800",
    info: "border-sky-200 bg-sky-50 text-sky-800",
  };
  const icons: Record<string, string> = { success: "✓", error: "⚠", info: "ℹ" };
  return (
    <div role="status" aria-live="polite" className={`flex items-center gap-2 rounded-md border p-3 text-sm shadow-md ${tones[tone]}`}>
      <span aria-hidden="true">{icons[tone]}</span> {children}
    </div>
  );
}
