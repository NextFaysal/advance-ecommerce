#!/usr/bin/env bash
# Production logical backup — see docs/BACKUP-RESTORE.md.
#
# Usage:
#   DATABASE_URL='<production connection string>' ./scripts/backup-prod.sh
#
# The connection string is read from the environment ONLY — it is never
# printed, logged, or written to disk by this script. Output goes to
# ./backups/ (git-ignored by convention: dumps contain customer data —
# never commit a dump).
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL is not set. Export the production connection" >&2
  echo "string in this shell only (see docs/BACKUP-RESTORE.md)." >&2
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "ERROR: pg_dump not found on PATH (install postgresql-client)." >&2
  exit 1
fi

OUT_DIR="$(cd "$(dirname "$0")/.." && pwd)/backups"
mkdir -p "$OUT_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$OUT_DIR/prod-$STAMP.dump"

echo "Dumping production database (custom format) -> $OUT"
pg_dump --format=custom --no-owner --no-privileges -d "$DATABASE_URL" -f "$OUT"

sha256sum "$OUT" > "$OUT.sha256"
SIZE="$(du -h "$OUT" | cut -f1)"
echo "Done: $OUT ($SIZE), checksum in $OUT.sha256"
echo "Reminder: copy this dump OFF this machine (R2/off-site) — a backup"
echo "that lives only next to the database is not a backup."
