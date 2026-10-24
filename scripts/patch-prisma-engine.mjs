// Runs at the end of the web build (apps/web package.json "build").
// In this pnpm monorepo, Next's nft tracing does not include the Prisma
// query-engine binary (.so.node) in every serverless function's file
// manifest, so some routes fail at runtime with "Prisma Client could
// not locate the Query Engine for runtime rhel-openssl-3.0.x". Fix: add
// the engine's repo-relative path to every .nft.json manifest and copy
// the file into .next/server (another location the client searches).
import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const storeDir = path.join(repoRoot, "node_modules", ".pnpm");

let engineAbs = null;
for (const entry of readdirSync(storeDir)) {
  if (!entry.startsWith("@prisma+client@")) continue;
  const dir = path.join(storeDir, entry, "node_modules", ".prisma", "client");
  if (!existsSync(dir)) continue;
  const hit = readdirSync(dir).find((f) => f.startsWith("libquery_engine-") && f.endsWith(".so.node"));
  if (hit) { engineAbs = path.join(dir, hit); break; }
}
if (!engineAbs) {
  console.log("[patch-prisma-engine] engine not found — skipping");
  process.exit(0);
}
const nextDir = path.join(repoRoot, "apps", "web", ".next");
let patched = 0;
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".nft.json")) {
      // nft "files" entries are relative to the MANIFEST'S OWN directory
      // (e.g. "../../../../../node_modules/..."), so the engine entry
      // must be computed per manifest.
      const rel = path.relative(path.dirname(p), engineAbs).split(path.sep).join("/");
      const j = JSON.parse(readFileSync(p, "utf8"));
      if (Array.isArray(j.files) && !j.files.includes(rel)) {
        j.files.push(rel);
        writeFileSync(p, JSON.stringify(j));
        patched++;
      }
    }
  }
})(nextDir);
cpSync(engineAbs, path.join(nextDir, "server", path.basename(engineAbs)));
console.log(`[patch-prisma-engine] engine added to ${patched} nft manifests and copied to .next/server`);
