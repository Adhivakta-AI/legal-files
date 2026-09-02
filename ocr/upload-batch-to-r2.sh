#!/usr/bin/env bash
# Archive one finished batch's finalized OCR output to Cloudflare R2.
#
# Run this on the machine that holds the finished BATCH_DIR. A batch must have
# completion/COMPLETE.json (written by `judgment-ocr verify-batch`, the last
# step of run-batch.sh) before it can be uploaded — this refuses half-finished
# batches on purpose. Only the finalized output is uploaded: the manifest, the
# per-judgment page text, the search chunks, and the checksums/completion
# record. Raw PDFs, embedded-text extraction, and intermediate OCR results are
# not archived; they can always be regenerated from the manifest.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$script_dir"

if [[ ! -f .env ]]; then
  echo "Missing $script_dir/.env. Copy .env.example to .env and set BATCH_DIR / R2_*." >&2
  exit 2
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

: "${BATCH_DIR:?Set BATCH_DIR in .env}"
: "${R2_BUCKET:?Set R2_BUCKET in .env}"
: "${R2_ENDPOINT_URL:?Set R2_ENDPOINT_URL in .env}"
profile="${AWS_PROFILE:-r2}"
batch_id="${BATCH_ID:-$(basename "$BATCH_DIR")}"

if [[ "$BATCH_DIR" != /* ]]; then
  echo "BATCH_DIR must be an absolute host path: $BATCH_DIR" >&2
  exit 2
fi
if [[ ! -f "$BATCH_DIR/completion/COMPLETE.json" ]]; then
  echo "Refusing to upload: $BATCH_DIR/completion/COMPLETE.json is missing." >&2
  echo "Run ./run-batch.sh to completion first, or check ./batch-status.sh." >&2
  exit 1
fi
for required in manifest.jsonl extraction/summary.json final/chunks.jsonl.gz final/summary.json completion/checksums.sha256; do
  if [[ ! -f "$BATCH_DIR/$required" ]]; then
    echo "Refusing to upload: $BATCH_DIR/$required is missing." >&2
    exit 1
  fi
done

s3() {
  aws --profile "$profile" --endpoint-url "$R2_ENDPOINT_URL" s3 "$@"
}

prefix="s3://$R2_BUCKET/batch-data/$batch_id"
echo "Uploading $BATCH_DIR -> $prefix"

s3 cp "$BATCH_DIR/manifest.jsonl" "$prefix/manifest.jsonl"
if [[ -f "$BATCH_DIR/manifest-summary.json" ]]; then
  s3 cp "$BATCH_DIR/manifest-summary.json" "$prefix/manifest-summary.json"
fi
s3 cp "$BATCH_DIR/extraction/summary.json" "$prefix/extraction/summary.json"
s3 sync "$BATCH_DIR/final" "$prefix/final" \
  --exclude "*" --include "documents/*.json.gz" --include "chunks.jsonl.gz" --include "summary.json"
s3 sync "$BATCH_DIR/completion" "$prefix/completion"

echo "Verifying object count against local completion record"
local_docs="$(find "$BATCH_DIR/final/documents" -type f -name '*.json.gz' | wc -l)"
remote_docs="$(s3 ls "$prefix/final/documents/" | grep -c '\.json\.gz$' || true)"
if [[ "$local_docs" != "$remote_docs" ]]; then
  echo "Document count mismatch after upload: local=$local_docs remote=$remote_docs" >&2
  exit 1
fi

echo "Uploaded batch '$batch_id': $local_docs documents"
echo "Remote prefix: $prefix"
