import type { ReactNode } from "react";
import { SettingsNav } from "./settings-nav";

/**
 * Settings segment layout (doc 31, D6) — the uniform two-column
 * settings pattern: section rail on the left, the page's own panel
 * cards on the right. On phone the rail becomes a scrolling pill row
 * above the panels. Pages keep their own PageHeader and forms; this
 * layout only supplies the shared frame.
 */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="items-start lg:grid lg:grid-cols-[250px_minmax(0,1fr)] lg:gap-8">
      <SettingsNav />
      <div className="mt-4 min-w-0 lg:mt-0">{children}</div>
    </div>
  );
}
