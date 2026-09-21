import { createHash } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"

const [judgmentId, requestedOutput] = process.argv.slice(2)
if (!judgmentId || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(judgmentId)) {
  throw new Error(
    "Usage: node scripts/export-reading-copy-source.mjs JUDGMENT_ID [OUTPUT.md]"
  )
}

const serviceToken = process.env.SEARCH_SERVICE_TOKEN
if (!serviceToken) throw new Error("SEARCH_SERVICE_TOKEN is required")

const configuredSearch =
  process.env.SEARCH_API_URL ??
  "https://parcha-search-api.politestranger18.workers.dev/api/search"
const serviceOrigin = new URL(configuredSearch).origin
const outputPath = resolve(
  requestedOutput ?? `reading-copy-data/samples/${judgmentId.toLowerCase()}.md`
)

async function serviceRequest(pathname, body) {
  let lastError
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(new URL(pathname, serviceOrigin), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${serviceToken}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : `Search service returned ${response.status}`
        )
      }
      return payload
    } catch (error) {
      lastError = error
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 750))
      }
    }
  }
  throw lastError
}

const [browsePayload, contextPayload] = await Promise.all([
  serviceRequest("/api/browse", {
    ids: [judgmentId],
    page: 1,
    page_size: 1,
    facets: false,
  }),
  serviceRequest("/api/context", {
    judgment_ids: [judgmentId],
    max_chars_per_judgment: 120_000,
  }),
])

const judgment = browsePayload.results?.[0]
const context = contextPayload.contexts?.[0]
if (!judgment) throw new Error(`Judgment not found: ${judgmentId}`)
if (!context?.chunks?.length) {
  throw new Error(`No indexed text found for: ${judgmentId}`)
}
if (context.truncated) {
  throw new Error(
    `The indexed text for ${judgmentId} exceeded the context export limit; use a direct D1 export instead.`
  )
}

const chunks = context.chunks
const fingerprint = createHash("sha256")
for (const chunk of chunks) {
  fingerprint.update(chunk.chunk_id)
  fingerprint.update("\0")
  fingerprint.update(chunk.chunk_text)
  fingerprint.update("\0")
}

function yaml(value) {
  if (value === null || value === undefined || value === "") return "null"
  return JSON.stringify(value)
}

function markdownText(value) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function tableValue(value) {
  return markdownText(value).replace(/\|/g, "\\|").replace(/\n/g, "<br>")
}

function paragraphKey(chunk) {
  return chunk.chunk_id.replace(/:part\d+$/i, "")
}

const paragraphs = []
for (const chunk of chunks) {
  const key = paragraphKey(chunk)
  const previous = paragraphs.at(-1)
  if (previous?.key === key) {
    previous.chunkIds.push(chunk.chunk_id)
    previous.parts.push(markdownText(chunk.chunk_text))
    continue
  }
  paragraphs.push({
    key,
    page: chunk.pdf_page,
    paragraphNumber: chunk.paragraph_number ?? null,
    textSource: chunk.text_source,
    chunkIds: [chunk.chunk_id],
    parts: [markdownText(chunk.chunk_text)],
  })
}

const pageCount = new Set(chunks.map((chunk) => chunk.pdf_page)).size
const textSources = [...new Set(chunks.map((chunk) => chunk.text_source))]
const generatedAt = new Date().toISOString()
const textSha256 = fingerprint.digest("hex")
const lines = [
  "---",
  "schema: lex-archives-reading-copy-source/v1",
  "document_type: judgment_reading_copy_source",
  "editorial_status: draft",
  "authority_status: unofficial_editorial_reproduction",
  `judgment_id: ${yaml(judgment.judgment_id)}`,
  `title: ${yaml(judgment.title)}`,
  `petitioner: ${yaml(judgment.petitioner)}`,
  `respondent: ${yaml(judgment.respondent)}`,
  `reporter_citation: ${yaml(judgment.citation)}`,
  `neutral_citation: ${yaml(judgment.neutral_citation)}`,
  `cnr: ${yaml(judgment.cnr)}`,
  `case_number: ${yaml(judgment.case_number)}`,
  `court: ${yaml(judgment.court)}`,
  `decision_date: ${yaml(judgment.decision_date)}`,
  `decision_year: ${yaml(judgment.decision_year)}`,
  `disposal_nature: ${yaml(judgment.disposal_nature)}`,
  `era: ${yaml(judgment.era)}`,
  `bench_size: ${yaml(judgment.bench_size)}`,
  `available_languages: ${yaml(judgment.available_languages ?? [])}`,
  `judges: ${yaml(judgment.judges ?? [])}`,
  `source_pdf_url: ${yaml(judgment.pdf_url)}`,
  `source_pdf_key: ${yaml(judgment.pdf_key)}`,
  `source_text_sha256: ${yaml(textSha256)}`,
  `source_chunk_count: ${chunks.length}`,
  `source_paragraph_count: ${paragraphs.length}`,
  `source_pdf_pages_represented: ${pageCount}`,
  `source_text_characters: ${context.included_characters}`,
  `source_text_methods: ${yaml(textSources)}`,
  `exported_at: ${yaml(generatedAt)}`,
  "---",
  "",
  `# ${markdownText(judgment.title)}`,
  "",
  "> **DRAFT DATA EXPORT — NOT A COURT-ISSUED OR GOVERNMENT-OFFICIAL COPY.**",
  ">",
  "> This file is structured source material for a proposed **Vidhi Kosh Reading Copy**.",
  "> The preserved source PDF remains authoritative. Every paragraph below retains its",
  "> source PDF page and indexed chunk identifiers for verification.",
  "",
  "## Case identity",
  "",
  "| Field | Value |",
  "| --- | --- |",
  `| Court | ${tableValue(judgment.court)} |`,
  `| Decision date | ${tableValue(judgment.decision_date)} |`,
  `| Case number | ${tableValue(judgment.case_number)} |`,
  `| Reporter citation | ${tableValue(judgment.citation)} |`,
  `| Neutral citation | ${tableValue(judgment.neutral_citation)} |`,
  `| CNR | ${tableValue(judgment.cnr)} |`,
  `| Petitioner | ${tableValue(judgment.petitioner)} |`,
  `| Respondent | ${tableValue(judgment.respondent)} |`,
  `| Disposal | ${tableValue(judgment.disposal_nature)} |`,
  `| Bench strength | ${tableValue(judgment.bench_size)} |`,
  "",
  "## Coram",
  "",
  ...(judgment.judges?.length
    ? judgment.judges.map((judge) => `- ${markdownText(judge)}`)
    : ["- Not supplied in indexed metadata"]),
  "",
  "## Provenance and production notes",
  "",
  `- Preserved source PDF: ${judgment.pdf_url || "Not supplied"}`,
  `- Archive object key: \`${judgment.pdf_key || "Not supplied"}\``,
  `- Indexed text fingerprint (SHA-256): \`${textSha256}\``,
  `- Coverage: ${chunks.length} chunks merged into ${paragraphs.length} reading paragraphs across ${pageCount} PDF pages.`,
  `- Extraction methods represented: ${textSources.join(", ")}.`,
  "- Page numbers below are source **PDF page numbers**, not necessarily the printed reporter page.",
  "- Chunk IDs are production traceability identifiers and need not appear in the designed public PDF.",
  "- The final PDF should retain a clear editorial-reproduction notice and a link to the preserved source.",
  "",
  "## Judgment text",
  "",
]

let currentPage = null
for (const paragraph of paragraphs) {
  if (paragraph.page !== currentPage) {
    currentPage = paragraph.page
    lines.push(`## Source PDF page ${currentPage}`, "")
  }
  const label = paragraph.paragraphNumber
    ? `Paragraph ${paragraph.paragraphNumber}`
    : "Unnumbered passage"
  lines.push(
    `### ${label}`,
    "",
    `<!-- source_chunks: ${paragraph.chunkIds.join(", ")}; text_source: ${paragraph.textSource} -->`,
    "",
    paragraph.parts.join(" "),
    ""
  )
}

lines.push(
  "---",
  "",
  "## Required footer for any designed reading copy",
  "",
  `Vidhi Kosh Reading Copy · Editorial reproduction · Source judgment ID ${judgmentId} · Verify against the preserved source PDF.`,
  ""
)

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, lines.join("\n"), "utf8")
console.log(
  JSON.stringify({
    output: outputPath,
    judgment_id: judgmentId,
    chunks: chunks.length,
    paragraphs: paragraphs.length,
    pages: pageCount,
    bytes: Buffer.byteLength(lines.join("\n")),
  })
)
