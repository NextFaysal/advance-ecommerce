/**
 * SSRF guard for webhook endpoint URLs — ADV-26 (doc 22).
 *
 * Modelled on the sourcing importer's guard (src/sourcing/extract.ts
 * assertUrlAllowed — same range tables, same blocked host suffixes)
 * but owned here: the importer's guard is module-private and throws
 * its own error type, and webhook endpoints must be validated at
 * creation time (and re-validated at delivery time, so an endpoint
 * created before a policy change can't be used to reach a private
 * address either).
 *
 * Local-test escape hatch: AE_WEBHOOK_ALLOW_PRIVATE=1 allows LOOPBACK
 * targets only (127.0.0.0/8, ::1, localhost) so a developer can point
 * an endpoint at a local receiver. Private LAN ranges (10/8,
 * 172.16/12, 192.168/16), link-local (169.254/16 — cloud metadata),
 * CGNAT, multicast and reserved ranges stay blocked EVEN WITH the
 * hatch on. The hatch is read per call and defaults OFF; production
 * never sets it.
 */

export class WebhookUrlError extends Error {
  readonly code: "INVALID_URL" | "BLOCKED_HOST";
  constructor(code: "INVALID_URL" | "BLOCKED_HOST", message: string) {
    super(message);
    this.name = "WebhookUrlError";
    this.code = code;
  }
}

function allowLoopbackForTest(): boolean {
  return process.env.AE_WEBHOOK_ALLOW_PRIVATE === "1";
}

function ipv4Octets(ip: string): [number, number, number, number] | null {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return parts as [number, number, number, number];
}

function ipv4IsLoopback(ip: string): boolean {
  const o = ipv4Octets(ip);
  return o !== null && o[0] === 127;
}

function ipv4IsPrivateOrReserved(ip: string): boolean {
  const o = ipv4Octets(ip);
  if (o === null) return true; // malformed literal — treat as blocked
  const [a, b] = o;
  if (a === 0 || a === 10 || a === 127) return true; // this-host, private, loopback
  if (a === 169 && b === 254) return true; // link-local (cloud metadata!)
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast / reserved
  return false;
}

/**
 * Validate a webhook target URL. Returns the parsed URL or throws
 * WebhookUrlError. Hostname (DNS) targets are allowed — like the
 * sourcing guard, literal IPs are range-checked; DNS rebinding is
 * out of scope for this layer (documented in the ADV-26 report).
 */
export function assertWebhookUrlAllowed(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new WebhookUrlError("INVALID_URL", "URL টি সঠিক নয় — https:// সহ পুরো ঠিকানা দিন।");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new WebhookUrlError("INVALID_URL", "শুধু http/https URL গ্রহণযোগ্য।");
  }
  if (url.username || url.password) {
    throw new WebhookUrlError("INVALID_URL", "URL-এ ব্যবহারকারী/পাসওয়ার্ড থাকা যাবে না।");
  }
  const host = url.hostname.toLowerCase();
  const loopbackAllowed = allowLoopbackForTest();

  if (host === "localhost" || host.endsWith(".localhost")) {
    if (loopbackAllowed) return url;
    throw new WebhookUrlError("BLOCKED_HOST", "লোকাল ঠিকানায় ওয়েবহুক পাঠানো যাবে না।");
  }
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan")) {
    throw new WebhookUrlError("BLOCKED_HOST", "অভ্যন্তরীণ ঠিকানায় ওয়েবহুক পাঠানো যাবে না।");
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    if (loopbackAllowed && ipv4IsLoopback(host)) return url;
    if (ipv4IsPrivateOrReserved(host)) {
      throw new WebhookUrlError("BLOCKED_HOST", "ব্যক্তিগত/সংরক্ষিত IP ঠিকানায় ওয়েবহুক পাঠানো যাবে না।");
    }
    return url;
  }
  if (host.includes(":")) {
    const v6 = host.toLowerCase();
    if ((v6 === "::1" || v6 === "[::1]") && loopbackAllowed) return url;
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(v6);
    if (
      v6 === "::1" ||
      v6 === "::" ||
      v6.startsWith("fe8") || v6.startsWith("fe9") || v6.startsWith("fea") || v6.startsWith("feb") || // fe80::/10
      v6.startsWith("fc") || v6.startsWith("fd") || // fc00::/7
      (mapped !== null && ipv4IsPrivateOrReserved(mapped[1] as string))
    ) {
      throw new WebhookUrlError("BLOCKED_HOST", "ব্যক্তিগত/সংরক্ষিত IP ঠিকানায় ওয়েবহুক পাঠানো যাবে না।");
    }
  }
  return url;
}
