import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-lg border border-border bg-card p-5 shadow-sm ${className}`}>{children}</section>;
}
