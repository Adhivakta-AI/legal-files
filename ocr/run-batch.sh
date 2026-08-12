#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$script_dir"

if [[ ! -f .env ]]; then
  echo "Missing $script_dir/.env. Copy .env.example to .env and set BATCH_DIR." >&2
  exit 2
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

: "${BATCH_DIR:?Set BATCH_DIR in .env}"
workers="${WORKERS:-5}"
extract_workers="${EXTRACT_WORKERS:-2}"
download_workers="${DOWNLOAD_WORKERS:-8}"
dpi="${OCR_DPI:-300}"

if [[ "$BATCH_DIR" != /* ]]; then
  echo "BATCH_DIR must be an absolute host path: $BATCH_DIR" >&2
  exit 2
fi
if [[ ! -f "$BATCH_DIR/manifest.jsonl" ]]; then
  echo "Missing batch manifest: $BATCH_DIR/manifest.jsonl" >&2
  exit 2
fi
for value in "$workers" "$extract_workers" "$download_workers" "$dpi"; do
  if [[ ! "$value" =~ ^[1-9][0-9]*$ ]]; then
    echo "Worker counts and OCR_DPI must be positive integers." >&2
    exit 2
  fi
done

caller_uid="${SUDO_UID:-$(id -u)}"
caller_gid="${SUDO_GID:-$(id -g)}"
export HOST_UID="$caller_uid" HOST_GID="$caller_gid"
export GIT_COMMIT="$(git rev-parse --short=12 HEAD 2>/dev/null || printf unknown)"

if [[ "$(id -u)" -eq 0 ]] || docker info >/dev/null 2>&1; then
  compose=(docker compose)
else
  compose=(sudo docker compose)
fi

mkdir -p "$BATCH_DIR"/{audit,pdfs,extraction,work/logs,final,completion}
if [[ "$(id -u)" -eq 0 ]]; then
  chown -R "$caller_uid:$caller_gid" \
    "$BATCH_DIR"/{audit,pdfs,extraction,work,final,completion}
fi

"${compose[@]}" build ocr
export OCR_IMAGE_ID="$("${compose[@]}" images -q ocr | head -1)"

echo "[preflight] Verifying the OCR container"
"${compose[@]}" run --rm --entrypoint sh ocr -c \
  'tesseract --version | head -1 && python --version && /app/.venv/bin/judgment-ocr --help >/dev/null'

run_ocr() {
  "${compose[@]}" run --rm ocr "$@"
}

echo "[1/8] Downloading and verifying batch PDFs"
run_ocr download \
  --manifest /batch/manifest.jsonl \
  --pdf-root /batch/pdfs \
  --audit-root /batch/audit \
  --workers "$download_workers"

echo "[2/8] Extracting embedded text and classifying pages"
run_ocr extract \
  --manifest /batch/manifest.jsonl \
  --downloads /batch/audit/downloads.jsonl \
  --extraction-root /batch/extraction \
  --workers "$extract_workers"

echo "[3/8] Building and partitioning the flagged-page queue"
run_ocr queue \
  --extraction-root /batch/extraction \
  --output /batch/work/flagged-pages.jsonl
run_ocr partition \
  --tasks /batch/work/flagged-pages.jsonl \
  --output-root /batch/work/task-parts \
  --workers "$workers"

echo "[4/8] Running $workers parallel Tesseract workers"
pids=()
for worker in $(seq 1 "$workers"); do
  worker_id="$(printf '%02d' "$worker")"
  (
    "${compose[@]}" run --rm \
      -e OMP_THREAD_LIMIT=1 \
      -e OPENBLAS_NUM_THREADS=1 \
      -e MKL_NUM_THREADS=1 \
      ocr \
      run \
      --tasks "/batch/work/task-parts/part-${worker_id}.jsonl" \
      --pdf-root /batch/pdfs \
      --extraction-root /batch/extraction \
      --output-root /batch/work/tesseract-results \
      --engines tesseract \
      --device cpu \
      --dpi "$dpi" \
      --worker-id "$worker_id"
  ) >"$BATCH_DIR/work/logs/tesseract-${worker_id}.log" 2>&1 &
  pids+=("$!")
done

worker_failure=0
for pid in "${pids[@]}"; do
  if ! wait "$pid"; then
    worker_failure=1
  fi
done
if [[ "$worker_failure" -ne 0 ]]; then
  echo "A Tesseract worker failed. Inspect $BATCH_DIR/work/logs/." >&2
  exit 1
fi

echo "[5/8] Selecting and running Paddle fallback pages"
run_ocr fallback \
  --tasks /batch/work/flagged-pages.jsonl \
  --tesseract-root /batch/work/tesseract-results \
  --output /batch/work/paddle-fallback-pages.jsonl
if [[ -s "$BATCH_DIR/work/paddle-fallback-pages.jsonl" ]]; then
  run_ocr run \
    --tasks /batch/work/paddle-fallback-pages.jsonl \
    --pdf-root /batch/pdfs \
    --extraction-root /batch/extraction \
    --output-root /batch/work/paddle-results \
    --engines paddle \
    --device cpu \
    --dpi "$dpi"
else
  echo "No Paddle fallback pages were selected."
fi

echo "[6/8] Finalizing canonical pages and search chunks"
run_ocr finalize \
  --manifest /batch/manifest.jsonl \
  --extraction-root /batch/extraction \
  --tasks /batch/work/flagged-pages.jsonl \
  --tesseract-root /batch/work/tesseract-results \
  --paddle-root /batch/work/paddle-results \
  --output-root /batch/final

echo "[7/8] Verifying output and writing checksums"
run_ocr verify-batch \
  --manifest /batch/manifest.jsonl \
  --extraction-root /batch/extraction \
  --final-root /batch/final \
  --output-root /batch/completion

echo "[8/8] Batch complete"
echo "Completion record: $BATCH_DIR/completion/COMPLETE.json"
echo "Do not delete local data until the archive and Supabase ingestion are verified."
