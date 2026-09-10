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
  const indexName = values.get("index");
  if (!file || !indexName) {
    throw new Error("Required: --file chunks.jsonl.gz --index judgment-chunks-v<version>");
  }
  return {
    file,
    indexName,
    url: values.get("url") ?? "http://127.0.0.1:9200",
    batchSize: Number.parseInt(values.get("batch-size") ?? "1000", 10),
    limit: values.has("limit") ? Number.parseInt(values.get("limit"), 10) : null,
    checkpoint: values.get("checkpoint") ?? `${file}.${indexName}.checkpoint.json`,
    batchId: values.get("batch-id") ?? file.match(/batch-[^/]+/)?.[0] ?? "unknown",
  };
}

function sourceDocument(row, batchId) {
  return {
    judgment_id: String(row.sample_id),
    title: String(row.title ?? ""),
    citation: row.citation ?? null,
    decision_date: row.decision_date ?? null,
    decision_year: Number.isInteger(row.decision_year) ? row.decision_year : null,
    era: row.era ?? null,
    judge: row.judge ?? null,
    court: row.court ?? "Supreme Court of India",
    pdf_page: row.pdf_page,
    paragraph_number: row.paragraph_number ?? null,
    text_source: row.text_source ?? "unknown",
    batch_id: batchId,
    text: String(row.text),
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

async function sendBulk(url, indexName, rows, attempts = 6) {
  const lines = [];
  for (const row of rows) {
    if (typeof row.id !== "string" || !row.id) throw new Error("Chunk is missing id");
    lines.push(JSON.stringify({ index: { _id: row.id } }), JSON.stringify(row.document));
  }
  const body = `${lines.join("\n")}\n`;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await fetch(new URL(`${encodeURIComponent(indexName)}/_bulk?refresh=false`, `${url}/`), {
      method: "POST",
      headers: { "content-type": "application/x-ndjson" },
      body,
      signal: AbortSignal.timeout(120_000),
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
if (!Number.isInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 5000) {
  throw new Error("--batch-size must be between 1 and 5000");
}
if (options.limit !== null && (!Number.isInteger(options.limit) || options.limit < 1)) {
  throw new Error("--limit must be positive");
}

const resumeAt = await loadCheckpoint(options.checkpoint, options.file, options.indexName);
const input = createReadStream(options.file).pipe(createGunzip());
const lines = createInterface({ input, crlfDelay: Infinity });
let seen = 0;
let processed = resumeAt;
let batch = [];

for await (const line of lines) {
  if (!line.trim()) continue;
  if (seen++ < resumeAt) continue;
  if (options.limit !== null && processed - resumeAt >= options.limit) break;
  const row = JSON.parse(line);
  batch.push({ id: row.id, document: sourceDocument(row, options.batchId) });
  if (batch.length < options.batchSize) continue;
  await sendBulk(options.url, options.indexName, batch);
  processed += batch.length;
  batch = [];
  await saveCheckpoint(options.checkpoint, { file: options.file, index: options.indexName, processed });
  console.log(JSON.stringify({ event: "import.progress", file: options.file, processed }));
}
if (batch.length) {
  await sendBulk(options.url, options.indexName, batch);
  processed += batch.length;
  await saveCheckpoint(options.checkpoint, { file: options.file, index: options.indexName, processed });
}
console.log(JSON.stringify({ event: "import.complete", file: options.file, processed }));

