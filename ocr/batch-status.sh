#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$script_dir"

if [[ ! -f .env ]]; then
  echo "Missing $script_dir/.env." >&2
  exit 2
fi

set -a
# shellcheck disable=SC1091
source .env
set +a
: "${BATCH_DIR:?Set BATCH_DIR in .env}"

echo "Batch: $BATCH_DIR"
if [[ -f "$BATCH_DIR/completion/COMPLETE.json" ]]; then
  echo "Status: complete"
  cat "$BATCH_DIR/completion/COMPLETE.json"
  exit 0
fi

echo "Status: in progress or not started"
printf 'PDFs: %s\n' "$(find "$BATCH_DIR/pdfs" -type f -name '*.pdf' 2>/dev/null | wc -l)"
printf 'Extractions: %s\n' "$(find "$BATCH_DIR/extraction/documents" -type f -name '*.json.gz' 2>/dev/null | wc -l)"
printf 'Tesseract pages: %s\n' "$(find "$BATCH_DIR/work/tesseract-results/pages" -type f -name '*.json.gz' 2>/dev/null | wc -l)"
printf 'Paddle pages: %s\n' "$(find "$BATCH_DIR/work/paddle-results/pages" -type f -name '*.json.gz' 2>/dev/null | wc -l)"
du -sh "$BATCH_DIR" 2>/dev/null || true

for log in "$BATCH_DIR"/work/logs/tesseract-*.log; do
  if [[ -f "$log" ]]; then
    printf '\n--- %s ---\n' "$(basename "$log")"
    tail -n 2 "$log"
  fi
done
