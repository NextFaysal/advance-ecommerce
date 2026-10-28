/**
 * AdminCommandPalette — Design v3 (Admin ⌘K palette).
 *
 * Opens on Cmd+K / Ctrl+K from anywhere in the admin shell, or from the
 * topbar search trigger (`CommandPaletteTrigger`, which dispatches the
 * OPEN_EVENT below). Two result groups:
 *
 *   পেজ (pages) — jump actions filtered locally from the SAME nav config
 *   the sidebar renders (src/admin-nav/config ADMIN_NAV), so palette and
 *   sidebar can never disagree. Locked add-ons stay listed with a lock
 *   badge, exactly like the sidebar.
 *
 *   রেকর্ড (records) — live, debounced (250ms) read-only search against
 *   the same admin list endpoints the list pages call:
 *     orders    GET /api/v1/admin/orders?search=<q>&pageSize=5
 *     customers GET /api/v1/admin/customers?search=<q>&pageSize=5
 *     products  GET /api/v1/admin/products?q=<q>&status=ACTIVE&pageSize=5
 *   (The orders endpoint accepts `search` and `q` as the same server
 *   search — order no / phone suffix / district; the orders list page
 *   sends `q`.) Top 5 per type. Order rows render the OD0
 *   OrderStatusBadge. Phones arrive masked from the APIs and are passed
 *   through displayPhone() again — a full number is never rendered here.
 *
 *   সাম্প্রতিক (recent) — OD8 (doc 19 S8): the last 5 orders opened
 *   from this palette, remembered in localStorage (this browser only;
 *   order no / customer / status / total — never a phone). Shown when
 *   the query is empty.
 *
 * Keyboard: ↑/↓ move (wrap-around), Enter opens, Esc closes. Mouse hover
 * syncs the active row. No server data is written anywhere; navigation
 * only (recents are a local browser convenience).
 *
 * NOTE: this replaces the older src/command-palette module as the
 * shell's palette (the layout mounts this one). The old module is left
 * on disk untouched.
 */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ADMIN_NAV, isLockedAddOn, isLockedAddOnNow, navItemLabel, type AdminNavItem } from "@/admin-nav/config";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick, type Locale } from "@/i18n/locale";
import { ADMIN_STRINGS, type AdminStrings } from "@/admin/strings";
import { Icon, type IconName } from "@/components/ui/icon";
import type { Customer, Order, OrderStatus } from "@/orders/types";
import { displayPhone } from "@/orders/customer";
import { formatBdt } from "@/checkout/pricing";
import { minVariantPricePoisha, type Product } from "@/catalog/types";
import { OrderStatusBadge } from "@/orders/components/OrderStatusBadge";

/** Window event the topbar trigger dispatches to open the palette. */
export const OPEN_COMMAND_PALETTE_EVENT = "admin:open-command-palette";

const RECORD_LIMIT = 5;
const DEBOUNCE_MS = 250;

type PaletteGroupId = "recent" | "pages" | "orders" | "products" | "customers";

interface PaletteEntry {
  id: string;
  group: PaletteGroupId;
  title: string;
  subtitle?: string;
  href: string;
  icon: IconName;
  locked?: boolean;
  /** Orders only: rendered as the OD0 OrderStatusBadge in the row. */
  orderStatus?: OrderStatus;
  /** Orders only: the snapshot kept for the সাম্প্রতিক (recent) list. */
  orderSnapshot?: RecentOrder;
}

/** One remembered order for the recent list — only what the orders
 *  list payload already shows (no phone is ever stored). */
interface RecentOrder {
  id: string;
  orderNo: string;
  customerName: string;
  status: OrderStatus;
  totalPoisha: number;
}

const RECENTS_KEY = "admin-palette:recent-orders";
const RECENT_LIMIT = 5;

function loadRecents(): RecentOrder[] {
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentOrder[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((r) => r && typeof r.id === "string" && typeof r.orderNo === "string")
      .slice(0, RECENT_LIMIT);
  } catch {
    return [];
  }
}

function saveRecent(order: RecentOrder): RecentOrder[] {
  const next = [order, ...loadRecents().filter((r) => r.id !== order.id)].slice(0, RECENT_LIMIT);
  try {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    // Private mode / quota — recents are a convenience, never fatal.
  }
  return next;
}

interface PaletteGroup {
  id: PaletteGroupId;
  label: string;
  entries: PaletteEntry[];
}

interface RecordResults {
  orders: Order[];
  customers: Customer[];
  products: Product[];
}

const EMPTY_RECORDS: RecordResults = { orders: [], customers: [], products: [] };

function pageEntries(
  query: string,
  locale: Locale,
  offFlags: ReadonlySet<string> | null,
): PaletteEntry[] {
  const needle = query.trim().toLowerCase();
  const items: AdminNavItem[] =
    needle.length === 0
      ? [...ADMIN_NAV]
      : ADMIN_NAV.filter(
          (item) =>
            item.labelBn.toLowerCase().includes(needle) ||
            item.labelEn.toLowerCase().includes(needle) ||
            item.path.toLowerCase().includes(needle) ||
            item.id.toLowerCase().includes(needle),
        );
  return items.map((item) => ({
    id: `page:${item.id}`,
    group: "pages" as const,
    title: navItemLabel(item, locale),
    subtitle: item.path,
    href: item.path,
    icon: "arrow-right" as IconName,
    // Live lock state when the layout supplied the off-flag set;
    // the static catalogue check is only a fallback for a palette
    // mounted without it.
    locked: offFlags ? isLockedAddOnNow(item, offFlags) : isLockedAddOn(item),
  }));
}

function orderEntries(orders: Order[]): PaletteEntry[] {
  return orders.slice(0, RECORD_LIMIT).map((o) => ({
    id: `order:${o.id}`,
    group: "orders" as const,
    title: o.orderNo,
    subtitle: `${o.customerName} · ${displayPhone(o.customerPhone, false)} · ${formatBdt(o.totalPoisha)}`,
    href: `/admin/orders/${o.id}`,
    icon: "cart" as IconName,
    orderStatus: o.status,
    orderSnapshot: {
      id: o.id,
      orderNo: o.orderNo,
      customerName: o.customerName,
      status: o.status,
      totalPoisha: o.totalPoisha,
    },
  }));
}

function recentEntries(recents: RecentOrder[]): PaletteEntry[] {
  return recents.map((r) => ({
    id: `recent:${r.id}`,
    group: "recent" as const,
    title: r.orderNo,
    subtitle: `${r.customerName} · ${formatBdt(r.totalPoisha)}`,
    href: `/admin/orders/${r.id}`,
    icon: "clock" as IconName,
    orderStatus: r.status,
    orderSnapshot: r,
  }));
}

function productEntries(products: Product[], s: AdminStrings, locale: Locale): PaletteEntry[] {
  return products.slice(0, RECORD_LIMIT).map((p) => {
    const context = p.brandName ?? p.categoryName?.[locale] ?? p.categoryName?.bn ?? p.categoryName?.en ?? "";
    return {
      id: `product:${p.id}`,
      group: "products" as const,
      title: p.title[locale] ?? p.title.bn,
      subtitle: `${context ? `${context} · ` : ""}${formatBdt(minVariantPricePoisha(p))} ${s.paletteFrom}`,
      href: "/admin/products",
      icon: "package" as IconName,
    };
  });
}

function customerEntries(customers: Customer[], s: AdminStrings): PaletteEntry[] {
  return customers.slice(0, RECORD_LIMIT).map((c) => ({
    id: `customer:${c.id}`,
    group: "customers" as const,
    title: c.name,
    subtitle: `${displayPhone(c.phone, false)} · ${interpolate(s.paletteOrdersSuffix, { count: c.totalOrders, total: formatBdt(c.lifetimeValuePoisha) })}`,
    href: `/admin/customers?search=${encodeURIComponent(c.name)}`,
    icon: "users" as IconName,
  }));
}

async function fetchJson<T>(url: string): Promise<T[]> {
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const body = (await res.json().catch(() => null)) as { data?: T[] } | null;
    return body?.data ?? [];
  } catch {
    return [];
  }
}

export function AdminCommandPalette({
  offFeatureFlags,
}: {
  /** Feature-flag keys currently OFF, resolved live by the admin
   *  layout and forwarded through command-palette-lazy; page entries
   *  show the add-on chip only while the module's flag is OFF. */
  offFeatureFlags?: readonly string[];
} = {}) {
  const { locale } = useLocale();
  const offFlags = offFeatureFlags ? new Set(offFeatureFlags) : null;
  const s = pick(locale, ADMIN_STRINGS);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [records, setRecords] = useState<RecordResults>(EMPTY_RECORDS);
  const [recents, setRecents] = useState<RecentOrder[]>([]);
  const [searching, setSearching] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef(0);

  /* Open triggers: ⌘K / Ctrl+K toggle + the topbar trigger event. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    const onOpenEvent = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpenEvent);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpenEvent);
    };
  }, []);

  /* Fresh state + autofocus on every open. Recents are read here
   * (not during render) so localStorage is only touched client-side
   * after the palette actually opens. */
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setRecords(EMPTY_RECORDS);
    setRecents(loadRecents());
    setSearching(false);
    setActiveIndex(0);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(timer);
  }, [open ]);

  /* Debounced live record search (250ms); stale responses are dropped
   * via the request counter, so a slow earlier query can never
   * overwrite a newer one. */
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length === 0) {
      setRecords(EMPTY_RECORDS);
      setSearching(false);
      return;
    }
    setSearching(true);
    const requestId = ++requestRef.current;
    const timer = window.setTimeout(() => {
      const enc = encodeURIComponent(q);
      void Promise.all([
        fetchJson<Order>(`/api/v1/admin/orders?search=${enc}&pageSize=${RECORD_LIMIT}`),
        fetchJson<Customer>(`/api/v1/admin/customers?search=${enc}&pageSize=${RECORD_LIMIT}`),
        fetchJson<Product>(`/api/v1/admin/products?q=${enc}&status=ACTIVE&pageSize=${RECORD_LIMIT}`),
      ]).then(([orders, customers, products]) => {
        if (requestRef.current !== requestId) return;
        setRecords({ orders, customers, products });
        setSearching(false);
      });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query, open]);

  const groups = useMemo<PaletteGroup[]>(() => {
    const all: PaletteGroup[] = [
      // Recents only make sense before the staff member starts
      // typing; a live search replaces them.
      ...(query.trim().length === 0
        ? [{ id: "recent" as const, label: s.paletteRecent, entries: recentEntries(recents) }]
        : []),
      { id: "pages", label: s.palettePages, entries: pageEntries(query, locale, offFlags) },
      { id: "orders", label: s.paletteOrders, entries: orderEntries(records.orders) },
      { id: "products", label: s.paletteProducts, entries: productEntries(records.products, s, locale) },
      { id: "customers", label: s.paletteCustomers, entries: customerEntries(records.customers, s) },
    ];
    return all.filter((g) => g.entries.length > 0);
  }, [query, records, recents, s, locale]);

  const flat = useMemo(() => groups.flatMap((g) => g.entries), [groups]);

  /* Keep the active row valid as results change. */
  useEffect(() => {
    setActiveIndex((prev) => (flat.length === 0 ? 0 : Math.min(prev, flat.length - 1)));
  }, [flat.length]);

  /* Scroll the active row into view. */
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector(`[data-palette-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  const activate = (entry: PaletteEntry | undefined) => {
    if (!entry) return;
    if (entry.orderSnapshot) setRecents(saveRecent(entry.orderSnapshot));
    setOpen(false);
    router.push(entry.href);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((prev) => (flat.length === 0 ? 0 : (prev + 1) % flat.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((prev) => (flat.length === 0 ? 0 : (prev - 1 + flat.length) % flat.length));
    } else if (event.key === "Enter") {
      event.preventDefault();
      activate(flat[activeIndex]);
    }
  };

  if (!open) return null;

  const hasQuery = query.trim().length > 0;
  let flatIndex = -1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[10vh]"
      role="dialog"
      aria-modal="true"
      aria-label={s.paletteLabel}
      onKeyDown={onKeyDown}
    >
      {/* Backdrop — click closes */}
      <button
        type="button"
        aria-label={s.close}
        className="absolute inset-0 cursor-default bg-brand-900/40 backdrop-blur-[2px]"
        onClick={() => setOpen(false)}
      />
      <div className="anim-pop-in relative w-full max-w-xl overflow-hidden rounded-lg border border-border bg-card shadow-pop">
        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-border px-4">
          <span aria-hidden="true" className="shrink-0 text-text-subtle">
            <Icon name="search" size={20} />
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            placeholder={s.palettePlaceholder}
            aria-label={s.palettePlaceholder}
            role="combobox"
            aria-expanded="true"
            aria-controls="admin-palette-results"
            className="h-14 w-full bg-transparent text-[15px] text-text-main outline-none placeholder:text-text-subtle"
          />
          {searching ? (
            <span aria-hidden="true" className="shrink-0 animate-spin text-brand-600">
              <Icon name="spinner" size={18} />
            </span>
          ) : null}
          <kbd className="hidden shrink-0 rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-caption text-text-muted sm:block">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div
          ref={listRef}
          id="admin-palette-results"
          role="listbox"
          aria-label={s.paletteResultsLabel}
          className="max-h-[52vh] overflow-y-auto p-2"
        >
          {searching && flat.length === 0 ? (
            <p role="status" className="px-3 py-8 text-center text-small text-text-muted">
              {s.paletteSearching}
            </p>
          ) : null}

          {groups.map((group) => (
            <div key={group.id} className="mb-1 last:mb-0">
              <p className="px-3 pb-1 pt-2.5 text-caption font-semibold tracking-wide text-text-subtle">
                {group.label}
              </p>
              <ul className="space-y-0.5">
                {group.entries.map((entry) => {
                  flatIndex += 1;
                  const indexAtRender = flatIndex;
                  const active = indexAtRender === activeIndex;
                  return (
                    <li key={entry.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={active}
                        data-palette-index={indexAtRender}
                        className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition motion-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 ${
                          active ? "bg-brand-50 text-brand-700" : "text-text-main hover:bg-surface-2"
                        }`}
                        onMouseEnter={() => setActiveIndex(indexAtRender)}
                        onClick={() => activate(entry)}
                      >
                        <span
                          aria-hidden="true"
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] ${
                            active ? "bg-brand-100 text-brand-700" : "bg-surface-2 text-text-muted"
                          }`}
                        >
                          <Icon name={entry.icon} size={18} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium leading-snug">{entry.title}</span>
                          {entry.subtitle ? (
                            <span className="block truncate text-caption text-text-muted">{entry.subtitle}</span>
                          ) : null}
                        </span>
                        {entry.orderStatus ? (
                          <span className="shrink-0">
                            <OrderStatusBadge status={entry.orderStatus} />
                          </span>
                        ) : null}
                        {entry.locked ? (
                          <span className="flex shrink-0 items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-caption font-semibold text-amber-700">
                            {s.paletteAddOn}
                          </span>
                        ) : null}
                        {active ? (
                          <span aria-hidden="true" className="shrink-0 text-brand-500">
                            <Icon name="arrow-right" size={16} />
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}

          {!searching && hasQuery && flat.length === 0 ? (
            <div className="px-6 py-10 text-center">
              <span
                aria-hidden="true"
                className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-brand-500"
              >
                <Icon name="search" size={24} />
              </span>
              <p className="mt-3 text-small font-semibold">{s.paletteNoResults}</p>
              <p className="mx-auto mt-1 max-w-xs text-caption leading-relaxed text-text-muted">
                {interpolate(s.paletteNoResultsDesc, { query: query.trim() })}
              </p>
            </div>
          ) : null}

          {!hasQuery ? (
            <p className="px-3 pb-2 pt-1 text-caption text-text-subtle">
              {s.paletteHint}
            </p>
          ) : null}
        </div>

        {/* Footer hints */}
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border bg-surface-2/60 px-4 py-2.5 text-caption text-text-muted">
          <span>{s.paletteNavigate}</span>
          <span>{s.paletteOpen}</span>
          <span>{s.paletteCloseHint}</span>
          <span className="ml-auto hidden sm:inline">{s.paletteShortcut}</span>
        </p>
      </div>
    </div>
  );
}

/**
 * CommandPaletteTrigger lives in ./command-palette-trigger — it was
 * moved out (admin perf wave) so the Topbar's import of the trigger
 * does not drag this whole palette module into the eager bundle of
 * every admin page; the palette itself is lazy-mounted via
 * app/admin/command-palette-lazy.
 */
