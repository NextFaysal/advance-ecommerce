"use client";

import { useEffect, useState } from "react";
import { ShellIcon } from "./icons";

/**
 * SidebarToggle — collapses the desktop admin sidebar to its icons-only
 * mini mode (doc 31, D2). The sidebar itself is server-rendered; this
 * island only flips its `data-collapsed` attribute and persists the
 * choice in localStorage. The mini-mode styling lives in NavGroups /
 * Sidebar via `group-data-[collapsed=true]/sidebar:` variants, so no
 * React state has to cross the server/client boundary.
 *
 * Breakpoint contract (doc 31, D7): in the tablet band 768–1279px the
 * sidebar is ALWAYS collapsed, whatever the stored preference says —
 * the band rule wins over the attribute this island would otherwise
 * apply. The manual preference is still recorded while in the band
 * (the toggle stays usable) and takes effect again at ≥1280px, where
 * the persisted toggle is the only input. Below 768px the sidebar is
 * hidden entirely (MobileNav), so the band query starts at 768.
 *
 * The sync effect runs after every render (no dep array) on purpose:
 * when a locale switch refreshes the route, the server re-renders the
 * sidebar expanded — the effect immediately re-applies the effective
 * state, the same reconcile-on-mount pattern ThemeToggle uses.
 */
const STORAGE_KEY = "advance-ecommerce:admin-sidebar-collapsed";
const BAND_QUERY = "(min-width: 768px) and (max-width: 1279px)";

function readStored(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function applySidebar(next: boolean) {
  document
    .querySelector("[data-admin-sidebar]")
    ?.setAttribute("data-collapsed", next ? "true" : "false");
}

export function SidebarToggle({
  collapseLabel,
  expandLabel,
}: {
  collapseLabel: string;
  expandLabel: string;
}) {
  // `pref` is the user's persisted manual preference (honoured ≥1280);
  // `band` is the 768–1279px tablet band, which forces mini mode.
  const [pref, setPref] = useState(false);
  const [band, setBand] = useState(false);
  const collapsed = band || pref;

  useEffect(() => {
    setPref(readStored());
  });

  useEffect(() => {
    const mq = window.matchMedia(BAND_QUERY);
    const sync = () => setBand(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    applySidebar(collapsed);
  });

  const toggle = () => {
    const next = !pref;
    setPref(next);
    // In the band the attribute stays collapsed (band rule); the new
    // preference is persisted and applies once the viewport is ≥1280.
    applySidebar(band || next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      // Storage unavailable (private mode etc.) — the attribute still
      // applies for this session; nothing else to do.
    }
  };

  const label = collapsed ? expandLabel : collapseLabel;
  return (
    <button
      type="button"
      onClick={toggle}
      aria-expanded={!collapsed}
      aria-label={label}
      title={label}
      className="focus-ring flex min-h-[36px] w-full items-center gap-2.5 rounded-md px-3 text-small font-medium text-text-muted transition duration-fast ease-smooth hover:bg-surface-2 hover:text-text-main group-data-[collapsed=true]/sidebar:justify-center group-data-[collapsed=true]/sidebar:px-0"
    >
      <ShellIcon name={collapsed ? "ChevronsRight" : "ChevronsLeft"} className="h-[18px] w-[18px] shrink-0" />
      <span className="group-data-[collapsed=true]/sidebar:hidden">{label}</span>
    </button>
  );
}
