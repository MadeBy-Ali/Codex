#!/usr/bin/env bash
# Upload the codex's STATIC shell (page, scribe tools, styles) to the VPS.
# It never touches posts.json or p/: once the scribe API is live, those belong to the server,
# and uploading them from here would overwrite what you wrote from your phone.
# Usage: ./publish.sh          (upload)
#        ./publish.sh --dry    (show what would be uploaded, change nothing)
set -euo pipefail
cd "$(dirname "$0")"

SERVER="ubuntu@43.133.130.53"
REMOTE="/var/www/codex/"

DRY=""
if [ "${1:-}" = "--dry" ]; then DRY="--dry-run"; echo "Dry run: nothing will be uploaded."; fi

echo "Uploading to $SERVER:$REMOTE ..."
rsync -avz $DRY \
  --exclude .git --exclude .gitignore --exclude .DS_Store \
  --exclude posts --exclude posts.json --exclude p \
  --exclude api --exclude build.mjs --exclude md.mjs --exclude publish.sh \
  --exclude '*.md' \
  ./ "$SERVER:$REMOTE"

echo "Done. https://codex.limvoid.com"
