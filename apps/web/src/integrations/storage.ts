// StorageProvider adapter interface — Agent 5 (base only).
// Default: Cloudflare R2 (S3-compatible). Admin can override endpoint/bucket/CDN
// in Admin > Settings > Integrations. No credentials in code; only a credential reference.
import type { ProviderConfig } from "./types";

export type StorageProviderName = "r2" | "s3";

export interface UploadInput {
  /** Original filename, sanitised at upload time; never trust a client-supplied path. */
  filename: string;
  contentType: string;
  /** Size guard is enforced before upload (Step 9 media pipeline). */
  sizeBytes: number;
}

export interface UploadResult {
  key: string;
  /** Public/CDN URL, or null for private objects served via a signed route. */
  url: string | null;
}

export interface StorageProvider {
  readonly name: StorageProviderName;
  readonly config: ProviderConfig;
  upload(input: UploadInput): Promise<UploadResult>;
  delete(key: string): Promise<boolean>;
}

export interface StorageSettings {
  provider: StorageProviderName;
  endpoint: string | null;
  region: string;
  bucket: string | null;
  cdnUrl: string | null;
  credentialRef: string | null;
}
