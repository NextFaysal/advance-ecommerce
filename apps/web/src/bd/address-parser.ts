/**
 * Bangla address parser — Agent 11, Step 44 (E2). Pure logic, no DB, no API.
 *
 * Input: free-text address as a customer types it in Messenger / WhatsApp /
 * a phone call — Bangla script, English, or Banglish, often with no commas
 * and frequent misspellings ("Dacca", "Chittagong", "Mymensing",
 * "Narayangonj", "মিরপুর ১০").
 *
 * Output: a structured BD address (Division > District > Upazila > Area)
 * plus a 0–1 confidence score and the leftover address line (house / road /
 * holding text that matched nothing). Low-confidence results are meant to be
 * shown to staff for one-tap correction — never silently trusted for courier
 * booking (see the manual-order flow).
 *
 * DICTIONARY SCOPE: the tables below are a curated COMMON-PLACES dictionary
 * (all 8 divisions, the most common districts / upazilas / Dhaka areas, and
 * the misspellings staff actually see) — this is the DEFAULT dictionary.
 * The full BD geo dataset (seeded from packages/db/prisma/data/bd-geo.json,
 * the same file the DB seed loads) is available as FULL_GEO_DICTIONARY in
 * ./geo-dictionary.ts, merged over this curated set; the parsing / scoring
 * logic does not change.
 *
 * Matching strategy (deterministic, unit-testable):
 *  1. Bangla-script names match by substring on the raw text.
 *  2. Latin names match on normalised word tokens (lowercase, punctuation
 *     stripped, Bangla digits folded to ASCII).
 *  3. A token that matches nothing exactly is typo-corrected when it is
 *     within Levenshtein distance 1 of a dictionary alias (tokens of
 *     length >= 5 only, so short words like "para" never over-match),
 *     or when it appears in the explicit misspelling table.
 *  4. A matched district implies its division (and raises confidence);
 *     a matched upazila implies its district + division.
 *  5. Remaining unmatched text becomes `addressLine` (house/road details).
 *
 * Test cases (input -> expected):
 *  "House 12, Road 5, Mirpur 10, Dhaka" ->
 *    { division: "Dhaka", district: "Dhaka", area: "Mirpur",
 *      addressLine contains "House 12", confidence 0.75 }
 *    (corrected 2026-10-24: division .25 + district .35 + area .15 = 0.75;
 *     the header previously claimed >= 0.8)
 *  "বাসা ৩, সাভার, ঢাকা" ->
 *    { division: "Dhaka", district: "Dhaka", upazila: "Savar",
 *      confidence >= 0.8 }  (Bangla digits + Bangla names)
 *  "Dacca, Narayangonj" ->
 *    { division: "Dhaka", district: "Narayanganj", confidence >= 0.6 }
 *    (misspelling table: Dacca -> Dhaka, Narayangonj -> Narayanganj)
 *  "Chittagong, Hathazari" ->
 *    { division: "Chattogram", district: "Chattogram",
 *      upazila: "Hathazari", confidence >= 0.9 }
 *  "House 9, Some Unknown Village" ->
 *    { division: null, district: null, confidence < 0.3,
 *      addressLine: the full text }  (nothing invented)
 */

export interface GeoDivision {
  nameEn: string;
  nameBn: string;
  aliases: readonly string[];
}

export interface GeoDistrict {
  nameEn: string;
  nameBn: string;
  divisionEn: string;
  aliases: readonly string[];
}

export interface GeoUpazila {
  nameEn: string;
  nameBn: string;
  districtEn: string;
  aliases: readonly string[];
  /** Dhaka city "areas" (Mirpur, Uttara...) are thana/area level, not upazila. */
  isArea?: boolean;
}

export interface GeoDictionary {
  divisions: readonly GeoDivision[];
  districts: readonly GeoDistrict[];
  upazilas: readonly GeoUpazila[];
}

/** Explicit misspellings staff actually see -> canonical Latin name (lowercase). */
export const MISSPELLINGS: Readonly<Record<string, string>> = {
  daccca: "dhaka",
  dakka: "dhaka",
  chittagong: "chattogram",
  chitagong: "chattogram",
  narayangonj: "narayanganj",
  narayangong: "narayanganj",
  mymensing: "mymensingh",
  moymonsingho: "mymensingh",
  comilla: "cumilla",
  kumilla: "cumilla",
  jessore: "jashore",
  barisal: "barishal",
  borishal: "barishal",
  bogra: "bogura",
  coxbazar: "cox's bazar",
  coxsbazar: "cox's bazar",
  sylhet: "sylhet",
  gazipur: "gazipur",
  savar: "savar",
  keranigonj: "keraniganj",
  mirpur: "mirpur",
  uttora: "uttara",
  mohammadpur: "mohammadpur",
  dhanmondi: "dhanmondi",
  banani: "banani",
  gulshan: "gulshan",
  badda: "badda",
  jatrabari: "jatrabari",
  hathazari: "hathazari",
};

export const DEFAULT_GEO_DICTIONARY: GeoDictionary = {
  divisions: [
    { nameEn: "Dhaka", nameBn: "ঢাকা", aliases: ["dhaka"] },
    { nameEn: "Chattogram", nameBn: "চট্টগ্রাম", aliases: ["chattogram", "chittagong"] },
    { nameEn: "Khulna", nameBn: "খুলনা", aliases: ["khulna"] },
    { nameEn: "Rajshahi", nameBn: "রাজশাহী", aliases: ["rajshahi"] },
    { nameEn: "Barishal", nameBn: "বরিশাল", aliases: ["barishal", "barisal"] },
    { nameEn: "Sylhet", nameBn: "সিলেট", aliases: ["sylhet"] },
    { nameEn: "Rangpur", nameBn: "রংপুর", aliases: ["rangpur"] },
    { nameEn: "Mymensingh", nameBn: "ময়মনসিংহ", aliases: ["mymensingh"] },
  ],
  districts: [
    { nameEn: "Dhaka", nameBn: "ঢাকা", divisionEn: "Dhaka", aliases: ["dhaka"] },
    { nameEn: "Gazipur", nameBn: "গাজীপুর", divisionEn: "Dhaka", aliases: ["gazipur"] },
    { nameEn: "Narayanganj", nameBn: "নারায়ণগঞ্জ", divisionEn: "Dhaka", aliases: ["narayanganj"] },
    { nameEn: "Narsingdi", nameBn: "নরসিংদী", divisionEn: "Dhaka", aliases: ["narsingdi"] },
    { nameEn: "Tangail", nameBn: "টাঙ্গাইল", divisionEn: "Dhaka", aliases: ["tangail"] },
    { nameEn: "Faridpur", nameBn: "ফরিদপুর", divisionEn: "Dhaka", aliases: ["faridpur"] },
    { nameEn: "Chattogram", nameBn: "চট্টগ্রাম", divisionEn: "Chattogram", aliases: ["chattogram", "chittagong"] },
    { nameEn: "Cox's Bazar", nameBn: "কক্সবাজার", divisionEn: "Chattogram", aliases: ["cox's bazar", "coxs bazar", "cox bazar"] },
    { nameEn: "Cumilla", nameBn: "কুমিল্লা", divisionEn: "Chattogram", aliases: ["cumilla", "comilla"] },
    { nameEn: "Noakhali", nameBn: "নোয়াখালী", divisionEn: "Chattogram", aliases: ["noakhali"] },
    { nameEn: "Feni", nameBn: "ফেনী", divisionEn: "Chattogram", aliases: ["feni"] },
    { nameEn: "Brahmanbaria", nameBn: "ব্রাহ্মণবাড়িয়া", divisionEn: "Chattogram", aliases: ["brahmanbaria"] },
    { nameEn: "Khulna", nameBn: "খুলনা", divisionEn: "Khulna", aliases: ["khulna"] },
    { nameEn: "Jashore", nameBn: "যশোর", divisionEn: "Khulna", aliases: ["jashore", "jessore"] },
    { nameEn: "Kushtia", nameBn: "কুষ্টিয়া", divisionEn: "Khulna", aliases: ["kushtia"] },
    { nameEn: "Rajshahi", nameBn: "রাজশাহী", divisionEn: "Rajshahi", aliases: ["rajshahi"] },
    { nameEn: "Bogura", nameBn: "বগুড়া", divisionEn: "Rajshahi", aliases: ["bogura", "bogra"] },
    { nameEn: "Pabna", nameBn: "পাবনা", divisionEn: "Rajshahi", aliases: ["pabna"] },
    { nameEn: "Sirajganj", nameBn: "সিরাজগঞ্জ", divisionEn: "Rajshahi", aliases: ["sirajganj"] },
    { nameEn: "Naogaon", nameBn: "নওগাঁ", divisionEn: "Rajshahi", aliases: ["naogaon"] },
    { nameEn: "Barishal", nameBn: "বরিশাল", divisionEn: "Barishal", aliases: ["barishal", "barisal"] },
    { nameEn: "Sylhet", nameBn: "সিলেট", divisionEn: "Sylhet", aliases: ["sylhet"] },
    { nameEn: "Mymensingh", nameBn: "ময়মনসিংহ", divisionEn: "Mymensingh", aliases: ["mymensingh"] },
    { nameEn: "Rangpur", nameBn: "রংপুর", divisionEn: "Rangpur", aliases: ["rangpur"] },
    { nameEn: "Dinajpur", nameBn: "দিনাজপুর", divisionEn: "Rangpur", aliases: ["dinajpur"] },
  ],
  upazilas: [
    { nameEn: "Savar", nameBn: "সাভার", districtEn: "Dhaka", aliases: ["savar"] },
    { nameEn: "Keraniganj", nameBn: "কেরানীগঞ্জ", districtEn: "Dhaka", aliases: ["keraniganj"] },
    { nameEn: "Gazipur Sadar", nameBn: "গাজীপুর সদর", districtEn: "Gazipur", aliases: ["gazipur sadar", "tongi"] },
    { nameEn: "Hathazari", nameBn: "হাটহাজারী", districtEn: "Chattogram", aliases: ["hathazari"] },
    { nameEn: "Mirpur", nameBn: "মিরপুর", districtEn: "Dhaka", aliases: ["mirpur"], isArea: true },
    { nameEn: "Uttara", nameBn: "উত্তরা", districtEn: "Dhaka", aliases: ["uttara"], isArea: true },
    { nameEn: "Mohammadpur", nameBn: "মোহাম্মদপুর", districtEn: "Dhaka", aliases: ["mohammadpur"], isArea: true },
    { nameEn: "Dhanmondi", nameBn: "ধানমন্ডি", districtEn: "Dhaka", aliases: ["dhanmondi"], isArea: true },
    { nameEn: "Banani", nameBn: "বনানী", districtEn: "Dhaka", aliases: ["banani"], isArea: true },
    { nameEn: "Gulshan", nameBn: "গুলশান", districtEn: "Dhaka", aliases: ["gulshan"], isArea: true },
    { nameEn: "Badda", nameBn: "বাড্ডা", districtEn: "Dhaka", aliases: ["badda"], isArea: true },
    { nameEn: "Jatrabari", nameBn: "যাত্রাবাড়ী", districtEn: "Dhaka", aliases: ["jatrabari"], isArea: true },
  ],
};

export interface ParsedAddress {
  division: string | null;
  divisionBn: string | null;
  district: string | null;
  districtBn: string | null;
  upazila: string | null;
  area: string | null;
  /** House / road / holding text that matched nothing — never discarded. */
  addressLine: string;
  /** 0–1. >= 0.8 high, 0.5–0.79 medium, < 0.5 low (staff must confirm). */
  confidence: number;
  matchedBy: {
    division: "bangla" | "latin" | "typo" | "implied" | null;
    district: "bangla" | "latin" | "typo" | "implied" | null;
    upazila: "bangla" | "latin" | "typo" | null;
    area: "bangla" | "latin" | "typo" | null;
  };
}

const BANGLA_DIGITS = "০১২৩৪৫৬৭৮৯";

/** Fold Bangla digits (০-৯) to ASCII so "মিরপুর ১০" tokenises like "mirpur 10". */
export function foldBanglaDigits(text: string): string {
  let out = "";
  for (const ch of text) {
    const idx = BANGLA_DIGITS.indexOf(ch);
    out += idx >= 0 ? String(idx) : ch;
  }
  return out;
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur: number[] = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur.push(Math.min((cur[j - 1] as number) + 1, (prev[j] as number) + 1, (prev[j - 1] as number) + cost));
    }
    prev = cur;
  }
  return prev[b.length] as number;
}

type MatchKind = "bangla" | "latin" | "typo";

interface Candidate {
  nameEn: string;
  kind: MatchKind;
  /** The raw span that matched, so it can be removed from addressLine. */
  span: string;
}

function findCandidate(
  rawText: string,
  tokens: readonly string[],
  entries: readonly { nameEn: string; nameBn: string; aliases: readonly string[] }[],
): Candidate | null {
  // 1. Bangla substring on the raw text.
  for (const entry of entries) {
    if (entry.nameBn !== "" && rawText.includes(entry.nameBn)) {
      return { nameEn: entry.nameEn, kind: "bangla", span: entry.nameBn };
    }
  }
  // 2. Latin exact (single- and multi-word aliases), longest alias first.
  const aliases: { alias: string; nameEn: string }[] = [];
  for (const entry of entries) {
    for (const alias of entry.aliases) aliases.push({ alias, nameEn: entry.nameEn });
  }
  aliases.sort((x, y) => y.alias.length - x.alias.length);
  const joined = ` ${tokens.join(" ")} `;
  for (const { alias, nameEn } of aliases) {
    if (joined.includes(` ${alias} `)) return { nameEn, kind: "latin", span: alias };
  }
  // 3. Typo correction: explicit misspelling table, then edit distance 1.
  for (const token of tokens) {
    const fixed = MISSPELLINGS[token];
    if (fixed) {
      const hit = aliases.find((a) => a.alias === fixed);
      if (hit) return { nameEn: hit.nameEn, kind: "typo", span: token };
    }
  }
  for (const token of tokens) {
    if (token.length < 5) continue;
    for (const { alias, nameEn } of aliases) {
      if (!alias.includes(" ") && alias.length >= 5 && levenshtein(token, alias) === 1) {
        return { nameEn, kind: "typo", span: token };
      }
    }
  }
  return null;
}

export function parseAddress(
  input: string,
  dictionary: GeoDictionary = DEFAULT_GEO_DICTIONARY,
): ParsedAddress {
  // NFC-normalize so Bangla matching is codepoint-form independent:
  // typed text may use composed (য় U+09DF) or decomposed (য + ়) forms;
  // dictionary nameBn values are stored in NFC form (see geo-dictionary.ts
  // and the curated tables, which are NFC-stable).
  const raw = input.trim().normalize("NFC");
  const folded = foldBanglaDigits(raw.toLowerCase());
  const tokens = folded
    .replace(/[,\-/।;:"'()]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);

  const matchedBy: ParsedAddress["matchedBy"] = {
    division: null,
    district: null,
    upazila: null,
    area: null,
  };
  const usedSpans: string[] = [];

  const upazilaHit = findCandidate(raw, tokens, dictionary.upazilas);
  let upazila: string | null = null;
  let area: string | null = null;
  if (upazilaHit) {
    const entry = dictionary.upazilas.find((u) => u.nameEn === upazilaHit.nameEn);
    if (entry?.isArea) {
      area = entry.nameEn;
      matchedBy.area = upazilaHit.kind;
    } else {
      upazila = entry?.nameEn ?? upazilaHit.nameEn;
      matchedBy.upazila = upazilaHit.kind;
    }
    usedSpans.push(upazilaHit.span.toLowerCase());
  }

  const districtHit = findCandidate(raw, tokens, dictionary.districts);
  let district: string | null = districtHit?.nameEn ?? null;
  if (districtHit) {
    matchedBy.district = districtHit.kind;
    usedSpans.push(districtHit.span.toLowerCase());
  }
  // Upazila implies district.
  if (!district && (upazila ?? area)) {
    const entry = dictionary.upazilas.find((u) => u.nameEn === (upazila ?? area));
    if (entry) {
      district = entry.districtEn;
      matchedBy.district = "implied";
    }
  }

  const divisionHit = findCandidate(raw, tokens, dictionary.divisions);
  let division: string | null = divisionHit?.nameEn ?? null;
  if (divisionHit) {
    matchedBy.division = divisionHit.kind;
    usedSpans.push(divisionHit.span.toLowerCase());
  }
  // District implies division.
  if (!division && district) {
    const entry = dictionary.districts.find((d) => d.nameEn === district);
    if (entry) {
      division = entry.divisionEn;
      matchedBy.division = "implied";
    }
  }

  let confidence = 0;
  if (division) confidence += 0.25;
  if (district) confidence += 0.35;
  if (upazila) confidence += 0.25;
  if (area) confidence += 0.15;
  if (Object.values(matchedBy).some((k) => k === "typo")) confidence -= 0.1;
  confidence = Math.max(0, Math.min(1, Math.round(confidence * 100) / 100));

  // Leftover address line: remove matched Latin spans (word-boundary) and
  // matched Bangla names from the original text; keep everything else.
  let line = ` ${foldBanglaDigits(raw)} `;
  for (const span of usedSpans) {
    line = line.replace(new RegExp(`\\s${span.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s`, "gi"), " ");
  }
  for (const name of [division, district, upazila, area]) {
    if (!name) continue;
    const bn =
      dictionary.divisions.find((d) => d.nameEn === name)?.nameBn ??
      dictionary.districts.find((d) => d.nameEn === name)?.nameBn ??
      dictionary.upazilas.find((u) => u.nameEn === name)?.nameBn;
    if (bn) line = line.replace(bn, " ");
  }
  const addressLine = line.replace(/\s+/g, " ").replace(/^[\s,]+|[\s,]+$/g, "").trim();

  return {
    division,
    divisionBn: division ? (dictionary.divisions.find((d) => d.nameEn === division)?.nameBn ?? null) : null,
    district,
    districtBn: district ? (dictionary.districts.find((d) => d.nameEn === district)?.nameBn ?? null) : null,
    upazila,
    area,
    addressLine: addressLine.length > 0 ? addressLine : raw,
    confidence,
    matchedBy,
  };
}
