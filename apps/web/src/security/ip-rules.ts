/**
 * Staff-login IP rules (ADV-28 core) — allow/block lists enforced on
 * POST /api/v1/admin/auth/login BEFORE credential verification.
 *
 * PERSISTENCE — one Setting JSON doc (house pattern: team docs,
 * connectors ledger), key `security.ip_rules`:
 *   { "allow": ["203.0.113.10", "198.51.100.0/24"], "block": ["192.0.2.55"] }
 * Entries are single IPs or CIDR ranges, IPv4 and IPv6. The doc is a
 * machine-shaped document, so it bypasses the generic settings API
 * (which rejects unregistered keys by design) — reads go through the
 * injected `getSetting` helper, writes through a direct Setting upsert
 * in the admin route (app/api/v1/admin/security/ip-rules).
 *
 * SEMANTICS (isIpAllowed):
 *   1. If the IP matches ANY block entry -> denied (block always wins).
 *   2. Else if the allow list is non-empty and the IP matches NONE of
 *      it -> denied.
 *   3. Else -> allowed.
 * An unparseable caller IP (e.g. no x-forwarded-for header) can never
 * match a block entry; with a non-empty allow list it is denied (it is
 * "not in the list"), with an empty allow list it is allowed.
 *
 * MATCHING — both families share one BigInt code path: an address is a
 * 32/128-bit integer and a CIDR match compares the top `prefix` bits,
 * so IPv6 CIDR is fully supported, not exact-match-only. Host bits in
 * an entry are masked off (203.0.113.10/24 === 203.0.113.0/24).
 * IPv4-mapped IPv6 forms (::ffff:203.0.113.10, as some proxies emit)
 * are normalised to plain IPv4 before comparison, so an IPv4 rule
 * still matches them. IPv6 zone ids (fe80::1%eth0) are rejected.
 *
 * FAIL-OPEN LOADER — loadIpRules never throws and resolves ANY failure
 * (settings read error, corrupt JSON, wrong shape) to EMPTY rules:
 * a broken settings read must never lock every staff member out of the
 * admin. The trade-off is deliberate for v1 — availability of the
 * login path over enforcement while the store is broken; the admin
 * route's GET is the honest surface that reports a DB outage as 503.
 */

export const IP_RULES_SETTING_KEY = "security.ip_rules";

export interface IpRules {
  allow: string[];
  block: string[];
}

export const EMPTY_IP_RULES: IpRules = { allow: [], block: [] };

/* ------------------------------------------------------------------ */
/* Address parsing (pure)                                              */
/* ------------------------------------------------------------------ */

interface ParsedIp {
  family: 4 | 6;
  value: bigint;
}

function parseIpv4ToBigInt(ip: string): bigint | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    // Leading zeros are ambiguous (octal in some parsers) — reject.
    if (part.length > 1 && part.startsWith("0")) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = (value << 8n) | BigInt(n);
  }
  return value;
}

function parseIpv6ToBigInt(ip: string): bigint | null {
  let rest = ip;
  // Embedded IPv4 tail ("::ffff:192.0.2.1", "2001:db8::1.2.3.4"): fold
  // it into two hex groups so the group parser below sees one shape.
  if (rest.includes(".")) {
    const lastColon = rest.lastIndexOf(":");
    if (lastColon < 0) return null;
    const v4 = parseIpv4ToBigInt(rest.slice(lastColon + 1));
    if (v4 === null) return null;
    const hi = Number((v4 >> 16n) & 0xffffn).toString(16);
    const lo = Number(v4 & 0xffffn).toString(16);
    rest = `${rest.slice(0, lastColon)}:${hi}:${lo}`;
  }
  const halves = rest.split("::");
  if (halves.length > 2) return null;
  const parseSide = (side: string): number[] | null => {
    if (side === "") return [];
    const out: number[] = [];
    for (const group of side.split(":")) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
      out.push(parseInt(group, 16));
    }
    return out;
  };
  let groups: number[];
  if (halves.length === 1) {
    const only = parseSide(halves[0] ?? "");
    if (only === null || only.length !== 8) return null;
    groups = only;
  } else {
    const left = parseSide(halves[0] ?? "");
    const right = parseSide(halves[1] ?? "");
    if (left === null || right === null) return null;
    const missing = 8 - left.length - right.length;
    if (missing < 1) return null; // "::" must compress >= 1 group
    groups = [...left, ...new Array<number>(missing).fill(0), ...right];
  }
  let value = 0n;
  for (const group of groups) value = (value << 16n) | BigInt(group);
  return value;
}

/** Parse a bare IP (no prefix). IPv4-mapped IPv6 normalises to IPv4. */
function parseIp(raw: string): ParsedIp | null {
  const ip = raw.trim();
  if (ip === "") return null;
  if (ip.includes(":")) {
    const v6 = parseIpv6ToBigInt(ip);
    if (v6 === null) return null;
    if ((v6 >> 32n) === 0xffffn) return { family: 4, value: v6 & 0xffffffffn };
    return { family: 6, value: v6 };
  }
  const v4 = parseIpv4ToBigInt(ip);
  return v4 === null ? null : { family: 4, value: v4 };
}

/* ------------------------------------------------------------------ */
/* Rule entries (IP or CIDR)                                           */
/* ------------------------------------------------------------------ */

interface IpEntry {
  family: 4 | 6;
  /** Network address with host bits already masked off. */
  network: bigint;
  prefix: number;
}

function bitsFor(family: 4 | 6): number {
  return family === 4 ? 32 : 128;
}

/** Parse one allow/block entry: "203.0.113.10", "203.0.113.0/24", "2001:db8::/32". */
export function parseIpEntry(raw: string): IpEntry | null {
  const entry = raw.trim();
  if (entry === "") return null;
  const slash = entry.indexOf("/");
  if (slash !== entry.lastIndexOf("/")) return null; // at most one "/"
  let ipPart = entry;
  let prefixPart: string | null = null;
  if (slash >= 0) {
    ipPart = entry.slice(0, slash);
    prefixPart = entry.slice(slash + 1);
  }
  const parsed = parseIp(ipPart);
  if (parsed === null) return null;
  const bits = bitsFor(parsed.family);
  let prefix = bits;
  if (prefixPart !== null) {
    if (!/^\d{1,3}$/.test(prefixPart)) return null;
    prefix = Number(prefixPart);
    if (prefix > bits) return null;
  }
  const hostBits = BigInt(bits - prefix);
  const network = (parsed.value >> hostBits) << hostBits;
  return { family: parsed.family, network, prefix };
}

/** True when `entry` is a syntactically valid IP or CIDR rule entry. */
export function isValidIpEntry(entry: string): boolean {
  return parseIpEntry(entry) !== null;
}

function entryMatchesIp(entry: IpEntry, ip: ParsedIp): boolean {
  if (entry.family !== ip.family) return false;
  const hostBits = BigInt(bitsFor(entry.family) - entry.prefix);
  return ip.value >> hostBits === entry.network >> hostBits;
}

/** True when the bare IP `ip` matches the single rule entry `entry`. */
export function ipMatches(ip: string, entry: string): boolean {
  const parsedIp = parseIp(ip);
  const parsedEntry = parseIpEntry(entry);
  if (parsedIp === null || parsedEntry === null) return false;
  return entryMatchesIp(parsedEntry, parsedIp);
}

/* ------------------------------------------------------------------ */
/* Doc sanitising + the allow decision                                 */
/* ------------------------------------------------------------------ */

function sanitiseList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const entry = item.trim();
    if (entry === "" || seen.has(entry)) continue;
    // Invalid entries are dropped, never kept: a stored doc should
    // always be clean (the admin write path rejects invalid entries),
    // so a bad row here means a hand-edited doc — enforcement must
    // not silently depend on a rule nobody can read back.
    if (parseIpEntry(entry) === null) continue;
    seen.add(entry);
    out.push(entry);
  }
  return out;
}

/**
 * Sanitise an unknown doc (parsed object, JSON string, or anything
 * else) into clean IpRules. Never throws; garbage reads as empty.
 */
export function parseIpRules(doc: unknown): IpRules {
  let value: unknown = doc;
  if (typeof value === "string") {
    const text = value.trim();
    if (text === "") return { allow: [], block: [] };
    try {
      value = JSON.parse(text) as unknown;
    } catch {
      return { allow: [], block: [] };
    }
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { allow: [], block: [] };
  }
  const record = value as Record<string, unknown>;
  return { allow: sanitiseList(record.allow), block: sanitiseList(record.block) };
}

/**
 * The login gate. Block wins; a non-empty allow list is a whitelist;
 * an empty allow list allows everything the block list doesn't stop.
 */
export function isIpAllowed(ip: string, rules: IpRules): boolean {
  const parsed = parseIp(ip);
  if (parsed !== null) {
    for (const raw of rules.block) {
      const entry = parseIpEntry(raw);
      if (entry !== null && entryMatchesIp(entry, parsed)) return false;
    }
  }
  if (rules.allow.length === 0) return true;
  if (parsed === null) return false; // unidentifiable caller is not "in the list"
  return rules.allow.some((raw) => {
    const entry = parseIpEntry(raw);
    return entry !== null && entryMatchesIp(entry, parsed);
  });
}

/* ------------------------------------------------------------------ */
/* Loader (settings-backed, fail-open)                                 */
/* ------------------------------------------------------------------ */

export type GetSettingFn = (key: string) => Promise<string | null>;

/**
 * Load the rules doc via the codebase's settings reader (injected,
 * the meta-channels / sms-resolver pattern). ANY failure — the reader
 * throwing, a missing doc, corrupt JSON — resolves to EMPTY rules so
 * the login path fails open instead of locking every staff member out.
 */
export async function loadIpRules(getSetting: GetSettingFn): Promise<IpRules> {
  try {
    const raw = await getSetting(IP_RULES_SETTING_KEY);
    if (raw === null) return { allow: [], block: [] };
    return parseIpRules(raw);
  } catch {
    return { allow: [], block: [] };
  }
}
