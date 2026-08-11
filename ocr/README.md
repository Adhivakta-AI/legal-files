# Judgment Search Pilot

Local, reproducible OCR evaluation for the 500-document Indian Supreme Court
judgment pilot. The source PDFs and their existing text extraction are mounted
read-only from the dataset repository; this project never writes to S3.

## Why this is separate

The dataset scraper uses Python 3.13. OCR model runtimes have a larger and more
volatile dependency tree, so this repository pins Python 3.11 and runs it in a
container. Original PDFs, embedded text, and every OCR candidate remain separate
so that a new OCR engine can never silently overwrite the source text.

## Inputs

The default Compose mounts assume this repository is located beside the existing
`pilot/` directory:

- `../pilot/pdfs` becomes `/data/pdfs` (read-only)
- `../pilot/extraction` becomes `/data/extraction` (read-only)
- `./work` receives task lists and OCR results
- `./model-cache` persists downloaded PaddleOCR model weights

## Run the first benchmark

Create a balanced sample of 15 pages that were marked for OCR or re-OCR:

```bash
docker compose run --rm ocr sample \
  --extraction-root /data/extraction \
  --output /work/benchmark-pages.jsonl \
  --limit 15
```

Run both OCR engines at 300 DPI:

```bash
docker compose run --rm ocr run \
  --tasks /work/benchmark-pages.jsonl \
  --pdf-root /data/pdfs \
  --extraction-root /data/extraction \
  --output-root /work/results \
  --engines paddle,tesseract \
  --device cpu
```

The first PaddleOCR run downloads its model weights into `model-cache/`. Each
result is a gzip-compressed JSON file under `work/results/pages/`. It contains:

- the original embedded text and its preliminary quality score;
- PaddleOCR text, line boxes, confidence, and runtime;
- Tesseract text, line boxes, confidence, and runtime;
- the exact PDF page and source URL needed for visual verification.

The pipeline intentionally does not auto-select a replacement yet. First we must
manually verify a representative gold set and measure legal-name, citation, and
section-number accuracy. After that, the winning selection rule can be applied to
all flagged pages without discarding any candidate.

## Build and review the 100-page gold set

Create 80 flagged pages and 20 clean control pages, balanced across their
available eras:

```bash
docker compose run --rm ocr gold \
  --extraction-root /data/extraction \
  --output /work/gold-pages.jsonl \
  --flagged 80 \
  --clean 20
```

Generate both OCR candidates. The command is resumable at page level:

```bash
docker compose run --rm ocr run \
  --tasks /work/gold-pages.jsonl \
  --pdf-root /data/pdfs \
  --extraction-root /data/extraction \
  --output-root /work/gold-results \
  --engines paddle,tesseract \
  --device cpu
```

Start the reviewer at `http://localhost:8000`:

```bash
docker compose run --rm --service-ports ocr review \
  --tasks /work/gold-pages.jsonl \
  --pdf-root /data/pdfs \
  --extraction-root /data/extraction \
  --results-root /work/gold-results \
  --reviews-root /work/gold-reviews \
  --host 0.0.0.0 \
  --port 8000
```

The reviewer renders the original PDF page beside the embedded, Paddle, and
Tesseract candidates. Corrections and verification checks are written atomically
to `work/gold-reviews/pages/`; source PDFs and OCR result files remain unchanged.

Once that selection rule has been approved, create the complete resumable queue:

```bash
docker compose run --rm ocr queue \
  --extraction-root /data/extraction \
  --output /work/all-flagged-pages.jsonl

docker compose run --rm ocr run \
  --tasks /work/all-flagged-pages.jsonl \
  --pdf-root /data/pdfs \
  --extraction-root /data/extraction \
  --output-root /work/all-results \
  --engines paddle,tesseract \
  --device cpu
```

The current pilot contains 5,284 flagged pages. On this machine, the server
Paddle model took roughly 20 seconds per page and Tesseract roughly 2 seconds, so
the full CPU run is a many-hour batch. The runner is page-level resumable and
reprocesses result files whose source hash, DPI, engine set, or success state does
not match the requested run.

## Finalize the 500 judgments

Run Tesseract for every flagged page using the checked-in launcher. It is
resumable and writes one result per page:

```bash
sudo ./run-tesseract-pilot.sh
```

Generate the strict Paddle fallback queue after Tesseract completes:

```bash
uv run judgment-ocr fallback \
  --tasks work/all-flagged-pages.jsonl \
  --tesseract-root work/all-tesseract-results \
  --output work/paddle-fallback-pages.jsonl \
  --confidence-threshold 75

sudo ./run-paddle-fallback.sh
```

Assemble one canonical text per page and page-bound search chunks. Clean digital
pages retain embedded text, flagged pages use Tesseract, and only the fallback
queue can select Paddle. Every page records its selected source and every chunk
retains its PDF URL and page number:

```bash
uv run judgment-ocr finalize \
  --manifest ../pilot/manifest.jsonl \
  --extraction-root ../pilot/extraction \
  --tasks work/all-flagged-pages.jsonl \
  --tesseract-root work/all-tesseract-results \
  --paddle-root work/paddle-fallback-results \
  --output-root work/final
```

Generate portable BGE embedding shards. Completed shards are validated and
reused on every restart. Install the optional CUDA dependencies before running
GPU embeddings:

```bash
UV_CACHE_DIR=.uv-cache UV_PYTHON_INSTALL_DIR=.uv-python \
  uv sync --extra embedding-gpu
```

```bash
uv run --extra embedding-gpu judgment-ocr embed \
  --chunks work/final/chunks.jsonl.gz \
  --output-root work/embeddings-gpu \
  --cache-dir model-cache/fastembed \
  --model BAAI/bge-small-en-v1.5 \
  --dimensions 384 \
  --shard-size 1000 \
  --batch-size 64 \
  --threads 2 \
  --device cuda
```

For local development without Docker, use the repository-local Python 3.11
environment and explicitly keep Paddle's cache in the project:

```bash
UV_CACHE_DIR=.uv-cache UV_PYTHON_INSTALL_DIR=.uv-python uv sync
PADDLE_PDX_CACHE_HOME=model-cache PADDLE_PDX_MODEL_SOURCE=BOS \
  uv run judgment-ocr run \
  --tasks work/benchmark-pages.jsonl \
  --pdf-root ../pilot/pdfs \
  --extraction-root ../pilot/extraction \
  --output-root work/results \
  --engines paddle \
  --max-pages 1
```

## Development

```bash
docker compose build
docker compose run --rm --entrypoint uv ocr run ruff check .
docker compose run --rm --entrypoint uv ocr run pytest
```

## Portable batch OCR

The Docker package can process one manifest batch on any Linux x86-64 laptop.
Only `manifest.jsonl` is required initially; PDFs are downloaded from their
public S3 URLs and all generated files remain under the configured batch
directory.

Create the local configuration:

```bash
cp .env.example .env
```

Edit `.env` and set an absolute batch directory:

```dotenv
BATCH_DIR=/home/your-user/judgment-ocr-data/batch-01
WORKERS=5
EXTRACT_WORKERS=2
DOWNLOAD_WORKERS=8
OCR_DPI=300
MODEL_CACHE_DIR=./model-cache
OCR_IMAGE=judgment-ocr:local
```

Place the assigned `manifest.jsonl` at
`$BATCH_DIR/manifest.jsonl`, then run:

```bash
sudo ./run-batch.sh
```

The wrapper derives `HOST_UID` and `HOST_GID` from the user who invoked sudo;
they do not belong in `.env`. This makes `/batch` output writable by the normal
host user. The script builds the image, downloads and extracts PDFs, runs
parallel Tesseract workers, runs Paddle only for fallback pages, finalizes the
corpus, and writes:

```text
$BATCH_DIR/completion/checksums.sha256
$BATCH_DIR/completion/COMPLETE.json
```

Every stage is resumable. Re-run the same command after an interruption. OCR
page results are reused only when their source checksum, engine list, schema,
and DPI match. Inspect worker logs under `$BATCH_DIR/work/logs/`.

Check progress from another terminal:

```bash
./batch-status.sh
```

Do not delete a batch merely because `COMPLETE.json` exists. First upload its
finalized output and checksums to private object storage, verify the upload,
generate embeddings, ingest Supabase, and verify database counts and sampled
PDF citations.
