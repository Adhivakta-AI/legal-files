import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, extname, resolve } from "node:path"
import {
  enrichBlocksWithTypography,
  parsePopplerXml,
  summarizeAlignment,
} from "./lib/poppler-layout.mjs"
import {
  caseLawReferenceTreatmentTotals,
  extractCaseLawReferenceTables,
} from "./lib/case-law-reference.mjs"
import { parseReadingCopyMarkdown } from "./lib/reading-copy-source.mjs"

const args = process.argv.slice(2)
const inputArg = args[0]

function flagValue(name) {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : null
}

if (!inputArg || inputArg.startsWith("--")) {
  throw new Error(
    "Usage: node scripts/enrich-reading-copy-layout.mjs INPUT.md [--pdf SOURCE.pdf] [--output LAYOUT.json]"
  )
}

const inputPath = resolve(inputArg)
const suppliedPdfPath = flagValue("--pdf")
const requestedOutput = flagValue("--output")
const popplerBinary = process.env.PDFTOHTML_PATH ?? "/usr/bin/pdftohtml"

await access(popplerBinary)

const markdown = await readFile(inputPath, "utf8")
const source = parseReadingCopyMarkdown(markdown)
const judgmentId = String(
  source.metadata.judgment_id ?? basename(inputPath, extname(inputPath))
)
const outputPath = resolve(
  requestedOutput ?? `reading-copy-data/structured/${judgmentId}-layout.json`
)
const temporaryDirectory = await mkdtemp(`${tmpdir()}/lex-reading-copy-layout-`)
let pdfPath = suppliedPdfPath ? resolve(suppliedPdfPath) : null

try {
  if (!pdfPath) {
    const sourceUrl = source.metadata.source_pdf_url
    if (!sourceUrl) {
      throw new Error("No --pdf was supplied and source_pdf_url is missing")
    }
    const response = await fetch(sourceUrl, {
      signal: AbortSignal.timeout(120_000),
    })
    if (!response.ok) {
      throw new Error(`Source PDF download returned ${response.status}`)
    }
    pdfPath = resolve(temporaryDirectory, `${judgmentId}-source.pdf`)
    await writeFile(pdfPath, Buffer.from(await response.arrayBuffer()))
  }

  await access(pdfPath)
  const pdfBytes = await readFile(pdfPath)
  const pdfSha256 = createHash("sha256").update(pdfBytes).digest("hex")
  const xmlPath = resolve(temporaryDirectory, "source.xml")

  execFileSync(
    popplerBinary,
    [
      "-q",
      "-xml",
      "-i",
      "-hidden",
      "-fontfullname",
      "-noroundcoord",
      "-zoom",
      "1",
      pdfPath,
      xmlPath,
    ],
    { stdio: "pipe", timeout: 180_000 }
  )

  const xml = await readFile(xmlPath, "utf8")
  const pdf = parsePopplerXml(xml)
  const enrichedBlocks = enrichBlocksWithTypography(source, pdf)
  const caseLawReferenceTables = extractCaseLawReferenceTables(
    pdf,
    enrichedBlocks
  )
  const caseReferenceChunkIds = new Set(
    caseLawReferenceTables.flatMap((table) => table.sourceChunkIds)
  )
  const blocks = enrichedBlocks.map((block) =>
    block.sourceChunkIds.some((chunkId) => caseReferenceChunkIds.has(chunkId))
      ? { ...block, role: "case_reference_source" }
      : block
  )
  const alignment = summarizeAlignment(blocks)
  const popplerProbe = spawnSync(popplerBinary, ["-v"], { encoding: "utf8" })
  const popplerVersion =
    `${popplerProbe.stdout ?? ""}\n${popplerProbe.stderr ?? ""}`
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) ?? "unknown"

  const warnings = blocks
    .filter((block) => block.typography.coverage < 0.8)
    .map((block) => ({
      code: "LOW_TYPOGRAPHY_ALIGNMENT",
      sourcePage: block.sourcePage,
      sourceChunkIds: block.sourceChunkIds,
      coverage: block.typography.coverage,
    }))
  for (const table of caseLawReferenceTables) {
    if (table.provenanceCoverage < 1) {
      warnings.push({
        code: "CASE_REFERENCE_PROVENANCE_GAP",
        tableId: table.id,
        provenanceCoverage: table.provenanceCoverage,
      })
    }
    if (table.confidence < 0.98) {
      warnings.push({
        code: "LOW_CASE_REFERENCE_CONFIDENCE",
        tableId: table.id,
        confidence: table.confidence,
      })
    }
  }

  const fonts = [
    ...new Map(
      [...pdf.fontMap.values()].map((font) => [
        `${font.family}|${font.size}|${font.bold}|${font.italic}`,
        {
          family: font.family,
          size: font.size,
          bold: font.bold,
          italic: font.italic,
        },
      ])
    ).values(),
  ]

  const layoutDocument = {
    schema: "lex-archives-reading-copy-layout/v1",
    metadata: source.metadata,
    layout: {
      extractor: "poppler-pdftohtml",
      extractorVersion: popplerVersion,
      generatedAt: new Date().toISOString(),
      sourcePdfSha256: pdfSha256,
      sourceTextSha256: source.metadata.source_text_sha256 ?? null,
      sourcePdfKey: source.metadata.source_pdf_key ?? null,
      sourcePdfPages: pdf.pages.size,
      textElements: [...pdf.pages.values()].reduce(
        (sum, page) => sum + page.elements.length,
        0
      ),
      fonts,
      alignment,
      caseLawReference: {
        tableCount: caseLawReferenceTables.length,
        rowCount: caseLawReferenceTables.reduce(
          (sum, table) => sum + table.rows.length,
          0
        ),
        treatmentTotals: caseLawReferenceTreatmentTotals(
          caseLawReferenceTables.flatMap((table) => table.rows)
        ),
      },
      textPolicy:
        "indexed chunks for prose and provenance; source-PDF geometry for structured table reconstruction",
    },
    blocks,
    caseLawReferenceTables,
    warnings,
  }

  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(
    outputPath,
    `${JSON.stringify(layoutDocument, null, 2)}\n`,
    "utf8"
  )
  console.log(
    JSON.stringify({
      input: inputPath,
      pdf: suppliedPdfPath ? pdfPath : "downloaded from source_pdf_url",
      output: outputPath,
      judgment_id: judgmentId,
      pages: pdf.pages.size,
      blocks: blocks.length,
      alignment,
      case_law_reference_tables: caseLawReferenceTables.length,
      case_law_reference_rows: caseLawReferenceTables.reduce(
        (sum, table) => sum + table.rows.length,
        0
      ),
      warnings: warnings.length,
    })
  )
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}
