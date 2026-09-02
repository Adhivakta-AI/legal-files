#!/usr/bin/env bash
# Pull one archived batch's finalized OCR output down from Cloudflare R2 for
# local embedding. Run with no arguments to list the batches currently in the
# bucket; run with a batch id (e.g. batch-01) to download it.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$script_dir"

if [[ ! -f .env ]]; then
  echo "Missing $script_dir/.env. Copy .env.example to .env and set R2_*." >&2
  exit 2
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

: "${R2_BUCKET:?Set R2_BUCKET in .env}"
: "${R2_ENDPOINT_URL:?Set R2_ENDPOINT_URL in .env}"
: "${R2_DOWNLOAD_ROOT:?Set R2_DOWNLOAD_ROOT in .env}"
profile="${AWS_PROFILE:-r2}"

s3() {
  aws --profile "$profile" --endpoint-url "$R2_ENDPOINT_URL" s3 "$@"
}

if [[ $# -eq 0 ]]; then
  echo "Batches in s3://$R2_BUCKET/batch-data/:"
  s3 ls "s3://$R2_BUCKET/batch-data/"
  echo
  echo "Usage: $0 <batch-id>"
  exit 0
fi

batch_id="$1"
prefix="s3://$R2_BUCKET/batch-data/$batch_id"
destination="$R2_DOWNLOAD_ROOT/$batch_id"

if ! s3 ls "$prefix/completion/COMPLETE.json" >/dev/null 2>&1; then
  echo "No completed batch found at $prefix (missing completion/COMPLETE.json)." >&2
  exit 1
fi

# The bucket holds the whole batch directory (pdfs/, work/, audit/ included,
# tens of GB per batch) because the source machine synced it wholesale rather
# than with upload-batch-to-r2.sh. Only pull the finalized subset we actually
# need for embedding + ingestion.
mkdir -p "$destination"/{extraction,final,completion}
echo "Downloading finalized output for '$batch_id' -> $destination"
s3 cp "$prefix/manifest.jsonl" "$destination/manifest.jsonl"
s3 cp "$prefix/extraction/summary.json" "$destination/extraction/summary.json"
s3 sync "$prefix/final" "$destination/final" \
  --exclude "*" --include "documents/*.json.gz" --include "chunks.jsonl.gz" --include "summary.json"
s3 sync "$prefix/completion" "$destination/completion"

echo "Verifying checksums"
(
  cd "$destination"
  sha256sum -c completion/checksums.sha256 --quiet
)

echo "Batch '$batch_id' ready at $destination"
echo "chunks:  $destination/final/chunks.jsonl.gz"
echo "manifest: $destination/manifest.jsonl"
