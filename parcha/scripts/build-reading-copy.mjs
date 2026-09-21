import { execFileSync } from "node:child_process"
import { mkdir, readFile, rename } from "node:fs/promises"
import { basename, dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseReadingCopyMarkdown } from "./lib/reading-copy-source.mjs"
import { validateReadingCopyLayout } from "./lib/reading-copy-validation.mjs"

const args = process.argv.slice(2)
const inputArg = args[0]

function flagValue(name) {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : null
}

if (!inputArg || inputArg.startsWith("--")) {
  throw new Error(
    "Usage: node scripts/build-reading-copy.mjs INPUT.md [--pdf SOURCE.pdf] [--layout LAYOUT.json] [--output OUTPUT.pdf] [--html OUTPUT.html]"
  )
}

const inputPath = resolve(inputArg)
const markdown = await readFile(inputPath, "utf8")
const source = parseReadingCopyMarkdown(markdown)
const judgmentId = String(source.metadata.judgment_id)
const sourcePdf = flagValue("--pdf")
const layoutPath = resolve(
  flagValue("--layout") ??
    `reading-copy-data/structured/${judgmentId}-layout.json`
)
const outputPath = resolve(
  flagValue("--output") ??
    `reading-copy-data/generated/${judgmentId}-pipeline.pdf`
)
const htmlPath = resolve(
  flagValue("--html") ??
    `reading-copy-data/generated/${judgmentId}-pipeline.html`
)
const scriptDirectory = dirname(fileURLToPath(import.meta.url))

function decodedHtmlAttribute(value) {
  return String(value ?? "")
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
}

function htmlAttribute(tag, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = new RegExp(
    `(?:^|\\s)${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,
    "i"
  ).exec(tag)
  return match ? decodedHtmlAttribute(match[1] ?? match[2]) : null
}

function renderedCaseLawReferenceIntegrity(document, html) {
  const tables = Array.isArray(document.caseLawReferenceTables)
    ? document.caseLawReferenceTables
    : []
  const blocks = Array.isArray(document.blocks) ? document.blocks : []
  const expectedRows = tables.reduce(
    (sum, table) => sum + (Array.isArray(table.rows) ? table.rows.length : 0),
    0
  )
  const expectedById = new Map(
    tables.map((table) => [
      String(table.id),
      Array.isArray(table.rows) ? table.rows.length : 0,
    ])
  )

  const renderedSections = []
  const sectionPattern =
    /<section\b([^>]*\bdata-case-law-reference-table\s*=\s*(?:"[^"]*"|'[^']*')[^>]*)>([\s\S]*?)<\/section>/gi
  for (const match of html.matchAll(sectionPattern)) {
    const startTag = `<section${match[1]}>`
    const tableId = htmlAttribute(startTag, "data-case-law-reference-table")
    const declaredRows = Number.parseInt(
      htmlAttribute(startTag, "data-row-count") ?? "",
      10
    )
    const actualRows = [
      ...match[2].matchAll(/<tr\b[^>]*\bdata-case-reference-row(?:\s|=|>)/gi),
    ].length
    renderedSections.push({ tableId, declaredRows, actualRows })
  }

  const renderedRowMarkers = [
    ...html.matchAll(/<tr\b[^>]*\bdata-case-reference-row(?:\s|=|>)/gi),
  ].length
  const tableSourceChunkIds = new Set(
    tables.flatMap((table) =>
      Array.isArray(table.sourceChunkIds) ? table.sourceChunkIds : []
    )
  )
  const sourceTableBlocks = blocks.filter(
    (block) => block?.role === "case_reference_source"
  )
  for (const block of sourceTableBlocks) {
    for (const chunkId of block.sourceChunkIds ?? []) {
      tableSourceChunkIds.add(chunkId)
    }
  }

  const leakedDigestBlocks = []
  for (const match of html.matchAll(/<p\b[^>]*>/gi)) {
    const tag = match[0]
    const classes = (htmlAttribute(tag, "class") ?? "").split(/\s+/)
    if (!classes.includes("digest-block")) continue
    const chunkIds = (htmlAttribute(tag, "data-source-chunks") ?? "")
      .split(",")
      .map((chunkId) => chunkId.trim())
      .filter(Boolean)
    const isSourceTableBlock =
      classes.includes("role-case_reference_source") ||
      chunkIds.some((chunkId) => tableSourceChunkIds.has(chunkId))
    if (isSourceTableBlock) {
      leakedDigestBlocks.push({
        chunkIds,
        roleMarked: classes.includes("role-case_reference_source"),
      })
    }
  }

  const errors = []
  if (renderedSections.length !== tables.length) {
    errors.push(
      `Rendered ${renderedSections.length} case-law reference table marker(s); expected ${tables.length}`
    )
  }
  if (renderedRowMarkers !== expectedRows) {
    errors.push(
      `Rendered ${renderedRowMarkers} case-law reference row marker(s); expected ${expectedRows}`
    )
  }

  const seenTableIds = new Set()
  for (const section of renderedSections) {
    if (!section.tableId || !expectedById.has(section.tableId)) {
      errors.push(
        `Rendered unexpected case-law reference table: ${section.tableId ?? "missing ID"}`
      )
      continue
    }
    if (seenTableIds.has(section.tableId)) {
      errors.push(
        `Rendered duplicate case-law reference table: ${section.tableId}`
      )
      continue
    }
    seenTableIds.add(section.tableId)
    const expectedTableRows = expectedById.get(section.tableId)
    if (section.declaredRows !== expectedTableRows) {
      errors.push(
        `Rendered table ${section.tableId} declares ${Number.isNaN(section.declaredRows) ? "no" : section.declaredRows} row(s); expected ${expectedTableRows}`
      )
    }
    if (section.actualRows !== expectedTableRows) {
      errors.push(
        `Rendered table ${section.tableId} contains ${section.actualRows} row marker(s); expected ${expectedTableRows}`
      )
    }
  }
  for (const tableId of expectedById.keys()) {
    if (!seenTableIds.has(tableId)) {
      errors.push(
        `Structured case-law reference table was not rendered: ${tableId}`
      )
    }
  }
  const rowsInsideSections = renderedSections.reduce(
    (sum, section) => sum + section.actualRows,
    0
  )
  if (rowsInsideSections !== renderedRowMarkers) {
    errors.push(
      `${renderedRowMarkers - rowsInsideSections} case-law reference row marker(s) rendered outside a semantic table`
    )
  }
  if (leakedDigestBlocks.length) {
    errors.push(
      `${leakedDigestBlocks.length} case-law reference source block(s) leaked into ordinary digest markup`
    )
  }

  return {
    ok: errors.length === 0,
    expected: {
      tables: tables.length,
      rows: expectedRows,
      sourceBlocks: sourceTableBlocks.length,
    },
    rendered: {
      tables: renderedSections.length,
      rows: renderedRowMarkers,
      sourceDigestLeaks: leakedDigestBlocks.length,
    },
    tables: renderedSections,
    errors,
  }
}

async function quarantineRenderedArtifacts(paths, judgmentId) {
  const safeJudgmentId = judgmentId.replace(/[^A-Za-z0-9_-]/g, "_")
  const quarantineDirectory = resolve(
    `reading-copy-data/quarantine/${safeJudgmentId}/${Date.now()}`
  )
  await mkdir(quarantineDirectory, { recursive: true })

  const moved = []
  const failures = []
  for (const path of paths) {
    const destination = resolve(quarantineDirectory, basename(path))
    try {
      await rename(path, destination)
      moved.push(destination)
    } catch (error) {
      failures.push({
        path,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return { directory: quarantineDirectory, moved, failures }
}

const enrichArguments = [
  resolve(scriptDirectory, "enrich-reading-copy-layout.mjs"),
  inputPath,
  "--output",
  layoutPath,
]
if (sourcePdf) enrichArguments.push("--pdf", resolve(sourcePdf))

execFileSync(process.execPath, enrichArguments, {
  cwd: process.cwd(),
  stdio: "inherit",
  timeout: 300_000,
})

const layoutDocument = JSON.parse(await readFile(layoutPath, "utf8"))
const validation = validateReadingCopyLayout(layoutDocument)
console.log(JSON.stringify({ validation }))
if (!validation.ok) {
  throw new Error(
    `Reading-copy layout validation failed: ${validation.errors.join("; ")}`
  )
}

execFileSync(
  process.execPath,
  [
    resolve(scriptDirectory, "generate-reading-copy-pdf.mjs"),
    layoutPath,
    "--output",
    outputPath,
    "--html",
    htmlPath,
  ],
  {
    cwd: process.cwd(),
    stdio: "inherit",
    timeout: 300_000,
  }
)

const renderedHtml = await readFile(htmlPath, "utf8")

// Last line of defence against a silently empty reading copy. The layout gate
// checks block roles, but the renderer recomputes the body boundary over a
// furniture-filtered array, so the two can still disagree and emit a
// correctly-branded PDF containing no judgment. Assert on the artifact itself.
const renderedParagraphs = [
  ...renderedHtml.matchAll(/<div\b[^>]*\bclass="judgment-paragraph"/gi),
].length
if (renderedParagraphs === 0) {
  const quarantine = await quarantineRenderedArtifacts(
    [htmlPath, outputPath],
    judgmentId
  )
  console.error(JSON.stringify({ rendered_body_integrity: { ok: false }, quarantine }))
  throw new Error(
    "Rendered reading copy contains no judgment paragraphs; refusing to publish an empty judgment"
  )
}

const renderIntegrity = renderedCaseLawReferenceIntegrity(
  layoutDocument,
  renderedHtml
)
console.log(
  JSON.stringify({ case_law_reference_render_integrity: renderIntegrity })
)
if (!renderIntegrity.ok) {
  const quarantine = await quarantineRenderedArtifacts(
    [htmlPath, outputPath],
    judgmentId
  )
  console.error(
    JSON.stringify({
      case_law_reference_render_integrity: renderIntegrity,
      quarantine,
    })
  )
  throw new Error(
    `Rendered case-law reference integrity failed: ${renderIntegrity.errors.join("; ")}`
  )
}

console.log(
  JSON.stringify({
    judgment_id: judgmentId,
    source: inputPath,
    layout: layoutPath,
    html: htmlPath,
    pdf: outputPath,
  })
)
