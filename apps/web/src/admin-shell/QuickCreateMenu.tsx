"use client";

/**
 * QuickCreateMenu — the topbar "+ New" dropdown (Doc 35 wave 1).
 *
 * Before this wave the button was dead: it rendered on every admin
 * page and opened nothing. It now opens a small menu of quick-create
 * links, each verified against a real route under app/admin/:
 *   New product     -> /admin/products/new (the product editor)
 *   New order       -> /admin/orders (the ManualOrderBuilder lives on
 *                      that page; there is no /orders/new route)
 *   New sale (POS)  -> /admin/pos
 * Customers is deliberately absent: the customers page has no create
 * flow today, so a "new customer" item would be another dead end.
 *
 * Interaction follows the shell/kit dropdown pattern (ColumnPicker in
 * src/admin/table-prefs.tsx): a relative wrapper, the toggle carrying
 * aria-expanded + aria-haspopup, and a fixed inset-0 backdrop button
 * that closes on outside click. Escape also closes and returns focus
 * to the toggle. The component lives in its own client module for the
 * same reason CommandPaletteTrigger does: the Topbar stays a server
 * component and only this island ships client JS.
 *
 * Brand exception (doc 35, recorded): the toggle's brand-gradient is
 * deliberate — this button is a primary CTA, one of the three places
 * the gradient is reserved for (dashboard hero, primary CTAs, logo
 * marks). It must not spread to decorative shell elements.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLocale } from "@/i18n/LocaleProvider";
import { pick } from "@/i18n/locale";
import { ADMIN_STRINGS } from "@/admin/strings";
import { ShellIcon } from "./icons";

export function QuickCreateMenu() {
  const { locale } = useLocale();
  const s = pick(locale, ADMIN_STRINGS);
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open ]);

  const items = [
    { href: "/admin/products/new", label: s.quickNewProduct, icon: "Package" },
    { href: "/admin/orders", label: s.quickNewOrder, icon: "ShoppingCart" },
    { href: "/admin/pos", label: s.quickNewSale, icon: "CreditCard" },
  ];

  return (
    <div className="relative">
      <button
        ref={toggleRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="focus-ring brand-gradient flex min-h-[44px] items-center gap-1.5 rounded-md px-3.5 text-sm font-semibold text-white shadow-md transition duration-fast ease-smooth hover:shadow-glow"
      >
        <ShellIcon name="Plus" className="h-4 w-4" />
        <span className="hidden sm:inline">{s.newItem}</span>
      </button>
      {open ? (
        <>
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            aria-label={s.quickCreateLabel}
            className="absolute right-0 z-20 mt-2 w-60 rounded-lg border border-border bg-card p-2 shadow-lift"
          >
            {items.map((item) => (
              <Link
                key={item.href}
                role="menuitem"
                href={item.href}
                onClick={() => setOpen(false)}
                className="focus-ring flex min-h-[44px] items-center gap-2.5 rounded-md px-2 text-small font-medium text-text-main transition duration-fast hover:bg-surface-2"
              >
                <ShellIcon name={item.icon} className="h-[18px] w-[18px] text-text-muted" />
                {item.label}
              </Link>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
