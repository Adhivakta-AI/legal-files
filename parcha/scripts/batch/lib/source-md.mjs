import { createHash } from "node:crypto"

/**
 * Rebuilds the reading-copy source Markdown that
 * scripts/export-reading-copy-source.mjs produces from the search service,
 * but entirely from R2 batch artifacts: a `manifests/batch-NN.jsonl` record
 * plus that judgment's rows from `batch-data/batch-NN/final/chunks.jsonl.gz`.
 *
 * The emitted document must stay byte-compatible with the API exporter, since
 * scripts/lib/reading-copy-source.mjs parses both.
 */

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

function paragraphKey(chunkId) {
  return chunkId.replace(/:part\d+$/i, "")
}

function splitList(value) {
  if (Array.isArray(value)) return value.filter(Boolean)
  return String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
}

/** Maps a manifest row onto the judgment shape the exporter received from /api/browse. */
export function judgmentFromManifest(record) {
  const judges = splitList(record.judge)
  return {
    judgment_id: record.sample_id,
    title: record.title,
    petitioner: record.petitioner,
    respondent: record.respondent,
    citation: record.citation,
    // `case_id` carries the neutral citation ("1994 INSC 606").
    neutral_citation: record.case_id ?? record.nc_display ?? null,
    cnr: record.cnr,
    // Not carried by the batch manifest; the API exporter sourced it from D1.
    case_number: record.case_number ?? null,
    court: record.court,
    decision_date: record.decision_date,
    decision_year: record.decision_year,
    disposal_nature: record.disposal_nature,
    era: record.era,
    bench_size: judges.length || null,
    available_languages: splitList(record.available_languages),
    judges,
    pdf_url: record.pdf_url,
    pdf_key: record.pdf_key,
  }
}

/** Reading order: page, then paragraph, then the parts a paragraph was split into. */
export function sortChunks(chunks) {
  return [...chunks].sort(
    (a, b) =>
      (a.pdf_page ?? 0) - (b.pdf_page ?? 0) ||
      (a.paragraph_index ?? 0) - (b.paragraph_index ?? 0) ||
      (a.part_index ?? 0) - (b.part_index ?? 0) ||
      String(a.id).localeCompare(String(b.id))
  )
}

export function buildSourceMarkdown(record, rawChunks, options = {}) {
  const judgment = judgmentFromManifest(record)
  const judgmentId = judgment.judgment_id
  const chunks = sortChunks(rawChunks).map((chunk) => ({
    chunk_id: chunk.id,
    chunk_text: chunk.text,
    pdf_page: chunk.pdf_page,
    paragraph_number: chunk.paragraph_number ?? null,
    text_source: chunk.text_source,
  }))

  if (!chunks.length) throw new Error(`No indexed text found for: ${judgmentId}`)

  const fingerprint = createHash("sha256")
  for (const chunk of chunks) {
    fingerprint.update(chunk.chunk_id)
    fingerprint.update("\0")
    fingerprint.update(chunk.chunk_text)
    fingerprint.update("\0")
  }

  const paragraphs = []
  for (const chunk of chunks) {
    const key = paragraphKey(chunk.chunk_id)
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
  const includedCharacters = chunks.reduce(
    (sum, chunk) => sum + String(chunk.chunk_text).length,
    0
  )
  const generatedAt = options.generatedAt ?? new Date().toISOString()
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
    `source_text_characters: ${includedCharacters}`,
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

  return {
    markdown: lines.join("\n"),
    stats: {
      judgment_id: judgmentId,
      chunks: chunks.length,
      paragraphs: paragraphs.length,
      pages: pageCount,
      text_sources: textSources,
    },
  }
}
