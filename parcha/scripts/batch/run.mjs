import { execFile } from "node:child_process"
import { createReadStream } from "node:fs"
import {
  mkdir,
  readFile,
  readdir,
  rm,
  statfs,
  writeFile,
} from "node:fs/promises"
import { createInterface } from "node:readline"
import { basename, resolve } from "node:path"
import { promisify } from "node:util"
import { createGunzip, gzipSync } from "node:zlib"
import { Ledger } from "./lib/ledger.mjs"
import { buildSourceMarkdown } from "./lib/source-md.mjs"
import {
  deleteObject,
  getObjectStream,
  getObjectToFile,
  mirroredPdfKey,
  putBuffer,
  putFile,
  r2Client,
} from "./lib/r2.mjs"

const execFileAsync = promisify(execFile)
const args = process.argv.slice(2)

function flag(name, fallback = null) {
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? args[index + 1] : fallback
}
function has(name) {
  return args.includes(`--${name}`)
}

const BATCHES = (flag("batches") ?? "02,03,04,05,06,07").split(",")
const LIMIT = Number(flag("limit") ?? "0") || Infinity
const CONCURRENCY = Number(flag("concurrency") ?? "6")
const OUT_PREFIX = flag("prefix") ?? "reading-copies"
const MIN_FREE_BYTES = Number(flag("min-free-mb") ?? "800") * 1024 * 1024
const DRY_RUN = has("dry-run")
const KEEP_LOCAL = has("keep-local")
// Reprocess specific judgments regardless of ledger state, e.g. after a fix.
const ONLY = new Set((flag("only") ?? "").split(",").filter(Boolean))

const ROOT = resolve(import.meta.dirname, "../..")
const WORK = resolve(ROOT, "scripts/batch/.work")
const STATE = resolve(ROOT, "scripts/batch/state")

/** CLOUDFLARE_ACCOUNT_ID lives in the backend env file, not parcha's. */
async function loadAccountId() {
  if (process.env.CLOUDFLARE_ACCOUNT_ID) return
  for (const candidate of [
    resolve(ROOT, "../backend/.env"),
    resolve(ROOT, ".env"),
  ]) {
    try {
      const text = await readFile(candidate, "utf8")
      const match = /^CLOUDFLARE_ACCOUNT_ID=(.*)$/m.exec(text)
      if (match) {
        process.env.CLOUDFLARE_ACCOUNT_ID = match[1].trim().replace(/^["']|["']$/g, "")
        return
      }
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error("CLOUDFLARE_ACCOUNT_ID not found in env or backend/.env")
}

async function freeBytes(path) {
  const info = await statfs(path)
  return info.bavail * info.bsize
}

async function waitForDisk(log) {
  let warned = false
  while ((await freeBytes(WORK)) < MIN_FREE_BYTES) {
    if (!warned) {
      log(`disk below ${Math.round(MIN_FREE_BYTES / 1e6)} MB free — pausing`)
      warned = true
    }
    await new Promise((resolve) => setTimeout(resolve, 5000))
  }
  if (warned) log("disk recovered — resuming")
}

/**
 * Streams a batch's chunks.jsonl.gz once and fans the rows out into one file
 * per judgment. Re-reading the 84 MB archive per document would be quadratic.
 */
async function splitChunks(client, batch, chunkDir, wanted, log) {
  await mkdir(chunkDir, { recursive: true })
  const stream = await getObjectStream(client, `batch-data/batch-${batch}/final/chunks.jsonl.gz`)
  const lines = createInterface({
    input: stream.pipe(createGunzip()),
    crlfDelay: Infinity,
  })

  const buffers = new Map()
  let rows = 0
  for await (const line of lines) {
    if (!line.trim()) continue
    let row
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    const id = row.sample_id
    if (!id || (wanted && !wanted.has(id))) continue
    if (!buffers.has(id)) buffers.set(id, [])
    buffers.get(id).push(line)
    rows += 1
  }

  for (const [id, rowLines] of buffers) {
    await writeFile(resolve(chunkDir, `${id}.jsonl`), rowLines.join("\n"), "utf8")
  }
  log(`chunks: ${rows} rows across ${buffers.size} judgments`)
  return buffers.size
}

async function readManifest(path) {
  const records = []
  const lines = createInterface({
    input: createReadStream(path),
    crlfDelay: Infinity,
  })
  for await (const line of lines) {
    if (!line.trim()) continue
    try {
      records.push(JSON.parse(line))
    } catch {
      // Skip malformed manifest rows rather than aborting the batch.
    }
  }
  return records
}

async function processDocument(client, batch, record, dirs, log) {
  const id = record.sample_id
  const pdfPath = resolve(dirs.pdf, `${id}.pdf`)
  const mdPath = resolve(dirs.md, `${id}.md`)
  const layoutPath = resolve(dirs.out, `${id}-layout.json`)
  const htmlPath = resolve(dirs.out, `${id}-pipeline.html`)
  const outPdfPath = resolve(dirs.out, `${id}-reading-copy.pdf`)
  const cleanup = [pdfPath, mdPath, layoutPath, htmlPath, outPdfPath]

  try {
    const chunkPath = resolve(dirs.chunks, `${id}.jsonl`)
    let chunkText
    try {
      chunkText = await readFile(chunkPath, "utf8")
    } catch {
      throw new Error("no indexed chunks in batch archive")
    }
    const chunks = chunkText
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line))

    const { markdown, stats } = buildSourceMarkdown(record, chunks)
    await writeFile(mdPath, markdown, "utf8")

    await getObjectToFile(client, mirroredPdfKey(batch, record.pdf_key), pdfPath)

    await execFileAsync(
      process.execPath,
      [
        resolve(ROOT, "scripts/build-reading-copy.mjs"),
        mdPath,
        "--pdf", pdfPath,
        "--layout", layoutPath,
        "--output", outPdfPath,
        "--html", htmlPath,
      ],
      { cwd: ROOT, timeout: 300_000, maxBuffer: 32 * 1024 * 1024 }
    )

    const [pdfBody, layoutBody, htmlBody] = await Promise.all([
      readFile(outPdfPath),
      readFile(layoutPath),
      readFile(htmlPath),
    ])

    const keys = {
      pdf: `${OUT_PREFIX}/${id}/reading-copy.pdf`,
      layout: `${OUT_PREFIX}/${id}/layout.json.gz`,
      html: `${OUT_PREFIX}/${id}/pipeline.html.gz`,
    }

    let uploaded = 0
    if (!DRY_RUN) {
      // Promise.all rejects on the first failure while the siblings keep going,
      // which leaves a judgment half-published in R2 — in the first full run
      // that stranded a servable reading-copy.pdf with no layout beside it.
      // Settle everything, then roll back the parts that did land.
      const results = await Promise.allSettled([
        putFile(client, keys.pdf, outPdfPath, "application/pdf"),
        putBuffer(client, keys.layout, gzipSync(layoutBody, { level: 9 }), "application/gzip"),
        putBuffer(client, keys.html, gzipSync(htmlBody, { level: 9 }), "application/gzip"),
      ])
      const order = [keys.pdf, keys.layout, keys.html]
      const rejected = results.filter((result) => result.status === "rejected")
      if (rejected.length) {
        await Promise.allSettled(
          results.map((result, index) =>
            result.status === "fulfilled"
              ? deleteObject(client, order[index])
              : null
          )
        )
        throw new Error(
          `R2 upload failed (${rejected.length}/3), rolled back partial publish: ${rejected[0].reason?.message ?? rejected[0].reason}`
        )
      }
      uploaded = results.reduce((sum, result) => sum + result.value, 0)
    }

    return {
      status: "done",
      batch,
      pages: stats.pages,
      chunks: stats.chunks,
      paragraphs: stats.paragraphs,
      text_sources: stats.text_sources,
      bytes: { pdf: pdfBody.length, layout: layoutBody.length, html: htmlBody.length },
      uploaded_bytes: uploaded,
      keys,
    }
  } finally {
    if (!KEEP_LOCAL) {
      await Promise.all(cleanup.map((path) => rm(path, { force: true })))
    }
  }
}

async function main() {
  await loadAccountId()
  await mkdir(WORK, { recursive: true })
  const ledger = await new Ledger(resolve(STATE, "ledger.jsonl")).open()
  const client = r2Client()
  const started = Date.now()

  const log = (message) =>
    console.log(`[${new Date().toISOString()}] ${message}`)

  log(
    `start batches=${BATCHES.join(",")} concurrency=${CONCURRENCY} ` +
      `limit=${LIMIT === Infinity ? "all" : LIMIT}${DRY_RUN ? " DRY-RUN" : ""}`
  )
  const resumed = ledger.summary()
  if (Object.keys(resumed).length) log(`resuming over ledger: ${JSON.stringify(resumed)}`)

  let totalDone = 0
  let totalFailed = 0
  let remaining = LIMIT

  for (const batch of BATCHES) {
    if (remaining <= 0) break
    const dirs = {
      root: resolve(WORK, `batch-${batch}`),
      chunks: resolve(WORK, `batch-${batch}/chunks`),
      pdf: resolve(WORK, `batch-${batch}/pdf`),
      md: resolve(WORK, `batch-${batch}/md`),
      out: resolve(WORK, `batch-${batch}/out`),
    }
    for (const dir of Object.values(dirs)) await mkdir(dir, { recursive: true })

    const manifestPath = resolve(dirs.root, `manifest.jsonl`)
    log(`batch-${batch}: fetching manifest`)
    await getObjectToFile(client, `manifests/batch-${batch}.jsonl`, manifestPath)
    const records = await readManifest(manifestPath)

    const pending = records
      .filter((record) =>
        ONLY.size
          ? ONLY.has(record.sample_id)
          : record.sample_id && !ledger.isDone(record.sample_id)
      )
      .slice(0, remaining === Infinity ? undefined : remaining)
    log(`batch-${batch}: ${records.length} in manifest, ${pending.length} to process`)
    if (!pending.length) {
      await rm(dirs.root, { recursive: true, force: true })
      continue
    }

    log(`batch-${batch}: splitting chunk archive`)
    await splitChunks(
      client,
      batch,
      dirs.chunks,
      new Set(pending.map((record) => record.sample_id)),
      (message) => log(`batch-${batch}: ${message}`)
    )

    let cursor = 0
    let done = 0
    let failed = 0
    const startedBatch = Date.now()

    async function worker() {
      while (cursor < pending.length) {
        const record = pending[cursor++]
        const id = record.sample_id
        await waitForDisk(log)
        try {
          const result = await processDocument(client, batch, record, dirs, log)
          ledger.record({ id, ...result })
          done += 1
        } catch (error) {
          // Prefer the thrown `Error: ...` line. Falling back to the tail of the
          // output just captures Node's stack epilogue, which classifies nothing.
          const output = [error?.stderr, error?.stdout, error?.message, String(error)]
            .filter(Boolean)
            .join("\n")
          const thrown = output
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => /^(?:Uncaught\s+)?Error:\s/.test(line))
          const message = (
            thrown.length
              ? thrown.join(" | ")
              : output.split("\n").filter(Boolean).slice(-4).join(" | ")
          ).slice(0, 600)
          ledger.record({ id, status: "failed", batch, error: message })
          failed += 1
        }
        const finished = done + failed
        if (finished % 25 === 0 || finished === pending.length) {
          const rate = finished / ((Date.now() - startedBatch) / 1000)
          const eta = (pending.length - finished) / (rate || 1)
          log(
            `batch-${batch}: ${finished}/${pending.length} ` +
              `(ok ${done}, failed ${failed}) ${rate.toFixed(2)}/s eta ${(eta / 60).toFixed(1)}m`
          )
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker)
    )

    totalDone += done
    totalFailed += failed
    if (remaining !== Infinity) remaining -= pending.length
    log(`batch-${batch}: complete — ok ${done}, failed ${failed}`)
    if (!KEEP_LOCAL) await rm(dirs.root, { recursive: true, force: true })
  }

  const elapsed = (Date.now() - started) / 1000
  log(
    `finished in ${(elapsed / 60).toFixed(1)}m — ok ${totalDone}, failed ${totalFailed}`
  )
  log(`ledger: ${JSON.stringify(ledger.summary())}`)

  try {
    const quarantined = await readdir(resolve(ROOT, "reading-copy-data/quarantine"))
    if (quarantined.length) log(`quarantine holds ${quarantined.length} judgment(s)`)
  } catch {
    // No quarantine directory means nothing tripped the integrity gate.
  }

  await ledger.close()
}

await main()
