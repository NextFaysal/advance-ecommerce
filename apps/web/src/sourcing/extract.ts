/**
 * Sourcing import — server-side product-page fetch + tolerant
 * extraction (Wave 15-3, doc 16 §P7; gated by module.sourcing).
 *
 * Given a merchant-pasted product URL (AliExpress / 1688 / Alibaba or
 * any shop), fetch the page ON THE SERVER and pull out a draft
 * product: title, description, images, price + currency.
 *
 * Extraction strategy, in priority order:
 *   1. JSON-LD `Product` blocks (name / image / offers.price) — the
 *      most reliable signal; marketplaces embed them for SEO.
 *   2. OpenGraph / product meta (og:title, og:image,
 *      product:price:amount + product:price:currency, twitter:image).
 *   3. Fallbacks: <title>, meta description, and large <img> tags
 *      (data-src / srcset aware, icon/logo/sprite filtered).
 * A field that no strategy finds comes back null — the UI says so and
 * the merchant types it. NOTHING is invented: no fake prices, no
 * guessed currency conversion.
 *
 * Fetch safety (SSRF care):
 *   - http/https only; URL credentials rejected.
 *   - The host must not be localhost / *.local / *.internal, and IP
 *     literals must not be private, loopback, link-local, CGNAT or
 *     multicast ranges (v4 + v6, incl. v4-mapped v6). Every redirect
 *     target is re-validated with the same rules.
 *   - Whole operation is capped at ~10s and the body at 2 MB; a
 *     browser-ish User-Agent is sent because marketplaces 403 bots.
 *   (Known limit: a public hostname whose DNS resolves to a private
 *   address cannot be detected without a resolving fetch layer; the
 *   literal-host + redirect checks above are what's enforced.)
 */

export class SourcingError extends Error {
  code: string;
  status: number;
  constructor(code: string, messageBn: string, status = 422) {
    super(messageBn);
    this.code = code;
    this.status = status;
  }
}

export interface SourcingPreview {
  sourceUrl: string;
  finalUrl: string;
  title: string | null;
  description: string | null;
  images: string[];
  /** Decimal string exactly as the page stated it, e.g. "12.99". */
  priceAmount: string | null;
  /** ISO-ish currency code as stated, e.g. "USD" / "CNY" / "BDT". */
  priceCurrency: string | null;
  /** Which strategies produced data — shown in the UI meta line so
   *  the merchant can judge how much to trust the preview. */
  strategies: string[];
  truncated: boolean;
}

const FETCH_BUDGET_MS = 10_000;
const MAX_BODY_BYTES = 2_000_000;
const MAX_REDIRECTS = 5;
const MAX_IMAGES = 20;
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 AdvanceEcommerceSourcing/1.0";

// ---------------------------------------------------------------------------
// SSRF guard
// ---------------------------------------------------------------------------

function ipv4IsPrivateOrReserved(ip: string): boolean {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true; // this-host, private, loopback
  if (a === 169 && b === 254) return true; // link-local (cloud metadata!)
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function assertUrlAllowed(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SourcingError("INVALID_URL", "লিংকটি সঠিক URL নয় — পুরো লিংক (https:// সহ) আবার দিন।", 400);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SourcingError("INVALID_URL", "শুধু http/https লিংক গ্রহণযোগ্য।", 400);
  }
  if (url.username || url.password) {
    throw new SourcingError("INVALID_URL", "লিংকে ব্যবহারকারী/পাসওয়ার্ড থাকা যাবে না।", 400);
  }
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan")) {
    throw new SourcingError("BLOCKED_HOST", "লোকাল/অভ্যন্তরীণ ঠিকানা থেকে পণ্য আনা যাবে না — প্রকাশ্য শপের লিংক দিন।", 400);
  }
  // IP-literal hosts get range-checked (v6 literals arrive bracketed;
  // URL.hostname strips the brackets).
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) && ipv4IsPrivateOrReserved(host)) {
    throw new SourcingError("BLOCKED_HOST", "এই IP ঠিকানা (ব্যক্তিগত/সংরক্ষিত) থেকে পণ্য আনা যাবে না।", 400);
  }
  if (host.includes(":")) {
    const v6 = host.toLowerCase();
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(v6);
    if (
      v6 === "::1" ||
      v6 === "::" ||
      v6.startsWith("fe8") || v6.startsWith("fe9") || v6.startsWith("fea") || v6.startsWith("feb") || // fe80::/10
      v6.startsWith("fc") || v6.startsWith("fd") || // fc00::/7
      (mapped !== null && ipv4IsPrivateOrReserved(mapped[1] as string))
    ) {
      throw new SourcingError("BLOCKED_HOST", "এই IP ঠিকানা (ব্যক্তিগত/সংরক্ষিত) থেকে পণ্য আনা যাবে না।", 400);
    }
  }
  return url;
}

// ---------------------------------------------------------------------------
// Fetch with manual, re-validated redirects + body cap
// ---------------------------------------------------------------------------

async function fetchPage(start: URL): Promise<{ html: string; finalUrl: string; truncated: boolean }> {
  const deadline = Date.now() + FETCH_BUDGET_MS;
  let current = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new SourcingError("FETCH_TIMEOUT", "ওয়েবসাইটটি ১০ সেকেন্ডের মধ্যে সাড়া দেয়নি — কিছুক্ষণ পর আবার চেষ্টা করুন, অথবা পণ্যের তথ্য হাতে লিখে যোগ করুন।", 504);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);
    let res: Response;
    try {
      res = await fetch(current.toString(), {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": BROWSER_UA,
          Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
          "Accept-Language": "en-US,en;q=0.8,bn;q=0.6",
        },
      });
    } catch {
      throw new SourcingError("FETCH_FAILED", "ওয়েবসাইট থেকে পেজটি আনা যায়নি (নেটওয়ার্ক ত্রুটি বা সাইটটি বট আটকাচ্ছে) — লিংকটি ঠিক আছে কিনা দেখুন, না হলে তথ্য হাতে লিখুন।", 502);
    } finally {
      clearTimeout(timer);
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new SourcingError("FETCH_FAILED", "ওয়েবসাইট অস্পষ্ট রিডাইরেক্ট দিয়েছে — পেজটি সরাসরি খুলে আসল লিংকটি কপি করুন।", 502);
      if (hop === MAX_REDIRECTS) throw new SourcingError("FETCH_FAILED", "অনেক বেশি রিডাইরেক্ট — লিংকটি সরাসরি পণ্যের পেজের কিনা যাচাই করুন।", 502);
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        throw new SourcingError("FETCH_FAILED", "ওয়েবসাইট ত্রুটিপূর্ণ রিডাইরেক্ট দিয়েছে — পেজটি সরাসরি খুলে আসল লিংকটি কপি করুন।", 502);
      }
      current = assertUrlAllowed(next.toString());
      continue;
    }
    if (!res.ok) {
      throw new SourcingError(
        "FETCH_FAILED",
        `ওয়েবসাইট পেজটি দিতে অস্বীকার করেছে (HTTP ${res.status}) — অনেক মার্কেটপ্লেস স্বয়ংক্রিয় অ্যাক্সেস আটকায়। লিংক বদলান, অথবা পণ্যের তথ্য হাতে লিখে যোগ করুন।`,
        502,
      );
    }
    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    if (/^(application\/pdf|application\/zip|application\/octet-stream|image\/|audio\/|video\/)/.test(contentType)) {
      throw new SourcingError("NOT_HTML", "লিংকটি কোনো ওয়েবপেজ নয় (ফাইল/ছবি) — পণ্যের পেজের লিংক দিন।", 422);
    }
    // Read with a hard cap; a truncated page still parses tolerantly.
    let html = "";
    let truncated = false;
    if (res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8", { fatal: false });
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_BODY_BYTES) {
          truncated = true;
          await reader.cancel().catch(() => undefined);
          break;
        }
        html += decoder.decode(value, { stream: true });
      }
      html += decoder.decode();
    } else {
      html = await res.text();
    }
    return { html, finalUrl: current.toString(), truncated };
  }
  throw new SourcingError("FETCH_FAILED", "পেজটি আনা যায়নি।", 502);
}

// ---------------------------------------------------------------------------
// HTML extraction helpers (regex-tolerant; no DOM on the server)
// ---------------------------------------------------------------------------

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim();
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " "));
}

/** All <meta> tags as {key,value} — key from property/name/itemprop, lowercased. */
function metaTags(html: string): { key: string; content: string }[] {
  const out: { key: string; content: string }[] = [];
  const tagRe = /<meta\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html)) !== null) {
    const tag = m[0];
    const key = /\b(?:property|name|itemprop)\s*=\s*"([^"]+)"/i.exec(tag)?.[1] ?? /\b(?:property|name|itemprop)\s*=\s*'([^']+)'/i.exec(tag)?.[1];
    const content = /\bcontent\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? /\bcontent\s*=\s*'([^']*)'/i.exec(tag)?.[1];
    if (key && content !== undefined) out.push({ key: key.toLowerCase(), content: decodeEntities(content) });
  }
  return out;
}

function metaValue(metas: { key: string; content: string }[], ...keys: string[]): string | null {
  for (const k of keys) {
    const hit = metas.find((t) => t.key === k && t.content.trim() !== "");
    if (hit) return hit.content.trim();
  }
  return null;
}

function absoluteUrl(src: string, base: string): string | null {
  try {
    const u = new URL(src, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

interface JsonLdProduct {
  title?: string;
  description?: string;
  images: string[];
  priceAmount?: string;
  priceCurrency?: string;
}

function findJsonLdProducts(html: string): JsonLdProduct[] {
  const out: JsonLdProduct[] = [];
  const scriptRe = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (node === null || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    if ("@graph" in obj) visit(obj["@graph"]);
    const type = obj["@type"];
    const isProduct = type === "Product" || (Array.isArray(type) && type.includes("Product"));
    if (!isProduct) return;
    const p: JsonLdProduct = { images: [] };
    if (typeof obj.name === "string") p.title = decodeEntities(obj.name);
    if (typeof obj.description === "string") p.description = stripTags(obj.description).slice(0, 4000);
    const image = obj.image;
    const pushImage = (v: unknown): void => {
      if (typeof v === "string") p.images.push(v);
      else if (Array.isArray(v)) v.forEach(pushImage);
      else if (v && typeof v === "object" && typeof (v as Record<string, unknown>).url === "string") {
        p.images.push((v as Record<string, unknown>).url as string);
      }
    };
    pushImage(image);
    const offers = Array.isArray(obj.offers) ? obj.offers[0] : obj.offers;
    if (offers && typeof offers === "object") {
      const o = offers as Record<string, unknown>;
      const price = o.price ?? o.lowPrice;
      if (typeof price === "number" && Number.isFinite(price)) p.priceAmount = String(price);
      else if (typeof price === "string" && /^[\d.,]+$/.test(price.trim())) p.priceAmount = price.trim();
      if (typeof o.priceCurrency === "string") p.priceCurrency = o.priceCurrency.toUpperCase();
    }
    out.push(p);
  };
  while ((m = scriptRe.exec(html)) !== null) {
    const raw = (m[1] ?? "").trim();
    if (!raw) continue;
    try {
      visit(JSON.parse(raw));
    } catch {
      // Some shops emit trailing commas / comments — one salvage pass.
      try {
        visit(JSON.parse(raw.replace(/,\s*([}\]])/g, "$1")));
      } catch {
        /* unrecoverable block — other strategies still apply */
      }
    }
  }
  return out;
}

/** Largest-candidate <img> scraping for pages with no structured data. */
function scrapeImages(html: string, base: string): string[] {
  const out: string[] = [];
  const imgRe = /<img\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(html)) !== null && out.length < MAX_IMAGES * 2) {
    const tag = m[0];
    const attr = (name: string): string | null =>
      new RegExp(`\\b${name}\\s*=\\s*"([^"]+)"`, "i").exec(tag)?.[1] ??
      new RegExp(`\\b${name}\\s*=\\s*'([^']+)'`, "i").exec(tag)?.[1] ??
      null;
    // Prefer lazy/original sources, then srcset's biggest entry, then src.
    let candidate = attr("data-src") ?? attr("data-original") ?? attr("data-lazy-src");
    if (!candidate) {
      const srcset = attr("srcset");
      if (srcset) {
        const entries = srcset.split(",").map((e) => e.trim().split(/\s+/)).filter((e) => e[0]);
        const withWidth = entries
          .map((e) => ({ url: e[0] as string, w: parseInt((e[1] ?? "0").replace("w", ""), 10) || 0 }))
          .sort((a, b) => b.w - a.w);
        candidate = withWidth[0]?.url ?? null;
      }
    }
    if (!candidate) candidate = attr("src");
    if (!candidate) continue;
    const lower = candidate.toLowerCase();
    if (lower.startsWith("data:") || lower.endsWith(".svg") || lower.includes("sprite") || lower.includes("icon") || lower.includes("logo") || lower.includes("placeholder") || lower.includes("blank.gif") || lower.includes("spacer")) continue;
    // Explicit tiny dimensions = tracking pixel / thumbnail chrome.
    const w = parseInt(attr("width") ?? "", 10);
    const h = parseInt(attr("height") ?? "", 10);
    if ((Number.isFinite(w) && w > 0 && w < 120) || (Number.isFinite(h) && h > 0 && h < 120)) continue;
    const abs = absoluteUrl(decodeEntities(candidate), base);
    if (abs) out.push(abs);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export async function extractProductFromUrl(rawUrl: string): Promise<SourcingPreview> {
  const start = assertUrlAllowed(rawUrl.trim());
  const { html, finalUrl, truncated } = await fetchPage(start);
  if (!html || html.trim().length < 40) {
    throw new SourcingError("EMPTY_PAGE", "ওয়েবসাইট খালি পেজ দিয়েছে (সম্ভবত জাভাস্ক্রিপ্ট ছাড়া পণ্য দেখায় না) — তথ্য হাতে লিখে পণ্য যোগ করুন।");
  }
  const strategies: string[] = [];
  const metas = metaTags(html);

  let title: string | null = null;
  let description: string | null = null;
  let priceAmount: string | null = null;
  let priceCurrency: string | null = null;
  const images: string[] = [];
  const addImages = (urls: string[]): void => {
    for (const u of urls) {
      const abs = absoluteUrl(u, finalUrl);
      if (abs && !images.includes(abs)) images.push(abs);
      if (images.length >= MAX_IMAGES) break;
    }
  };

  // 1) JSON-LD Product
  const ld = findJsonLdProducts(html);
  const firstLd = ld[0];
  if (firstLd) {
    strategies.push("JSON-LD");
    title = firstLd.title ?? null;
    description = firstLd.description ?? null;
    priceAmount = firstLd.priceAmount ?? null;
    priceCurrency = firstLd.priceCurrency ?? null;
    addImages(firstLd.images);
  }

  // 2) OpenGraph / product meta
  const ogTitle = metaValue(metas, "og:title");
  const ogDesc = metaValue(metas, "og:description");
  const ogPrice = metaValue(metas, "product:price:amount", "og:price:amount", "price");
  const ogCurrency = metaValue(metas, "product:price:currency", "og:price:currency", "pricecurrency");
  const ogImages = metas.filter((t) => t.key === "og:image" || t.key === "og:image:url").map((t) => t.content);
  const twImage = metaValue(metas, "twitter:image");
  if (ogTitle || ogImages.length > 0 || ogPrice) strategies.push("OpenGraph");
  if (!title && ogTitle) title = ogTitle;
  if (!description && ogDesc) description = ogDesc.slice(0, 4000);
  if (!priceAmount && ogPrice && /^[\d.,]+$/.test(ogPrice)) priceAmount = ogPrice;
  if (!priceCurrency && ogCurrency) priceCurrency = ogCurrency.toUpperCase();
  addImages(ogImages);
  if (twImage) addImages([twImage]);

  // 3) Fallbacks
  if (!title) {
    const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
    if (t) {
      title = stripTags(t).slice(0, 300);
      strategies.push("<title>");
    }
  }
  if (!description) {
    const d = metaValue(metas, "description");
    if (d) description = d.slice(0, 4000);
  }
  if (images.length === 0) {
    const scraped = scrapeImages(html, finalUrl);
    if (scraped.length > 0) {
      strategies.push("img scrape");
      addImages(scraped);
    }
  }

  if (!title && images.length === 0) {
    throw new SourcingError(
      "EXTRACT_FAILED",
      "এই পেজ থেকে পণ্যের নাম বা ছবি কিছুই পড়া যায়নি — সাইটটি সম্ভবত জাভাস্ক্রিপ্ট দিয়ে পণ্য দেখায় বা বট আটকায়। পণ্যের তথ্য হাতে লিখে যোগ করুন।",
    );
  }
  if (truncated) strategies.push("পেজ আংশিক (2MB ক্যাপ)");

  return {
    sourceUrl: start.toString(),
    finalUrl,
    title,
    description,
    images: images.slice(0, MAX_IMAGES),
    priceAmount,
    priceCurrency,
    strategies,
    truncated,
  };
}
