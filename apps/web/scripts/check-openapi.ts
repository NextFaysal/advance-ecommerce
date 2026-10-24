/**
 * OpenAPI drift check — keeps src/platform/openapi.ts honest.
 *
 * Run:
 *   pnpm --filter web check:openapi
 *   # or directly: ./node_modules/.bin/tsx scripts/check-openapi.ts
 *
 * What it does:
 *   Compares the API_ROUTE_REGISTRY in src/platform/openapi.ts against
 *   the filesystem truth — every app/api/**\/route.ts file and the HTTP
 *   method handlers it exports — in BOTH directions:
 *     - an operation on disk but missing from the registry  -> drift
 *     - an operation in the registry but missing on disk   -> drift
 *   Exit 0 when the two sets agree exactly, exit 1 with the diff
 *   printed when they do not. Run it after adding/removing any API
 *   route; it is the saved form of the check the final audits ran by
 *   hand (docs/FINAL-AUDIT-V4.md §7.2).
 *
 * Derivation rules (mirror of routeFileForPath in openapi.ts, inverted):
 *   app/api/v1/admin/orders/[id]/route.ts  <->  /api/v1/admin/orders/{id}
 *   ([param] segments become {param}; the file's directory under
 *   app/api maps onto the path under /api.)
 *
 * Registry exclusions: entries added with x(...) in openapi.ts carry
 * includeInSpec: false + a reason (today: the two signature-verified
 * third-party webhooks and the internal system health probe). They are
 * part of the registry <-> filesystem comparison — they must exist on
 * disk — and are only withheld from the published OpenAPI document.
 * This script reports them as "exclusions applied" and counts them.
 *
 * Method stubs: a handler whose entire body returns
 * 405 METHOD_NOT_ALLOWED is a deliberate method guard on a POST-only
 * endpoint, not an API operation (4 exist today: GET on admin login,
 * public contact, public orders, public track-events). Stubs are
 * listed separately and excluded from the operation set. If a registry
 * entry ever points at a stub-only handler, the entry shows up as
 * "in registry but NOT on disk" and the check fails — misclassification
 * fails loudly, never silently.
 *
 * Fixture self-test (does not touch the real tree):
 *   CHECK_OPENAPI_API_ROOT=/tmp/some-copied-api-tree \
 *     ./node_modules/.bin/tsx scripts/check-openapi.ts
 *   points the filesystem walker at another app/api-shaped directory.
 *
 * The registry module (src/platform/openapi.ts) has no imports at all,
 * so importing it here pulls in no Prisma client and no network.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { API_ROUTE_REGISTRY } from "../src/platform/openapi";

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

interface DiskHandler {
  method: HttpMethod;
  apiPath: string;
  /** Path relative to the web app root, e.g. app/api/v1/admin/queues/route.ts */
  file: string;
  /** True when the handler body only returns 405 METHOD_NOT_ALLOWED. */
  isMethodStub: boolean;
}

function resolveApiRoot(): { apiRoot: string; appRoot: string } {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const appRoot = path.resolve(scriptDir, "..");
  const override = process.env.CHECK_OPENAPI_API_ROOT;
  if (override) return { apiRoot: path.resolve(override), appRoot };
  return { apiRoot: path.join(appRoot, "app", "api"), appRoot };
}

function walkRouteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkRouteFiles(full));
    else if (entry.isFile() && entry.name === "route.ts") out.push(full);
  }
  return out.sort();
}

/** Inverse of routeFileForPath(): a route.ts file -> its /api path. */
function apiPathForFile(apiRoot: string, file: string): string {
  const segments = path
    .relative(apiRoot, path.dirname(file))
    .split(path.sep)
    .filter((s) => s !== "" && s !== ".")
    .map((seg) => {
      const m = /^\[\.{0,3}(.+)\]$/.exec(seg);
      return m ? `{${m[1]}}` : seg;
    });
  return segments.length ? `/api/${segments.join("/")}` : "/api";
}

const EXPORT_RE =
  /export\s+(?:async\s+function|function|const|let|var)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g;

/**
 * Extract the body of the handler whose export starts at `fromIndex`:
 * from the first "{" after the export to its matching "}". Strings and
 * comments are skipped so braces inside them do not end the body early.
 * Returns null when no balanced body is found.
 */
function extractBody(source: string, fromIndex: number): string | null {
  const open = source.indexOf("{", fromIndex);
  if (open === -1) return null;
  let depth = 0;
  let i = open;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      i = end === -1 ? source.length : end + 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      i += 1;
      while (i < source.length && source[i] !== ch) {
        if (source[i] === "\\") i += 1;
        i += 1;
      }
      i += 1;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
    i += 1;
  }
  return null;
}

function extractHandlers(apiRoot: string, appRoot: string, file: string): DiskHandler[] {
  const source = readFileSync(file, "utf8");
  const apiPath = apiPathForFile(apiRoot, file);
  const relDisplay = path.relative(appRoot, file).split(path.sep).join("/");
  // In fixture mode (CHECK_OPENAPI_API_ROOT outside the app) the relative
  // path is meaningless — fall back to the absolute path.
  const display = relDisplay.startsWith("..") ? file : relDisplay;
  const handlers: DiskHandler[] = [];
  const seen = new Set<string>();
  EXPORT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = EXPORT_RE.exec(source)) !== null) {
    const method = match[1] as HttpMethod;
    if (seen.has(method)) continue;
    seen.add(method);
    const body = extractBody(source, match.index) ?? source.slice(match.index, match.index + 1000);
    const isMethodStub = body.includes("405") && body.includes("METHOD_NOT_ALLOWED");
    handlers.push({ method, apiPath, file: display, isMethodStub });
  }
  return handlers;
}

function main(): number {
  const { apiRoot, appRoot } = resolveApiRoot();
  const routeFiles = walkRouteFiles(apiRoot);

  const diskOps = new Map<string, DiskHandler>();
  const stubs: DiskHandler[] = [];
  let handlerCount = 0;
  for (const file of routeFiles) {
    for (const handler of extractHandlers(apiRoot, appRoot, file)) {
      handlerCount += 1;
      if (handler.isMethodStub) {
        stubs.push(handler);
      } else {
        diskOps.set(`${handler.method} ${handler.apiPath}`, handler);
      }
    }
  }

  const registryOps = new Map<string, (typeof API_ROUTE_REGISTRY)[number]>();
  const registryDuplicates: string[] = [];
  for (const entry of API_ROUTE_REGISTRY) {
    const key = `${entry.method} ${entry.path}`;
    if (registryOps.has(key)) registryDuplicates.push(key);
    registryOps.set(key, entry);
  }
  const exclusions = API_ROUTE_REGISTRY.filter((e) => !e.includeInSpec);
  const publishedCount = API_ROUTE_REGISTRY.length - exclusions.length;

  const stubKeys = new Set(stubs.map((s) => `${s.method} ${s.apiPath}`));
  const onDiskNotInRegistry: DiskHandler[] = [];
  for (const [key, handler] of diskOps) {
    if (!registryOps.has(key)) onDiskNotInRegistry.push(handler);
  }
  const inRegistryNotOnDisk: Array<{ key: string; stubOnly: boolean }> = [];
  for (const key of registryOps.keys()) {
    if (!diskOps.has(key)) inRegistryNotOnDisk.push({ key, stubOnly: stubKeys.has(key) });
  }

  const lines: string[] = [];
  lines.push("OpenAPI drift check — registry (src/platform/openapi.ts) vs filesystem (app/api/**/route.ts)");
  lines.push(`API root scanned: ${apiRoot}`);
  lines.push(`Route files scanned: ${routeFiles.length}`);
  lines.push(`Handlers exported on disk: ${handlerCount} (including ${stubs.length} method stubs)`);
  lines.push(`Operations on disk: ${diskOps.size}`);
  lines.push(
    `Registry entries: ${API_ROUTE_REGISTRY.length} (${publishedCount} published in spec, ${exclusions.length} excluded)`,
  );
  lines.push("");
  lines.push("Exclusions applied (in the registry and on disk; withheld from the published spec):");
  for (const entry of exclusions) {
    lines.push(`  - ${entry.method} ${entry.path} — ${entry.exclusionReason ?? "(no reason recorded)"}`);
  }
  lines.push("");
  lines.push("Method stubs on disk (405 METHOD_NOT_ALLOWED guards — not operations):");
  for (const stub of stubs) {
    lines.push(`  - ${stub.method} ${stub.apiPath} (${stub.file})`);
  }
  lines.push("");
  lines.push("On disk but NOT in registry:");
  if (onDiskNotInRegistry.length === 0) lines.push("  (none)");
  for (const handler of onDiskNotInRegistry) {
    lines.push(`  - ${handler.method} ${handler.apiPath} (${handler.file})`);
  }
  lines.push("In registry but NOT on disk:");
  if (inRegistryNotOnDisk.length === 0) lines.push("  (none)");
  for (const item of inRegistryNotOnDisk) {
    lines.push(`  - ${item.key}${item.stubOnly ? " (handler exists but is only a 405 method stub)" : ""}`);
  }
  if (registryDuplicates.length > 0) {
    lines.push("Duplicate registry entries:");
    for (const key of registryDuplicates) lines.push(`  - ${key}`);
  }
  lines.push("");
  const drift =
    onDiskNotInRegistry.length + inRegistryNotOnDisk.length + registryDuplicates.length;
  if (drift === 0) {
    lines.push(
      `RESULT: PASS — registry and filesystem agree on ${diskOps.size} operations ` +
        `(${publishedCount} published + ${exclusions.length} documented exclusions).`,
    );
    console.log(lines.join("\n"));
    return 0;
  }
  lines.push(`RESULT: FAIL — ${drift} drift item(s) found. Update API_ROUTE_REGISTRY or the route files so they agree.`);
  console.log(lines.join("\n"));
  return 1;
}

process.exit(main());
