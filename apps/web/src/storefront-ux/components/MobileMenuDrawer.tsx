"use client";

/**
 * MobileMenuDrawer — THE shared mobile menu (doc 33 §3.3, wave R1).
 *
 * Before doc 33 no theme had a phone menu at all: the CMS header
 * menu was `hidden` below md and site navigation on a phone meant
 * scrolling to the footer. §3.3's answer is ONE drawer every theme
 * header mounts — themes never invent their own. R2 wires it into
 * each header's main tier; this wave delivers it standalone.
 *
 * Data: the drawer invents NO fetch. It consumes the exact props
 * every header already receives (ThemeHeaderProps): the CMS
 * `headerMenu` (visible-filtered by the shell; DEFAULT_HEADER_MENU
 * fallback, mirroring SiteHeader) and the public category tree
 * `categories` (undefined = still loading, [] = none). Labels pick
 * exactly as the headers do today: menu items
 * `locale === "en" && labelEn ? labelEn : labelBn`; categories
 * `name[locale] || name.bn`. Category links keep the platform
 * contract `/shop?category=<slug>`.
 *
 * Anatomy (all below `lg` — the wrapper renders nothing intrusive
 * at desktop widths, where the full tiers already navigate):
 * - a 44px hamburger trigger (aria-haspopup/aria-expanded, label
 *   from COMMON_STRINGS.menu);
 * - header row: the store name + a 44px close button, focused on
 *   open;
 * - shortcut rows: Account / Track Order / Wishlist (COMMON labels);
 * - the CMS menu (children indented under their parent);
 * - the category tree (children indented likewise);
 * - a footer slot — R2 mounts the theme's <LanguageSwitcher />
 *   there, so the switcher stays reachable at every width (doc 30).
 *
 * Behaviour mirrors the platform drawers (doc 32 cart drawers +
 * doc 31 MobileNav): role="dialog" aria-modal, Escape closes, body
 * scroll locks while open, route change closes, focus is trapped
 * inside the panel and returns to the trigger on close. Motion is
 * the left-edge slide-in (.anim-drawer-in-left), which the global
 * reduced-motion rule silences. Safe-area padding closes the panel
 * (§3.4). Surfaces are token-only (bg-card / border-border /
 * text-text-*), so the drawer follows whichever theme is active —
 * including Aurora/Circuit dark — and R2 can still dress it per
 * theme via the *ClassName props.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/icon";
import { useLocale } from "@/i18n/LocaleProvider";
import { DEFAULT_HEADER_MENU, type SiteMenuItem } from "@/cms/site-content-types";
import type { PublicCategoryNode } from "@/catalog/category-tree";

export interface MobileMenuDrawerProps {
  /** Store name shown in the drawer header (headers already have it). */
  brandName?: string;
  /** CMS header menu — the ThemeHeaderProps prop, passed through. */
  headerMenu?: ReadonlyArray<SiteMenuItem>;
  /** Public category tree roots — the ThemeHeaderProps prop. */
  categories?: ReadonlyArray<PublicCategoryNode>;
  /** Footer slot: R2 renders the theme's language switcher here. */
  footer?: ReactNode;
  /** Dress the hamburger trigger in the theme's voice. */
  triggerClassName?: string;
  /** Dress the sliding panel (surface, radius, width). */
  panelClassName?: string;
  /** Dress the overlay. */
  overlayClassName?: string;
}

const ROW_CLASS =
  "focus-ring flex min-h-[48px] items-center gap-3 rounded-xl px-3 text-[15px] font-medium text-text-main transition hover:bg-surface-2";
const SUB_ROW_CLASS =
  "focus-ring flex min-h-[44px] items-center gap-3 rounded-xl py-1 pl-12 pr-3 text-sm text-text-muted transition hover:bg-surface-2 hover:text-text-main";
const HEADING_CLASS = "px-3 pb-1 pt-5 text-xs font-bold text-text-subtle";

export function MobileMenuDrawer({
  brandName = "Advance Ecommerce",
  headerMenu,
  categories,
  footer,
  triggerClassName = "",
  panelClassName = "",
  overlayClassName = "",
}: MobileMenuDrawerProps) {
  const { locale, t } = useLocale();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  const close = useCallback(() => setOpen(false), []);

  // CMS menu labels are owner content with their own {bn, en} fields —
  // SiteHeader's picking rule, verbatim.
  const menuLabel = (item: { labelBn: string; labelEn: string }) =>
    locale === "en" && item.labelEn ? item.labelEn : item.labelBn;
  const navItems: ReadonlyArray<SiteMenuItem> =
    headerMenu && headerMenu.length > 0 ? headerMenu : DEFAULT_HEADER_MENU;

  /* Panels never survive a navigation (SiteHeader/MobileNav rule). */
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  /* While open: Escape closes, body scroll locks, focus starts on
     the close button, Tab stays inside the panel, and closing
     returns focus to the trigger. */
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusables = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      triggerRef.current?.focus();
    };
  }, [open ]);

  const isActive = (href: string) => {
    if (!href.startsWith("/")) return false;
    const path = href.split(/[?#]/)[0];
    return path === pathname;
  };

  const shortcuts: ReadonlyArray<{ href: string; label: string; icon: IconName }> = [
    { href: "/account", label: t.account, icon: "user" },
    { href: "/track", label: t.trackOrder, icon: "package" },
    { href: "/wishlist", label: t.wishlist, icon: "heart" },
  ];

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t.menu}
        className={`focus-ring flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-text-main transition hover:bg-surface-2 lg:hidden ${triggerClassName}`}
      >
        <Icon name="menu" size={22} />
      </button>

      {open ? (
        <div
          className={`anim-fade-in fixed inset-0 z-50 bg-overlay/60 backdrop-blur-[2px] lg:hidden ${overlayClassName}`}
          onClick={close}
        >
          <aside
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={t.menu}
            className={`anim-drawer-in-left absolute left-0 top-0 flex h-full w-[86vw] max-w-[320px] flex-col rounded-r-3xl bg-card shadow-xl ${panelClassName}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-border/70 px-5 py-3">
              <span className="min-w-0 truncate font-display text-lg font-semibold text-text-main">
                {brandName}
              </span>
              <button
                ref={closeRef}
                type="button"
                onClick={close}
                aria-label={t.close}
                className="focus-ring flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-xl text-text-muted transition hover:bg-surface-2 hover:text-text-main"
              >
                <Icon name="x" size={20} />
              </button>
            </div>

            <nav aria-label={t.menu} className="min-h-0 flex-1 overflow-y-auto px-2 py-2 pb-safe-floor">
              {/* Shortcuts (§3.3) */}
              <div>
                {shortcuts.map((s) => (
                  <Link
                    key={s.href}
                    href={s.href}
                    aria-current={isActive(s.href) ? "page" : undefined}
                    className={`${ROW_CLASS} ${isActive(s.href) ? "font-semibold text-primary" : ""}`}
                  >
                    <Icon name={s.icon} size={20} />
                    <span className="min-w-0 truncate">{s.label}</span>
                  </Link>
                ))}
              </div>

              {/* CMS menu */}
              <h3 className={HEADING_CLASS}>{t.menu}</h3>
              <div>
                {navItems.map((item) => (
                  <div key={item.id}>
                    <Link
                      href={item.href}
                      aria-current={isActive(item.href) ? "page" : undefined}
                      className={`${ROW_CLASS} ${isActive(item.href) ? "font-semibold text-primary" : ""}`}
                    >
                      <span className="min-w-0 truncate">{menuLabel(item)}</span>
                    </Link>
                    {item.children.map((child) => (
                      <Link
                        key={child.id}
                        href={child.href}
                        aria-current={isActive(child.href) ? "page" : undefined}
                        className={`${SUB_ROW_CLASS} ${isActive(child.href) ? "font-semibold text-primary" : ""}`}
                      >
                        <span className="min-w-0 truncate">{menuLabel(child)}</span>
                      </Link>
                    ))}
                  </div>
                ))}
              </div>

              {/* Category tree */}
              {categories === undefined || categories.length > 0 ? (
                <>
                  <h3 className={HEADING_CLASS}>{t.categories}</h3>
                  <div>
                    {categories === undefined ? (
                      <p className="px-3 py-2 text-sm text-text-subtle">{t.loading}</p>
                    ) : (
                      categories.map((c) => (
                        <div key={c.slug}>
                          <Link href={`/shop?category=${c.slug}`} className={ROW_CLASS}>
                            <span className="min-w-0 truncate">{c.name[locale] || c.name.bn}</span>
                          </Link>
                          {c.children.map((child) => (
                            <Link
                              key={child.slug}
                              href={`/shop?category=${child.slug}`}
                              className={SUB_ROW_CLASS}
                            >
                              <span className="min-w-0 truncate">
                                {child.name[locale] || child.name.bn}
                              </span>
                            </Link>
                          ))}
                        </div>
                      ))
                    )}
                  </div>
                </>
              ) : null}
            </nav>

            {footer ? (
              <div className="border-t border-border/70 bg-surface-2/60 px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                {footer}
              </div>
            ) : null}
          </aside>
        </div>
      ) : null}
    </>
  );
}
