// Banglish query understanding — deterministic, NON-LLM (wave 57B).
//
// Bangladeshi shoppers type Romanised Bangla ("chaler bosta",
// "panjabi price", "lal sharee") and mixed spellings, while product
// titles live in Bangla script and/or English. This module is a
// rules + dictionary layer that EXPANDS a Latin-script query token
// with its canonical forms in BOTH scripts (Bangla + English), so
// the same query matches titles written either way. It works fully
// offline, needs no AI provider, and is pure/client-safe: no I/O, no
// imports, trivially unit-checkable.
//
// Recall-safety contract: expansion only ever APPENDS canonical
// tokens — the user's own tokens are never removed, replaced, or
// reordered — so an expanded query can match everything the raw
// query matched, plus the canonical-script equivalents.
//
// Script rule: mapping is PER TOKEN. A token containing any Bangla
// script character (U+0980–U+09FF) is already canonical and is never
// mapped, so a query typed fully in Bangla script comes back as a
// no-op (whitespace normalisation only). Mixed queries ("লাল
// sharee") still get their Latin tokens expanded.
//
// Example expansions (also the smoke table — see the wave-57 report):
//   "chaler bosta"  -> "chaler bosta চাল rice বস্তা sack"
//                      mapped: chaler→চাল, chaler→rice, bosta→বস্তা, bosta→sack
//   "lal sharee"    -> "lal sharee লাল red শাড়ি saree"
//                      mapped: lal→লাল, lal→red, sharee→শাড়ি, sharee→saree
//   "shorishar tel" -> "shorishar tel সরিষার mustard তেল oil"
//   "panjabi"       -> "panjabi পাঞ্জাবি"
//   "চালের বস্তা"    -> "চালের বস্তা" (Bangla script — no-op)

export interface BanglishEntry {
  /** Canonical Bangla-script tokens (single words). */
  bn: string[];
  /** Canonical English tokens (single words). */
  en: string[];
}

/**
 * Roman token -> canonical forms. Keys are lowercase Latin tokens as
 * typed (including common misspellings/variants: sharee/sari/shari,
 * chal/chaul, dud/dudh, osudh/oshudh). English headwords are keys
 * too, mapped to their Bangla canonical, so an English query also
 * gains Bangla recall. Deliberately curated, not generated.
 */
export const BANGLISH_DICTIONARY: Record<string, BanglishEntry> = {
  /* ---- Grocery & staples ---- */
  rice: { bn: ["চাল"], en: [] },
  chal: { bn: ["চাল"], en: ["rice"] },
  chaul: { bn: ["চাল"], en: ["rice"] },
  chawl: { bn: ["চাল"], en: ["rice"] },
  chaler: { bn: ["চাল"], en: ["rice"] },
  bhat: { bn: ["ভাত"], en: ["rice"] },
  bhaat: { bn: ["ভাত"], en: ["rice"] },
  tel: { bn: ["তেল"], en: ["oil"] },
  oil: { bn: ["তেল"], en: [] },
  shorisha: { bn: ["সরিষা"], en: ["mustard"] },
  sorisha: { bn: ["সরিষা"], en: ["mustard"] },
  shorishar: { bn: ["সরিষার"], en: ["mustard"] },
  mustard: { bn: ["সরিষা"], en: [] },
  lobon: { bn: ["লবণ"], en: ["salt"] },
  labon: { bn: ["লবণ"], en: ["salt"] },
  salt: { bn: ["লবণ"], en: [] },
  chini: { bn: ["চিনি"], en: ["sugar"] },
  sugar: { bn: ["চিনি"], en: [] },
  ata: { bn: ["আটা"], en: ["flour"] },
  moyda: { bn: ["ময়দা"], en: ["flour"] },
  flour: { bn: ["আটা"], en: [] },
  lentil: { bn: ["ডাল"], en: [] },
  daal: { bn: ["ডাল"], en: ["lentil"] },
  dal: { bn: ["ডাল"], en: ["lentil"] },
  alu: { bn: ["আলু"], en: ["potato"] },
  potato: { bn: ["আলু"], en: [] },
  peyaj: { bn: ["পেঁয়াজ"], en: ["onion"] },
  piyaj: { bn: ["পেঁয়াজ"], en: ["onion"] },
  onion: { bn: ["পেঁয়াজ"], en: [] },
  roshun: { bn: ["রসুন"], en: ["garlic"] },
  rosun: { bn: ["রসুন"], en: ["garlic"] },
  garlic: { bn: ["রসুন"], en: [] },
  ada: { bn: ["আদা"], en: ["ginger"] },
  ginger: { bn: ["আদা"], en: [] },
  morich: { bn: ["মরিচ"], en: ["chili"] },
  holud: { bn: ["হলুদ"], en: ["turmeric", "yellow"] },
  turmeric: { bn: ["হলুদ"], en: [] },
  dudh: { bn: ["দুধ"], en: ["milk"] },
  dud: { bn: ["দুধ"], en: ["milk"] },
  milk: { bn: ["দুধ"], en: [] },
  doi: { bn: ["দই"], en: ["yogurt"] },
  yogurt: { bn: ["দই"], en: [] },
  dim: { bn: ["ডিম"], en: ["egg"] },
  egg: { bn: ["ডিম"], en: [] },
  mangsho: { bn: ["মাংস"], en: ["meat"] },
  mangso: { bn: ["মাংস"], en: ["meat"] },
  meat: { bn: ["মাংস"], en: [] },
  murgi: { bn: ["মুরগি"], en: ["chicken"] },
  chicken: { bn: ["মুরগি"], en: [] },
  goru: { bn: ["গরু"], en: ["beef"] },
  gorur: { bn: ["গরুর"], en: ["beef"] },
  beef: { bn: ["গরু"], en: [] },
  mach: { bn: ["মাছ"], en: ["fish"] },
  machh: { bn: ["মাছ"], en: ["fish"] },
  fish: { bn: ["মাছ"], en: [] },
  ilish: { bn: ["ইলিশ"], en: ["hilsa"] },
  hilsa: { bn: ["ইলিশ"], en: [] },
  rui: { bn: ["রুই"], en: [] },
  shobji: { bn: ["সবজি"], en: ["vegetable"] },
  sabji: { bn: ["সবজি"], en: ["vegetable"] },
  vegetable: { bn: ["সবজি"], en: [] },
  fol: { bn: ["ফল"], en: ["fruit"] },
  fruit: { bn: ["ফল"], en: [] },
  aam: { bn: ["আম"], en: ["mango"] },
  mango: { bn: ["আম"], en: [] },
  kola: { bn: ["কলা"], en: ["banana"] },
  banana: { bn: ["কলা"], en: [] },
  cha: { bn: ["চা"], en: ["tea"] },
  tea: { bn: ["চা"], en: [] },
  coffee: { bn: ["কফি"], en: [] },
  khejur: { bn: ["খেজুর"], en: ["dates"] },
  dates: { bn: ["খেজুর"], en: [] },
  biscuit: { bn: ["বিস্কুট"], en: [] },
  biscut: { bn: ["বিস্কুট"], en: ["biscuit"] },
  noodles: { bn: ["নুডুলস"], en: [] },
  sauce: { bn: ["সস"], en: [] },
  modhu: { bn: ["মধু"], en: ["honey"] },
  honey: { bn: ["মধু"], en: [] },
  ghee: { bn: ["ঘি"], en: [] },
  paneer: { bn: ["পনির"], en: ["cheese"] },
  cheese: { bn: ["পনির"], en: [] },
  butter: { bn: ["মাখন"], en: [] },

  /* ---- Clothing ---- */
  sharee: { bn: ["শাড়ি"], en: ["saree"] },
  saree: { bn: ["শাড়ি"], en: [] },
  sari: { bn: ["শাড়ি"], en: ["saree"] },
  shari: { bn: ["শাড়ি"], en: ["saree"] },
  panjabi: { bn: ["পাঞ্জাবি"], en: [] },
  punjabi: { bn: ["পাঞ্জাবি"], en: ["panjabi"] },
  jama: { bn: ["জামা"], en: ["dress"] },
  dress: { bn: ["জামা"], en: [] },
  kurti: { bn: ["কুর্তি"], en: [] },
  salwar: { bn: ["সালোয়ার"], en: [] },
  kameez: { bn: ["কামিজ"], en: [] },
  kamiz: { bn: ["কামিজ"], en: ["kameez"] },
  hijab: { bn: ["হিজাব"], en: [] },
  borka: { bn: ["বোরকা"], en: ["burkha"] },
  burkha: { bn: ["বোরকা"], en: [] },
  lungi: { bn: ["লুঙ্গি"], en: [] },
  gamcha: { bn: ["গামছা"], en: ["towel"] },
  towel: { bn: ["গামছা"], en: [] },
  shirt: { bn: ["শার্ট"], en: [] },
  tshirt: { bn: ["টি-শার্ট"], en: ["t-shirt"] },
  "t-shirt": { bn: ["টি-শার্ট"], en: [] },
  pant: { bn: ["প্যান্ট"], en: [] },
  jeans: { bn: ["জিন্স"], en: [] },
  juta: { bn: ["জুতা"], en: ["shoes"] },
  juto: { bn: ["জুতা"], en: ["shoes"] },
  shoes: { bn: ["জুতা"], en: [] },
  sandal: { bn: ["স্যান্ডেল"], en: [] },
  ghori: { bn: ["ঘড়ি"], en: ["watch"] },
  watch: { bn: ["ঘড়ি"], en: [] },
  bag: { bn: ["ব্যাগ"], en: [] },
  choshma: { bn: ["চশমা"], en: ["glasses"] },
  glasses: { bn: ["চশমা"], en: [] },
  sunglass: { bn: ["সানগ্লাস"], en: ["sunglasses"] },
  payjama: { bn: ["পায়জামা"], en: ["pajama"] },
  genji: { bn: ["গেঞ্জি"], en: ["vest"] },
  sweater: { bn: ["সোয়েটার"], en: [] },
  jacket: { bn: ["জ্যাকেট"], en: [] },
  blazer: { bn: ["ব্লেজার"], en: [] },
  "three-piece": { bn: ["থ্রি-পিস"], en: [] },
  threepiece: { bn: ["থ্রি-পিস"], en: ["three-piece"] },

  /* ---- Electronics ---- */
  mobile: { bn: ["মোবাইল"], en: [] },
  phone: { bn: ["ফোন"], en: ["mobile"] },
  charger: { bn: ["চার্জার"], en: [] },
  headphone: { bn: ["হেডফোন"], en: [] },
  earphone: { bn: ["ইয়ারফোন"], en: ["earbuds"] },
  earbuds: { bn: ["ইয়ারবাডস"], en: [] },
  laptop: { bn: ["ল্যাপটপ"], en: [] },
  computer: { bn: ["কম্পিউটার"], en: [] },
  fan: { bn: ["ফ্যান"], en: [] },
  light: { bn: ["লাইট"], en: ["lamp"] },
  lamp: { bn: ["ল্যাম্প"], en: [] },
  battery: { bn: ["ব্যাটারি"], en: [] },
  powerbank: { bn: ["পাওয়ার"], en: [] },
  cable: { bn: ["কেবল"], en: [] },
  mouse: { bn: ["মাউস"], en: [] },
  keyboard: { bn: ["কিবোর্ড"], en: [] },
  tv: { bn: ["টিভি"], en: ["television"] },
  fridge: { bn: ["ফ্রিজ"], en: ["refrigerator"] },
  camera: { bn: ["ক্যামেরা"], en: [] },
  speaker: { bn: ["স্পিকার"], en: [] },

  /* ---- Beauty & personal care ---- */
  cream: { bn: ["ক্রিম"], en: [] },
  lotion: { bn: ["লোশন"], en: [] },
  facewash: { bn: ["ফেসওয়াশ"], en: [] },
  shampoo: { bn: ["শ্যাম্পু"], en: [] },
  shaban: { bn: ["সাবান"], en: ["soap"] },
  saban: { bn: ["সাবান"], en: ["soap"] },
  soap: { bn: ["সাবান"], en: [] },
  lipstick: { bn: ["লিপস্টিক"], en: [] },
  perfume: { bn: ["পারফিউম"], en: [] },
  attar: { bn: ["আতর"], en: ["perfume"] },
  sunscreen: { bn: ["সানস্ক্রিন"], en: [] },
  narikel: { bn: ["নারিকেল"], en: ["coconut"] },
  coconut: { bn: ["নারিকেল"], en: [] },

  /* ---- Baby ---- */
  baby: { bn: ["বেবি", "শিশু"], en: [] },
  shishu: { bn: ["শিশু"], en: ["baby"] },
  diaper: { bn: ["ডায়াপার"], en: [] },
  feeder: { bn: ["ফিডার"], en: ["bottle"] },

  /* ---- Home & living ---- */
  bedsheet: { bn: ["বেডশিট"], en: [] },
  chador: { bn: ["চাদর"], en: ["bedsheet"] },
  balish: { bn: ["বালিশ"], en: ["pillow"] },
  pillow: { bn: ["বালিশ"], en: [] },
  katha: { bn: ["কাঁথা"], en: ["quilt"] },
  quilt: { bn: ["কাঁথা"], en: [] },
  kombol: { bn: ["কম্বল"], en: ["blanket"] },
  blanket: { bn: ["কম্বল"], en: [] },
  plate: { bn: ["প্লেট"], en: [] },
  glass: { bn: ["গ্লাস"], en: [] },
  balti: { bn: ["বালতি"], en: ["bucket"] },
  bucket: { bn: ["বালতি"], en: [] },
  hari: { bn: ["হাঁড়ি"], en: ["pot"] },
  toshok: { bn: ["তোষক"], en: ["mattress"] },
  mattress: { bn: ["তোষক"], en: [] },
  dinner: { bn: ["ডিনার"], en: [] },

  /* ---- Colours ---- */
  lal: { bn: ["লাল"], en: ["red"] },
  red: { bn: ["লাল"], en: [] },
  sada: { bn: ["সাদা"], en: ["white"] },
  white: { bn: ["সাদা"], en: [] },
  kalo: { bn: ["কালো"], en: ["black"] },
  black: { bn: ["কালো"], en: [] },
  nil: { bn: ["নীল"], en: ["blue"] },
  neel: { bn: ["নীল"], en: ["blue"] },
  blue: { bn: ["নীল"], en: [] },
  sobuj: { bn: ["সবুজ"], en: ["green"] },
  green: { bn: ["সবুজ"], en: [] },
  golapi: { bn: ["গোলাপি"], en: ["pink"] },
  pink: { bn: ["গোলাপি"], en: [] },
  komola: { bn: ["কমলা"], en: ["orange"] },
  orange: { bn: ["কমলা"], en: [] },
  beguni: { bn: ["বেগুনি"], en: ["purple"] },
  purple: { bn: ["বেগুনি"], en: [] },
  badami: { bn: ["বাদামি"], en: ["brown"] },
  brown: { bn: ["বাদামি"], en: [] },

  /* ---- Medicine & units ---- */
  oshudh: { bn: ["ওষুধ"], en: ["medicine"] },
  osudh: { bn: ["ওষুধ"], en: ["medicine"] },
  oushodh: { bn: ["ওষুধ"], en: ["medicine"] },
  medicine: { bn: ["ওষুধ"], en: [] },
  vitamin: { bn: ["ভিটামিন"], en: [] },
  bosta: { bn: ["বস্তা"], en: ["sack"] },
  sack: { bn: ["বস্তা"], en: [] },
  keji: { bn: ["কেজি"], en: ["kg"] },
  kg: { bn: ["কেজি"], en: [] },
  litre: { bn: ["লিটার"], en: [] },
  liter: { bn: ["লিটার"], en: ["litre"] },
  packet: { bn: ["প্যাকেট"], en: [] },
  box: { bn: ["বাক্স"], en: [] },
};

export interface BanglishMappedToken {
  /** The user's token, normalised (lowercased, edge punctuation stripped). */
  from: string;
  /** One canonical token that was appended because of `from`. */
  to: string;
}

export interface BanglishExpansion {
  /** The user's query, whitespace-normalised, otherwise untouched. */
  original: string;
  /** `original` tokens + appended canonical tokens (deduped). */
  expanded: string;
  /** Every (from -> to) addition, in query order. Empty when nothing mapped. */
  mappedTokens: BanglishMappedToken[];
}

const BANGLA_SCRIPT_RE = /[\u0980-\u09FF]/;
const EDGE_PUNCT_RE = /^[^\p{L}\p{N}-]+|[^\p{L}\p{N}-]+$/gu;

/**
 * Expand a search query with canonical Bangla/English equivalents
 * for its Banglish tokens. Pure and total: any input (including ""
 * and pure-Bangla text) returns a valid expansion; see the header
 * for the recall-safety and script rules.
 */
export function expandQuery(q: string): BanglishExpansion {
  const original = q.trim().replace(/\s+/g, " ");
  if (!original) return { original, expanded: original, mappedTokens: [] };

  const tokens = original.split(" ");
  const present = new Set(tokens.map((t) => t.toLowerCase()));
  const added: string[] = [];
  const mappedTokens: BanglishMappedToken[] = [];
  const seenPair = new Set<string>();

  for (const token of tokens) {
    // Bangla-script tokens are already canonical — never mapped.
    if (BANGLA_SCRIPT_RE.test(token)) continue;
    const key = token.toLowerCase().replace(EDGE_PUNCT_RE, "");
    if (!key) continue;
    const entry = BANGLISH_DICTIONARY[key];
    if (!entry) continue;
    for (const canonical of [...entry.bn, ...entry.en]) {
      const pairId = `${key}|${canonical}`;
      if (seenPair.has(pairId)) continue;
      seenPair.add(pairId);
      // Only record (and append) canonicals not already present in
      // the query — mappedTokens is exactly "what was ADDED", which
      // is what the UI hint and the response meta promise to show.
      if (!present.has(canonical.toLowerCase())) {
        present.add(canonical.toLowerCase());
        added.push(canonical);
        mappedTokens.push({ from: key, to: canonical });
      }
    }
  }

  return {
    original,
    expanded: added.length > 0 ? [...tokens, ...added].join(" ") : original,
    mappedTokens,
  };
}
