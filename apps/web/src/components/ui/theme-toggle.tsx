"use client";

import { useEffect, useState } from "react";

/**
 * ThemeToggle (Design System v3, plan §4/§7) — dark-mode switch for the
 * storefront header (admin may reuse it). Toggles the `.dark` class on
 * <html>, which the globals.css `.dark` token block keys off.
 *
 * Persistence: localStorage key "theme" with values "dark" | "light".
 * First visit (no stored value) follows prefers-color-scheme. The sun /
 * moon glyphs are inline Lucide-style SVGs — ui/icon.tsx has no sun/moon
 * names yet, so they live here.
 *
 * Note: there is no pre-hydration theme bootstrap script in the root
 * layout yet, so a stored dark preference applies right after mount
 * (possible brief light flash on first paint — parent may add the
 * bootstrap later; this component stays the single source of truth for
 * toggling).
 *
 *   <ThemeToggle />                       — default 44px round button
 *   <ThemeToggle className="…" />         — extra classes appended
 */
function SunGlyph() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  );
}

function MoonGlyph() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  );
}

function applyTheme(dark: boolean) {
  document.documentElement.classList.toggle("dark", dark);
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  // Lazy init from the DOM class (correct if a bootstrap ever sets it);
  // the mount effect below reconciles with storage / system preference.
  const [isDark, setIsDark] = useState<boolean>(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem("theme");
    } catch {
      stored = null;
    }
    const dark =
      stored === "dark" ||
      (stored !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    applyTheme(dark);
    setIsDark(dark);
  }, []);

  const toggle = () => {
    const next = !isDark;
    applyTheme(next);
    setIsDark(next);
    try {
      window.localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      // Storage unavailable (private mode etc.) — the class still applies
      // for this session; nothing else to do.
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="ডার্ক মোড"
      aria-pressed={isDark}
      title="ডার্ক মোড"
      className={`inline-flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card text-text-main shadow-sm transition motion-base hover:shadow-lift ${className}`}
    >
      {isDark ? <SunGlyph /> : <MoonGlyph />}
    </button>
  );
}
