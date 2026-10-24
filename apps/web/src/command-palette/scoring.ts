/**
 * Fuzzy scoring for the command palette — Agent 28. Pure, deterministic.
 *
 * Scoring (per searchable field, best field wins per tier):
 *   100  field equals the query exactly
 *    85  field starts with the query (prefix)
 *    65  a word in the field starts with the query
 *    50  field contains the query as a substring
 *    40  every query token appears somewhere in the combined fields
 *    25  some (not all) query tokens appear — scaled by token coverage
 *    15  query is a subsequence of the field (t-y-p-o tolerant last resort)
 *     0  no match — the result is excluded
 *
 * Primary fields (title bn/en) score full; secondary fields (keywords)
 * score at most 60 so a keyword hit never outranks a real title hit.
 * Ties break deterministically: score desc -> group order -> bn title
 * (localeCompare) -> id. Same input always yields the same ranking,
 * which is what makes the palette's Enter target predictable.
 */
import { PALETTE_GROUP_ORDER, type PaletteGroupId, type PaletteResult } from "./types";

/** Lowercase, trim, collapse whitespace. Bangla text is left intact
 *  (case folding is a no-op for it); Bangla digits fold to Latin so
 *  "১০০২৪৫" still finds ORD-100245. */
export function normalizeQueryText(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d)))
    .replace(/\s+/g, " ");
}

export function tokenize(raw: string): string[] {
  const normalized = normalizeQueryText(raw);
  return normalized.length === 0 ? [] : normalized.split(" ");
}

function isSubsequence(needle: string, haystack: string): boolean {
  if (needle.length === 0) return true;
  let i = 0;
  for (const ch of haystack) {
    if (ch === needle[i]) i += 1;
    if (i === needle.length) return true;
  }
  return false;
}

function scoreField(query: string, tokens: readonly string[], field: string): number {
  const f = normalizeQueryText(field);
  if (f.length === 0) return 0;
  if (f === query) return 100;
  if (f.startsWith(query)) return 85;
  const words = f.split(/[\s\-_/]+/).filter((w) => w.length > 0);
  if (words.some((w) => w.startsWith(query))) return 65;
  if (f.includes(query)) return 50;
  if (tokens.length > 1) {
    const present = tokens.filter((t) => f.includes(t)).length;
    if (present === tokens.length) return 40;
    if (present > 0) return Math.round(25 * (present / tokens.length));
  }
  // Subsequence only helps single-token queries; keep it weak.
  if (!query.includes(" ") && query.length >= 3 && isSubsequence(query, f)) return 15;
  return 0;
}

/** Best score for a result against a raw query. 0 = excluded. */
export function scoreResult(
  queryRaw: string,
  result: Pick<PaletteResult, "titleBn" | "titleEn" | "keywords">,
): number {
  const query = normalizeQueryText(queryRaw);
  if (query.length === 0) return 0;
  const tokens = tokenize(queryRaw);
  const primary = Math.max(
    scoreField(query, tokens, result.titleBn),
    scoreField(query, tokens, result.titleEn),
  );
  if (primary > 0) return primary;
  let keywordBest = 0;
  for (const keyword of result.keywords) {
    keywordBest = Math.max(keywordBest, scoreField(query, tokens, keyword));
  }
  // Combined-field token match lives in scoreField via the joined string.
  const combined = result.keywords.join(" ");
  keywordBest = Math.max(keywordBest, scoreField(query, tokens, combined));
  return Math.min(keywordBest, 60);
}

export interface ScoredResult {
  result: PaletteResult;
  score: number;
}

const GROUP_RANK: Record<PaletteGroupId, number> = Object.fromEntries(
  PALETTE_GROUP_ORDER.map((group, i) => [group, i]),
) as Record<PaletteGroupId, number>;

/**
 * Search a palette index. Deterministic ordering: score desc, then the
 * fixed group order, then bn title, then id. `limit` caps the total
 * (default 12) so the palette stays scannable; per-group limits keep one
 * group from crowding out the rest (default 5 each, pages 6).
 */
export function searchPalette(
  index: readonly PaletteResult[],
  queryRaw: string,
  options?: { limit?: number; perGroupLimit?: number },
): ScoredResult[] {
  const limit = options?.limit ?? 12;
  const perGroupLimit = options?.perGroupLimit ?? 5;
  const scored: ScoredResult[] = [];
  for (const result of index) {
    const score = scoreResult(queryRaw, result);
    if (score > 0) scored.push({ result, score });
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const groupDiff = GROUP_RANK[a.result.group] - GROUP_RANK[b.result.group];
    if (groupDiff !== 0) return groupDiff;
    const titleDiff = a.result.titleBn.localeCompare(b.result.titleBn);
    if (titleDiff !== 0) return titleDiff;
    return a.result.id.localeCompare(b.result.id);
  });
  const perGroupCount = new Map<PaletteGroupId, number>();
  const kept: ScoredResult[] = [];
  for (const entry of scored) {
    if (kept.length >= limit) break;
    const count = perGroupCount.get(entry.result.group) ?? 0;
    if (count >= perGroupLimit) continue;
    perGroupCount.set(entry.result.group, count + 1);
    kept.push(entry);
  }
  return kept;
}

/** Re-group a flat scored list for rendering, in the fixed group order. */
export function groupScoredResults(
  scored: readonly ScoredResult[],
): Array<{ group: PaletteGroupId; entries: ScoredResult[] }> {
  const byGroup = new Map<PaletteGroupId, ScoredResult[]>();
  for (const entry of scored) {
    const list = byGroup.get(entry.result.group) ?? [];
    list.push(entry);
    byGroup.set(entry.result.group, list);
  }
  return PALETTE_GROUP_ORDER.filter((group) => byGroup.has(group)).map((group) => ({
    group,
    entries: byGroup.get(group) ?? [],
  }));
}
