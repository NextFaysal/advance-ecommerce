"use client";

import Link from "next/link";
import { useLocale } from "@/i18n/LocaleProvider";
import { pick } from "@/i18n/locale";
import { CALL_CENTER_STRINGS } from "./strings";

/**
 * Call Center section tabs — the module has ONE sidebar entry
 * (/admin/call-center); its five screens are reached through this tab
 * bar, rendered at the top of every call-center page. Link-based
 * (each tab is its own route), styled after ui/tabs.tsx.
 */
export type CallCenterTabId = "workbench" | "supervisor" | "scripts" | "qa" | "reports";

export function CallCenterTabs({ active }: { active: CallCenterTabId }) {
  const { locale } = useLocale();
  const s = pick(locale, CALL_CENTER_STRINGS);
  const tabs: { id: CallCenterTabId; href: string; label: string }[] = [
    { id: "workbench", href: "/admin/call-center", label: s.tabWorkbench },
    { id: "supervisor", href: "/admin/call-center/supervisor", label: s.tabSupervisor },
    { id: "scripts", href: "/admin/call-center/scripts", label: s.tabScripts },
    { id: "qa", href: "/admin/call-center/qa", label: s.tabQa },
    { id: "reports", href: "/admin/call-center/reports", label: s.tabReports },
  ];
  return (
    <nav aria-label={s.tabsAria} className="mb-5 flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((t) => {
        const isActive = t.id === active;
        return (
          <Link
            key={t.id}
            href={t.href}
            aria-current={isActive ? "page" : undefined}
            className={`relative flex min-h-[44px] shrink-0 items-center rounded-sm px-3.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 ${
              isActive ? "text-brand-700" : "text-text-muted hover:text-text-main"
            }`}
          >
            {t.label}
            <span
              aria-hidden="true"
              className={`absolute inset-x-3 -bottom-px h-[2.5px] rounded-full bg-brand-600 transition ${
                isActive ? "opacity-100" : "opacity-0"
              }`}
            />
          </Link>
        );
      })}
    </nav>
  );
}
