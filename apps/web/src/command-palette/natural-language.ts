/**
 * Natural-language palette results — Agent 28.
 *
 * Reuses the rule parser from src/ai/search (Agent 15) — imported, never
 * duplicated. It turns free text like "pending order Dhaka" or
 * "ajker delivered order Sylhet" into ONE extra result: a link to the
 * orders list carrying the parsed filters as query params
 * (?status=PENDING&district=Dhaka&date=today). The params are this
 * palette's link convention; the subtitle says plainly that it is a
 * filtered view so nobody mistakes it for a guaranteed server filter.
 *
 *   "#100245"            -> the matching demo order itself, else a
 *                           filtered orders link for that number
 *   "@nusrat"            -> customers link filtered by that name
 *   "> rider"            -> matching quick actions from the action list
 *   "gotokal er ..."     -> date hint yesterday, etc. (parser's job)
 */
import { parseCommandQuery, type ParsedCommandQuery } from "../ai/search";
import { MOCK_ORDERS } from "../orders/mock";
import { PALETTE_ACTIONS } from "./index-builder";
import { normalizeQueryText } from "./scoring";
import type { PaletteResult } from "./types";

const DATE_LABEL_BN: Record<string, string> = {
  today: "আজকের",
  yesterday: "গতকালের",
  last7days: "শেষ ৭ দিনের",
  last30days: "শেষ ৩০ দিনের",
};

function ordersHref(parsed: ParsedCommandQuery, fallbackText: string): string {
  const params = new URLSearchParams();
  if (parsed.status) params.set("status", parsed.status);
  if (parsed.district) params.set("district", parsed.district);
  if (parsed.date) params.set("date", parsed.date);
  if (parsed.orderNo) params.set("q", parsed.orderNo);
  else if (!parsed.status && !parsed.district && !parsed.date && fallbackText) {
    params.set("q", fallbackText);
  }
  const qs = params.toString();
  return qs ? `/admin/orders?${qs}` : "/admin/orders";
}

/**
 * Build the natural-language result(s) for a query, or [] when the
 * parser found nothing structured (pure free text is left to the fuzzy
 * search — it is never "interpreted" here).
 */
export function buildNaturalLanguageResults(queryRaw: string): PaletteResult[] {
  const parsed = parseCommandQuery(queryRaw);
  const results: PaletteResult[] = [];

  // "#100245" — jump straight to the order when the demo data has it.
  if (parsed.orderNo) {
    const match = MOCK_ORDERS.find((o) => o.orderNo.endsWith(parsed.orderNo ?? ""));
    if (match) {
      results.push({
        id: `nl:order:${match.id}`,
        group: "orders",
        titleBn: `${match.orderNo} খুলুন`,
        titleEn: `Open ${match.orderNo}`,
        subtitle: `${match.customerName} · ${match.status} · সরাসরি অর্ডার`,
        href: `/admin/orders/${match.id}`,
        icon: "ShoppingCart",
        keywords: [match.orderNo],
        source: "ai-search-parser",
      });
      return results;
    }
  }

  // "> action" prefix — match against the quick-action list.
  if (parsed.action) {
    const needle = normalizeQueryText(parsed.action);
    for (const action of PALETTE_ACTIONS) {
      const haystacks = [action.titleEn, action.id, ...action.keywords].map(normalizeQueryText);
      if (haystacks.some((h) => h.includes(needle))) {
        results.push({
          id: `nl:action:${action.id}`,
          group: "actions",
          titleBn: action.titleBn,
          titleEn: action.titleEn,
          subtitle: "কমান্ড (>) দিয়ে পাওয়া",
          href: action.href,
          icon: action.icon,
          keywords: action.keywords,
          source: "ai-search-parser",
        });
      }
    }
    if (results.length > 0) return results;
  }

  // "@name" — customer filter link.
  if (parsed.customerQuery) {
    results.push({
      id: `nl:customer:${parsed.customerQuery}`,
      group: "customers",
      titleBn: `গ্রাহক খুঁজুন: ${parsed.customerQuery}`,
      titleEn: `Find customer: ${parsed.customerQuery}`,
      subtitle: "নাম দিয়ে ফিল্টার করা গ্রাহক তালিকা",
      href: `/admin/customers?search=${encodeURIComponent(parsed.customerQuery)}`,
      icon: "Users",
      keywords: [parsed.customerQuery],
      source: "ai-search-parser",
    });
    return results;
  }

  // Status / district / date / order-number filters -> orders link.
  const hasFilter =
    parsed.status !== null || parsed.district !== null || parsed.date !== null || parsed.orderNo !== null;
  if (hasFilter) {
    const parts: string[] = [];
    if (parsed.date) parts.push(DATE_LABEL_BN[parsed.date] ?? "");
    if (parsed.status) parts.push(parsed.status);
    parts.push("অর্ডার");
    if (parsed.district) parts.push(`(${parsed.district})`);
    if (parsed.orderNo) parts.push(`#${parsed.orderNo}`);
    results.push({
      id: `nl:orders:${[parsed.status, parsed.district, parsed.date, parsed.orderNo].filter(Boolean).join(":")}`,
      group: "actions",
      titleBn: `${parts.filter(Boolean).join(" ")} দেখুন`,
      titleEn: "View filtered orders",
      subtitle: "প্রাকৃতিক ভাষা থেকে তৈরি ফিল্টার লিংক (ডেমো)",
      href: ordersHref(parsed, parsed.text),
      icon: "ListFilter",
      keywords: [parsed.text],
      source: "ai-search-parser",
    });
  }

  return results;
}
