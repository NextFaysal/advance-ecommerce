/**
 * Media uploads — SERVER side (P1, doc 16). The pure contract lives in
 * src/catalog/media.ts; THIS module is server-only (Settings store +
 * node:crypto) and implements the real direct-upload pipeline:
 *
 *  - Storage config resolves the house way (src/lib/settings.ts):
 *    Admin Settings row (secrets AES-256-GCM encrypted) -> env
 *    fallback -> built-in default. Provider is `storage.provider`
 *    ("r2" | "s3"); the provider's fields ride the provider-scoped
 *    settings pattern storage.<provider>.<field>:
 *      endpoint, region, bucket, access_key_id (secret),
 *      secret_access_key (secret), public_url
 *    plus the shared keys `storage.bucket` and `storage.cdn_url`
 *    (public base URL; env NEXT_PUBLIC_CDN_URL). Flat env fallbacks:
 *    STORAGE_PROVIDER / STORAGE_ENDPOINT / STORAGE_REGION /
 *    STORAGE_BUCKET / STORAGE_ACCESS_KEY_ID /
 *    STORAGE_SECRET_ACCESS_KEY / STORAGE_PUBLIC_URL.
 *  - Presigning is hand-rolled AWS Signature V4 (query-string auth)
 *    with node:crypto only — no @aws-sdk dependency, same approach as
 *    the web-push sender hand-rolling RFC 8291/8292. The signed
 *    headers are host + content-type + content-length, so storage
 *    rejects a PUT whose type or size differs from what the server
 *    validated (the 5 MB cap is enforced by storage, not by trust).
 *  - When storage is not fully configured, createProductImageUploads
 *    returns STORAGE_NOT_CONFIGURED and signs NOTHING — an upload is
 *    never reported as possible when it is not. Credentials are used
 *    to sign and are never returned, logged, or sent to the client;
 *    the client receives only the presigned URL + the public URL.
 */
import { createHash, createHmac, randomBytes } from "node:crypto";
import {
  getIntegrationConfigWithSecrets,
  getSetting,
} from "@/lib/settings";
import {
  MAX_DIGITAL_FILE_BYTES,
  MAX_DIGITAL_UPLOADS_PER_REQUEST,
  MAX_UPLOADS_PER_REQUEST,
  MAX_UPLOAD_BYTES,
  UPLOAD_EXPIRES_SECONDS,
  buildR2Key,
  isAllowedDigitalMime,
  isAllowedImageMime,
  type DigitalUploadTicket,
  type PresignedUploadTicket,
} from "./media";

/* ------------------------------------------------------------------ */
/* Storage configuration                                               */
/* ------------------------------------------------------------------ */

export interface StorageConfig {
  provider: "r2" | "s3";
  /** S3 API endpoint origin (+ optional path prefix), no trailing slash. */
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Public base URL objects are served from (CDN / R2 public / bucket URL), no trailing slash. */
  publicBaseUrl: string;
}

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

/**
 * Resolve the effective storage config, or null when any required
 * piece (endpoint, bucket, either credential, public base URL) is
 * missing. Never throws on a missing DB — an unreachable settings
 * store simply means "not configured" for upload purposes.
 */
export async function resolveStorageConfig(): Promise<StorageConfig | null> {
  const providerRaw = clean(await getSetting("storage.provider").catch(() => null));
  const provider: "r2" | "s3" = providerRaw === "s3" ? "s3" : "r2";

  let scoped: Record<string, string> = {};
  try {
    scoped = await getIntegrationConfigWithSecrets("storage", provider);
  } catch {
    scoped = {};
  }
  const fromSettings = (field: string): string => clean(scoped[field]);

  const region =
    fromSettings("region") ||
    clean(process.env.STORAGE_REGION) ||
    (provider === "r2" ? "auto" : "us-east-1");
  const bucket =
    fromSettings("bucket") ||
    clean(await getSetting("storage.bucket").catch(() => null)) ||
    clean(process.env.STORAGE_BUCKET);
  const endpoint = stripTrailingSlashes(
    fromSettings("endpoint") ||
      clean(process.env.STORAGE_ENDPOINT) ||
      // R2 endpoints are account-specific (no safe default); plain S3
      // can default to the regional AWS endpoint.
      (provider === "s3" ? `https://s3.${region}.amazonaws.com` : ""),
  );
  const accessKeyId = fromSettings("access_key_id") || clean(process.env.STORAGE_ACCESS_KEY_ID);
  const secretAccessKey =
    fromSettings("secret_access_key") || clean(process.env.STORAGE_SECRET_ACCESS_KEY);
  const publicBaseUrl = stripTrailingSlashes(
    clean(await getSetting("storage.cdn_url").catch(() => null)) ||
      fromSettings("public_url") ||
      clean(process.env.STORAGE_PUBLIC_URL) ||
      (endpoint !== "" && bucket !== "" ? `${endpoint}/${bucket}` : ""),
  );

  if (endpoint === "" || bucket === "" || accessKeyId === "" || secretAccessKey === "" || publicBaseUrl === "") {
    return null;
  }
  try {
    // A malformed endpoint (e.g. typed without a scheme) is a
    // configuration problem, not a server error — report it the same
    // honest way as a missing one instead of throwing at sign time.
    new URL(endpoint);
    new URL(publicBaseUrl);
  } catch {
    return null;
  }
  return { provider, endpoint, region, bucket, accessKeyId, secretAccessKey, publicBaseUrl };
}

export async function isStorageConfigured(): Promise<boolean> {
  return (await resolveStorageConfig()) !== null;
}

/* ------------------------------------------------------------------ */
/* AWS Signature V4 presigning (query-string auth, PUT object)         */
/* ------------------------------------------------------------------ */

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

/** URI-encode each path segment; the "/" separators stay literal. */
function encodeKeyPath(key: string): string {
  return key.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

function deriveSigningKey(secretAccessKey: string, dateStamp: string, region: string): Buffer {
  const kDate = hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, "s3");
  return hmacSha256(kService, "aws4_request");
}

/**
 * Presign a PUT for one object. Virtual-hosted style
 * (https://<bucket>.<endpoint-host>/<key>) — the style both R2 and
 * AWS S3 prefer; an endpoint path prefix (rare, e.g. a MinIO mount)
 * is preserved in front of the key.
 */
export function presignPutObject(input: {
  config: StorageConfig;
  key: string;
  contentType: string;
  sizeBytes: number;
  expiresInSeconds?: number;
}): string {
  const { config, key, contentType, sizeBytes } = input;
  const expires = input.expiresInSeconds ?? UPLOAD_EXPIRES_SECONDS;

  const endpointUrl = new URL(config.endpoint);
  const host = `${config.bucket}.${endpointUrl.host}`;
  const basePath = endpointUrl.pathname.replace(/\/+$/, "");
  const canonicalUri = `${basePath}/${encodeKeyPath(key)}`;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const signedHeaders = "content-length;content-type;host";

  const queryParams: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${config.accessKeyId}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expires),
    "X-Amz-SignedHeaders": signedHeaders,
  };
  const canonicalQuery = Object.keys(queryParams)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(queryParams[k] as string)}`)
    .join("&");

  const canonicalHeaders =
    `content-length:${sizeBytes}\n` + `content-type:${contentType}\n` + `host:${host}\n`;
  const canonicalRequest = [
    "PUT",
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256Hex(canonicalRequest)].join("\n");
  const signature = createHmac("sha256", deriveSigningKey(config.secretAccessKey, dateStamp, config.region))
    .update(stringToSign, "utf8")
    .digest("hex");

  const scheme = endpointUrl.protocol.replace(/:$/, "");
  return `${scheme}://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/* ------------------------------------------------------------------ */
/* Upload tickets for the admin endpoint                               */
/* ------------------------------------------------------------------ */

export interface UploadFileRequest {
  filename: string;
  contentType: string;
  sizeBytes: number;
}

export type CreateUploadsResult =
  | { ok: true; uploads: PresignedUploadTicket[] }
  | { ok: false; code: "STORAGE_NOT_CONFIGURED"; message: string }
  | { ok: false; code: "INVALID_FILE"; message: string };

function sanitizeSlug(value: string | null | undefined): string {
  const slug = (value ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "product";
}

/**
 * Validate the batch and mint one presigned PUT ticket per file.
 * File bytes never pass through this server: the client PUTs each
 * file straight to storage at `uploadUrl`, then stores `publicUrl`
 * on the product. Validation errors reject the WHOLE batch (no
 * half-issued ticket sets to reconcile in the editor).
 */
export async function createProductImageUploads(input: {
  productSlug?: string | null;
  files: UploadFileRequest[];
}): Promise<CreateUploadsResult> {
  if (input.files.length === 0) {
    return { ok: false, code: "INVALID_FILE", message: "কোনো ফাইল পাঠানো হয়নি।" };
  }
  if (input.files.length > MAX_UPLOADS_PER_REQUEST) {
    return {
      ok: false,
      code: "INVALID_FILE",
      message: `একবারে সর্বোচ্চ ${MAX_UPLOADS_PER_REQUEST}টি ছবি আপলোড করা যাবে।`,
    };
  }
  for (const file of input.files) {
    if (!isAllowedImageMime(file.contentType)) {
      return {
        ok: false,
        code: "INVALID_FILE",
        message: `অসমর্থিত ছবির ধরন: ${file.filename} (${file.contentType || "unknown"}) — JPEG, PNG, WebP বা AVIF ব্যবহার করুন।`,
      };
    }
    if (!Number.isInteger(file.sizeBytes) || file.sizeBytes <= 0 || file.sizeBytes > MAX_UPLOAD_BYTES) {
      return {
        ok: false,
        code: "INVALID_FILE",
        message: `${file.filename}: ছবির আকার 0-এর বেশি এবং সর্বোচ্চ ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB হতে হবে।`,
      };
    }
    if (typeof file.filename !== "string" || file.filename.trim() === "") {
      return { ok: false, code: "INVALID_FILE", message: "ফাইলের নাম আবশ্যক।" };
    }
  }

  const config = await resolveStorageConfig();
  if (config === null) {
    return {
      ok: false,
      code: "STORAGE_NOT_CONFIGURED",
      message:
        "স্টোরেজ কনফিগার করা হয়নি — Admin > Settings-এ R2/S3 endpoint, bucket ও access key সেট করুন, তারপর আবার চেষ্টা করুন। ততক্ষণ ছবির URL বসিয়ে কাজ চালানো যাবে।",
    };
  }

  const slug = sanitizeSlug(input.productSlug);
  const uploads: PresignedUploadTicket[] = input.files.map((file) => {
    // Random infix: two same-named files in one batch (or one
    // millisecond) must never mint the same object key.
    const key = buildR2Key(slug, `${randomBytes(4).toString("hex")}-${file.filename}`);
    return {
      filename: file.filename,
      contentType: file.contentType,
      sizeBytes: file.sizeBytes,
      key,
      uploadUrl: presignPutObject({ config, key, contentType: file.contentType, sizeBytes: file.sizeBytes }),
      publicUrl: `${config.publicBaseUrl}/${encodeKeyPath(key)}`,
      expiresInSeconds: UPLOAD_EXPIRES_SECONDS,
    };
  });
  return { ok: true, uploads };
}

/* ------------------------------------------------------------------ */
/* Digital product files (wave 15) — presigned PUT tickets + GET       */
/* ------------------------------------------------------------------ */

export type CreateDigitalUploadsResult =
  | { ok: true; uploads: DigitalUploadTicket[] }
  | { ok: false; code: "STORAGE_NOT_CONFIGURED"; message: string }
  | { ok: false; code: "INVALID_FILE"; message: string };

/**
 * Validate a digital-file batch and mint one presigned PUT ticket per
 * file, under the `digital/` prefix. Same honesty rule as images: no
 * storage config -> STORAGE_NOT_CONFIGURED and nothing is signed.
 * Digital files are never public — the ticket deliberately carries no
 * publicUrl; downloads happen only via DownloadGrant presigned GETs.
 */
export async function createDigitalFileUploads(input: {
  productSlug?: string | null;
  files: UploadFileRequest[];
}): Promise<CreateDigitalUploadsResult> {
  if (input.files.length === 0) {
    return { ok: false, code: "INVALID_FILE", message: "কোনো ফাইল পাঠানো হয়নি।" };
  }
  if (input.files.length > MAX_DIGITAL_UPLOADS_PER_REQUEST) {
    return {
      ok: false,
      code: "INVALID_FILE",
      message: `একবারে সর্বোচ্চ ${MAX_DIGITAL_UPLOADS_PER_REQUEST}টি ফাইল আপলোড করা যাবে।`,
    };
  }
  for (const file of input.files) {
    if (!isAllowedDigitalMime(file.contentType)) {
      return {
        ok: false,
        code: "INVALID_FILE",
        message: `অসমর্থিত ফাইলের ধরন: ${file.filename} (${file.contentType || "unknown"}) — ZIP, PDF, EPUB বা BIN ব্যবহার করুন।`,
      };
    }
    if (!Number.isInteger(file.sizeBytes) || file.sizeBytes <= 0 || file.sizeBytes > MAX_DIGITAL_FILE_BYTES) {
      return {
        ok: false,
        code: "INVALID_FILE",
        message: `${file.filename}: ফাইলের আকার 0-এর বেশি এবং সর্বোচ্চ ${MAX_DIGITAL_FILE_BYTES / (1024 * 1024)} MB হতে হবে।`,
      };
    }
    if (typeof file.filename !== "string" || file.filename.trim() === "") {
      return { ok: false, code: "INVALID_FILE", message: "ফাইলের নাম আবশ্যক।" };
    }
  }

  const config = await resolveStorageConfig();
  if (config === null) {
    return {
      ok: false,
      code: "STORAGE_NOT_CONFIGURED",
      message:
        "স্টোরেজ কনফিগার করা হয়নি — Admin > Settings-এ R2/S3 endpoint, bucket ও access key সেট করুন, তারপর আবার চেষ্টা করুন।",
    };
  }

  const slug = sanitizeSlug(input.productSlug);
  const uploads: DigitalUploadTicket[] = input.files.map((file) => {
    const safeName = file.filename
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "file";
    const key = `digital/${slug}/${Date.now()}-${randomBytes(4).toString("hex")}-${safeName}`;
    return {
      filename: file.filename,
      contentType: file.contentType,
      sizeBytes: file.sizeBytes,
      storageKey: key,
      uploadUrl: presignPutObject({ config, key, contentType: file.contentType, sizeBytes: file.sizeBytes }),
      expiresInSeconds: UPLOAD_EXPIRES_SECONDS,
    };
  });
  return { ok: true, uploads };
}

/**
 * Presign a GET for one object (wave 15 download grants). Host-only
 * signed headers — a GET carries no content headers to bind. Returns
 * null when storage is not configured (the caller answers honestly
 * instead of redirecting nowhere).
 */
export function presignGetObject(input: {
  config: StorageConfig;
  key: string;
  expiresInSeconds?: number;
}): string {
  const { config, key } = input;
  const expires = input.expiresInSeconds ?? 900;

  const endpointUrl = new URL(config.endpoint);
  const host = `${config.bucket}.${endpointUrl.host}`;
  const basePath = endpointUrl.pathname.replace(/\/+$/, "");
  const canonicalUri = `${basePath}/${encodeKeyPath(key)}`;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const signedHeaders = "host";

  const queryParams: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${config.accessKeyId}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expires),
    "X-Amz-SignedHeaders": signedHeaders,
  };
  const canonicalQuery = Object.keys(queryParams)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(queryParams[k] as string)}`)
    .join("&");

  const canonicalRequest = [
    "GET",
    canonicalUri,
    canonicalQuery,
    `host:${host}\n`,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256Hex(canonicalRequest)].join("\n");
  const signature = createHmac("sha256", deriveSigningKey(config.secretAccessKey, dateStamp, config.region))
    .update(stringToSign, "utf8")
    .digest("hex");

  const scheme = endpointUrl.protocol.replace(/:$/, "");
  return `${scheme}://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
