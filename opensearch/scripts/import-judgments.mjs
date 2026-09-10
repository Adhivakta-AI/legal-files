import { createReadStream } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";

function argumentsFrom(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error(`Invalid argument: ${key ?? ""}`);
    values.set(key.slice(2), value);
  }
  const file = values.get("file");
  const metadata = values.get("metadata");
  const indexName = values.get("index");
  if (!file || !metadata || !indexName) {
    throw new Error("Required: --file chunks.jsonl.gz --metadata browse-metadata.jsonl --index judgments-v<version>");
  }
  return {
    file,
    metadata,
    indexName,
    url: values.get("url") ?? "http://127.0.0.1:9200",
    checkpoint: values.get("checkpoint") ?? `${file}.${indexName}.checkpoint.json`,
    batchId: values.get("batch-id") ?? file.match(/batch-[^/]+/)?.[0] ?? "unknown",
    maxBatchBytes: Number.parseInt(values.get("max-batch-bytes") ?? String(8 * 1024 * 1024), 10),
  };
}

async function metadataById(path) {
  const values = new Map();
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (typeof row.judgment_id === "string") values.set(row.judgment_id, row);
  }
  return values;
}

function languages(value) {
  return typeof value === "string"
    ? value.split(",").map((item) => item.trim().toUpperCase()).filter(Boolean)
    : [];
}

function sourceDocument(metadata, source, batchId, text) {
  return {
    judgment_id: String(source.sample_id),
    title: String(metadata?.title ?? source.title ?? ""),
    petitioner: metadata?.petitioner ?? null,
    respondent: metadata?.respondent ?? null,
    citation: metadata?.citation ?? source.citation ?? null,
    neutral_citation: metadata?.neutral_citation ?? null,
    cnr: metadata?.cnr ?? null,
    decision_date: metadata?.decision_date ?? source.decision_date ?? null,
    decision_year: Number.isInteger(metadata?.decision_year)
      ? metadata.decision_year
      : Number.isInteger(source.decision_year) ? source.decision_year : null,
    disposal_nature: metadata?.disposal_nature ?? null,
    available_languages: languages(metadata?.available_languages),
    era: metadata?.era ?? source.era ?? null,
    bench_size: Number.isInteger(metadata?.bench_size) ? metadata.bench_size : null,
    judges: Array.isArray(metadata?.judges) ? metadata.judges : [],
    court: metadata?.court ?? source.court ?? "Supreme Court of India",
    batch_id: batchId,
    text,
  };
}

async function loadCheckpoint(path, file, indexName) {
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    if (value.file !== file || value.index !== indexName || !Number.isInteger(value.processed)) {
      throw new Error("Checkpoint does not match this file and index");
    }
    return value.processed;
  } catch (error) {
    if (error?.code === "ENOENT") return 0;
    throw error;
  }
}

async function saveCheckpoint(path, value) {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

async function sendBulk(url, indexName, documents, attempts = 6) {
  const lines = documents.flatMap(({ id, encoded }) => [JSON.stringify({ index: { _id: id } }), encoded]);
  const body = `${lines.join("\n")}\n`;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await fetch(new URL(`${encodeURIComponent(indexName)}/_bulk?refresh=false`, `${url}/`), {
      method: "POST",
      headers: { "content-type": "application/x-ndjson" },
      body,
      signal: AbortSignal.timeout(180_000),
    });
    const payload = await response.json().catch(() => ({}));
    if (response.ok && payload.errors !== true) return;
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === attempts - 1) {
      const failed = Array.isArray(payload.items)
        ? payload.items.filter((item) => item.index?.error).slice(0, 3)
        : payload;
      throw new Error(`Bulk index failed (${response.status}): ${JSON.stringify(failed)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * 2 ** attempt, 15_000)));
  }
}

const options = argumentsFrom(process.argv.slice(2));
if (!Number.isInteger(options.maxBatchBytes) || options.maxBatchBytes < 1024 * 1024) {
  throw new Error("--max-batch-bytes must be at least 1048576");
}

const metadata = await metadataById(options.metadata);
const resumeAt = await loadCheckpoint(options.checkpoint, options.file, options.indexName);
const lines = createInterface({
  input: createReadStream(options.file).pipe(createGunzip()),
  crlfDelay: Infinity,
});
let currentId = "";
let currentSource = null;
let textParts = [];
let seenJudgments = 0;
let processed = resumeAt;
let missingMetadata = 0;
let batch = [];
let batchBytes = 0;

async function flushBatch() {
  if (!batch.length) return;
  await sendBulk(options.url, options.indexName, batch);
  processed += batch.length;
  batch = [];
  batchBytes = 0;
  await saveCheckpoint(options.checkpoint, {
    file: options.file,
    index: options.indexName,
    processed,
  });
  console.log(JSON.stringify({ event: "judgment_import.progress", file: options.file, processed }));
}

async function finishJudgment() {
  if (!currentSource) return;
  const skip = seenJudgments++ < resumeAt;
  if (skip) return;
  const rowMetadata = metadata.get(currentId);
  if (!rowMetadata) missingMetadata += 1;
  const document = sourceDocument(rowMetadata, currentSource, options.batchId, textParts.join("\n\n"));
  const encoded = JSON.stringify(document);
  if (batch.length && batchBytes + Buffer.byteLength(encoded) > options.maxBatchBytes) await flushBatch();
  batch.push({ id: currentId, encoded });
  batchBytes += Buffer.byteLength(encoded);
}

for await (const line of lines) {
  if (!line.trim()) continue;
  const row = JSON.parse(line);
  const id = String(row.sample_id ?? "");
  if (!id) throw new Error("Chunk is missing sample_id");
  if (currentId && id !== currentId) await finishJudgment();
  if (id !== currentId) {
    currentId = id;
    currentSource = row;
    textParts = [];
  }
  textParts.push(String(row.text ?? ""));
}
await finishJudgment();
await flushBatch();
console.log(JSON.stringify({
  event: "judgment_import.complete",
  file: options.file,
  processed,
  missing_metadata: missingMetadata,
}));
