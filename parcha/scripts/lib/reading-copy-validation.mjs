import {
  CASE_LAW_TREATMENTS,
  parseCaseLawReferenceLine,
} from "./case-law-reference.mjs"

const CASE_REFERENCE_MIN_CONFIDENCE = 0.98
const CASE_REFERENCE_CITATION_PATTERN =
  /^(?:\[\s*\d{4}\s*\]|\(\s*\d{4}\s*\)|AIR\s+\d{4}\b|\d{4}\s+INSC\s+\d+\b)/i
const CASE_REFERENCE_PARAGRAPH_NUMBER = String.raw`\d+[A-Za-z]?(?:\([A-Za-z0-9]+\))?`
const CASE_REFERENCE_PINPOINT_PATTERN = new RegExp(
  String.raw`^Para(?:graph)?s?\.?\s+${CASE_REFERENCE_PARAGRAPH_NUMBER}` +
    String.raw`(?:\s*(?:(?:[-–—,]|and|to)\s*)${CASE_REFERENCE_PARAGRAPH_NUMBER})*$`,
  "iu"
)

function paragraphNumber(block) {
  const match = /^Paragraph\s+(\d+)$/i.exec(block.label ?? "")
  return match ? Number(match[1]) : null
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0
}

function isProbability(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1
}

function isBounds(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    Number.isFinite(value.top) &&
    Number.isFinite(value.bottom) &&
    Number.isFinite(value.left) &&
    Number.isFinite(value.right) &&
    value.top >= 0 &&
    value.left >= 0 &&
    value.bottom > value.top &&
    value.right > value.left
  )
}

function normalizedRowKey(row) {
  return [row.citation, row.treatment, row.pinpoint]
    .map((value) =>
      String(value ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .toLocaleLowerCase("en")
    )
    .join("|")
}

function sameNumberArray(left, right) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  )
}

function sameStringSet(left, right) {
  if (left.size !== right.size) return false
  return [...left].every((value) => right.has(value))
}

function boundsContains(outer, inner, tolerance = 0.75) {
  return (
    inner.top >= outer.top - tolerance &&
    inner.bottom <= outer.bottom + tolerance &&
    inner.left >= outer.left - tolerance &&
    inner.right <= outer.right + tolerance
  )
}

function validateCaseLawReferenceTables(document, blocks, errors) {
  const suppliedTables = document.caseLawReferenceTables
  if (suppliedTables !== undefined && !Array.isArray(suppliedTables)) {
    errors.push("caseLawReferenceTables must be an array when supplied")
  }
  const tables = Array.isArray(suppliedTables) ? suppliedTables : []
  const knownChunkIds = new Set(
    blocks.flatMap((block) =>
      Array.isArray(block.sourceChunkIds) ? block.sourceChunkIds : []
    )
  )
  const tableIds = new Set()
  let rowCount = 0
  let lowConfidenceRows = 0
  let rowsWithoutProvenance = 0

  for (const [tableIndex, table] of tables.entries()) {
    const context = `Case-law reference table ${table?.id ?? tableIndex + 1}`
    if (!table || typeof table !== "object" || Array.isArray(table)) {
      errors.push(`${context} must be an object`)
      continue
    }
    if (!isNonEmptyString(table.id)) {
      errors.push(`${context} is missing a valid ID`)
    } else if (tableIds.has(table.id)) {
      errors.push(`Duplicate case-law reference table ID: ${table.id}`)
    } else {
      tableIds.add(table.id)
    }
    if (table.role !== "case_law_reference") {
      errors.push(`${context} has an invalid role`)
    }
    if (!Array.isArray(table.rows) || table.rows.length === 0) {
      errors.push(`${context} contains no rows`)
    }
    const rows = Array.isArray(table.rows) ? table.rows : []
    rowCount += rows.length
    if (!Number.isInteger(table.rowCount) || table.rowCount !== rows.length) {
      errors.push(
        `${context} rowCount ${table.rowCount ?? "missing"} does not match ${rows.length} row(s)`
      )
    }

    const sourcePages = Array.isArray(table.sourcePages)
      ? table.sourcePages
      : []
    if (
      sourcePages.length === 0 ||
      sourcePages.some((page) => !Number.isInteger(page) || page < 1) ||
      sourcePages.some(
        (page, index) => index > 0 && page <= sourcePages[index - 1]
      )
    ) {
      errors.push(
        `${context} must have unique, increasing positive source pages`
      )
    }
    if (
      table.headingBounds !== null &&
      table.headingBounds !== undefined &&
      !isBounds(table.headingBounds)
    ) {
      errors.push(`${context} has invalid heading bounds`)
    }
    if (!isProbability(table.confidence)) {
      errors.push(`${context} has invalid confidence`)
    } else if (table.confidence < CASE_REFERENCE_MIN_CONFIDENCE) {
      errors.push(
        `${context} confidence ${table.confidence} is below ${CASE_REFERENCE_MIN_CONFIDENCE}`
      )
    }
    if (!isProbability(table.provenanceCoverage)) {
      errors.push(`${context} has invalid provenance coverage`)
    }

    const tableChunkIds = Array.isArray(table.sourceChunkIds)
      ? table.sourceChunkIds
      : []
    if (
      tableChunkIds.length === 0 ||
      tableChunkIds.some((chunkId) => !isNonEmptyString(chunkId))
    ) {
      errors.push(`${context} is missing chunk provenance`)
    }
    if (new Set(tableChunkIds).size !== tableChunkIds.length) {
      errors.push(`${context} contains duplicate source chunk IDs`)
    }
    for (const chunkId of tableChunkIds) {
      if (!knownChunkIds.has(chunkId)) {
        errors.push(`${context} references an unknown chunk ID: ${chunkId}`)
      }
    }

    const rowKeys = new Set()
    const rowChunkIds = new Set()
    let previousPage = 0
    let previousTop = -1
    for (const [rowIndex, row] of rows.entries()) {
      const rowContext = `${context}, row ${rowIndex + 1}`
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        errors.push(`${rowContext} must be an object`)
        continue
      }
      if (
        !isNonEmptyString(row.citation) ||
        !CASE_REFERENCE_CITATION_PATTERN.test(row.citation.trim())
      ) {
        errors.push(`${rowContext} has an invalid citation`)
      }
      if (
        !isNonEmptyString(row.treatment) ||
        !CASE_LAW_TREATMENTS.includes(
          row.treatment.trim().toLocaleLowerCase("en")
        )
      ) {
        errors.push(`${rowContext} has an invalid treatment`)
      }
      if (
        !isNonEmptyString(row.pinpoint) ||
        !CASE_REFERENCE_PINPOINT_PATTERN.test(row.pinpoint.trim())
      ) {
        errors.push(`${rowContext} has an invalid paragraph pinpoint`)
      }
      const paragraphRefs = Array.isArray(row.paragraphRefs)
        ? row.paragraphRefs
        : []
      if (
        paragraphRefs.length === 0 ||
        paragraphRefs.some(
          (reference) => !Number.isInteger(reference) || reference < 1
        )
      ) {
        errors.push(`${rowContext} has invalid paragraph references`)
      } else if (isNonEmptyString(row.pinpoint)) {
        const pinpointRefs = [...row.pinpoint.matchAll(/\d+/g)].map((match) =>
          Number(match[0])
        )
        if (!sameNumberArray(paragraphRefs, pinpointRefs)) {
          errors.push(
            `${rowContext} paragraph references do not match its pinpoint`
          )
        }
      }

      if (!Number.isInteger(row.sourcePage) || row.sourcePage < 1) {
        errors.push(`${rowContext} has an invalid source page`)
      }
      if (!Number.isFinite(row.top) || row.top < 0) {
        errors.push(`${rowContext} has an invalid source position`)
      }
      if (Number.isInteger(row.sourcePage) && Number.isFinite(row.top)) {
        if (
          row.sourcePage < previousPage ||
          (row.sourcePage === previousPage && row.top <= previousTop)
        ) {
          errors.push(
            `${rowContext} is not in strictly increasing source order`
          )
        }
        previousPage = row.sourcePage
        previousTop = row.top
      }
      if (sourcePages.length && !sourcePages.includes(row.sourcePage)) {
        errors.push(`${rowContext} source page is not declared by its table`)
      }
      if (!isBounds(row.bounds)) {
        errors.push(`${rowContext} has invalid row bounds`)
      } else if (
        Number.isFinite(row.top) &&
        Math.abs(row.bounds.top - row.top) > 0.75
      ) {
        errors.push(`${rowContext} top does not agree with its row bounds`)
      }

      const cellBounds = row.cellBounds
      const cellNames = ["citation", "treatment", "pinpoint"]
      if (
        !cellBounds ||
        typeof cellBounds !== "object" ||
        Array.isArray(cellBounds)
      ) {
        errors.push(`${rowContext} is missing cell bounds`)
      } else {
        for (const cellName of cellNames) {
          if (!isBounds(cellBounds[cellName])) {
            errors.push(`${rowContext} has invalid ${cellName} cell bounds`)
          } else if (
            isBounds(row.bounds) &&
            !boundsContains(row.bounds, cellBounds[cellName])
          ) {
            errors.push(
              `${rowContext} ${cellName} cell lies outside the row bounds`
            )
          }
        }
        if (
          cellNames.every((cellName) => isBounds(cellBounds[cellName])) &&
          !(
            cellBounds.citation.right <= cellBounds.treatment.left + 0.75 &&
            cellBounds.treatment.right <= cellBounds.pinpoint.left + 0.75
          )
        ) {
          errors.push(
            `${rowContext} cells are not in citation-treatment-pinpoint order`
          )
        }
      }

      if (!isProbability(row.confidence)) {
        errors.push(`${rowContext} has invalid confidence`)
      } else if (row.confidence < CASE_REFERENCE_MIN_CONFIDENCE) {
        lowConfidenceRows += 1
        errors.push(
          `${rowContext} confidence ${row.confidence} is below ${CASE_REFERENCE_MIN_CONFIDENCE}`
        )
      }

      const sourceChunkIds = Array.isArray(row.sourceChunkIds)
        ? row.sourceChunkIds
        : []
      if (
        sourceChunkIds.length === 0 ||
        sourceChunkIds.some((chunkId) => !isNonEmptyString(chunkId))
      ) {
        rowsWithoutProvenance += 1
        errors.push(`${rowContext} is missing chunk provenance`)
      }
      if (new Set(sourceChunkIds).size !== sourceChunkIds.length) {
        errors.push(`${rowContext} contains duplicate source chunk IDs`)
      }
      for (const chunkId of sourceChunkIds) {
        rowChunkIds.add(chunkId)
        if (!knownChunkIds.has(chunkId)) {
          errors.push(
            `${rowContext} references an unknown chunk ID: ${chunkId}`
          )
        }
        if (!tableChunkIds.includes(chunkId)) {
          errors.push(
            `${rowContext} references a chunk not declared by its table: ${chunkId}`
          )
        }
      }

      const key = normalizedRowKey(row)
      if (rowKeys.has(key)) errors.push(`${rowContext} duplicates another row`)
      rowKeys.add(key)
    }

    const tableChunkSet = new Set(tableChunkIds)
    if (!sameStringSet(tableChunkSet, rowChunkIds)) {
      errors.push(
        `${context} chunk provenance does not equal the union of its rows`
      )
    }
    const rowPageSet = new Set(
      rows.map((row) => row?.sourcePage).filter(Number.isInteger)
    )
    if (
      !sameStringSet(
        new Set(sourcePages.map(String)),
        new Set([...rowPageSet].map(String))
      )
    ) {
      errors.push(
        `${context} source pages do not equal the pages represented by its rows`
      )
    }
    const calculatedProvenanceCoverage = rows.length
      ? rows.filter(
          (row) =>
            Array.isArray(row?.sourceChunkIds) && row.sourceChunkIds.length > 0
        ).length / rows.length
      : 0
    if (
      isProbability(table.provenanceCoverage) &&
      Math.abs(table.provenanceCoverage - calculatedProvenanceCoverage) > 1e-9
    ) {
      errors.push(`${context} provenance coverage does not match its rows`)
    }
    if (calculatedProvenanceCoverage < 1) {
      errors.push(`${context} does not have complete row provenance`)
    }
    const validRowConfidences = rows
      .map((row) => row?.confidence)
      .filter(isProbability)
    if (
      rows.length > 0 &&
      validRowConfidences.length === rows.length &&
      isProbability(table.confidence)
    ) {
      const calculatedConfidence =
        validRowConfidences.reduce((sum, confidence) => sum + confidence, 0) /
        rows.length
      if (Math.abs(table.confidence - calculatedConfidence) > 1e-9) {
        errors.push(`${context} confidence does not match its rows`)
      }
    }
  }

  const manifest = document.layout?.caseLawReference
  if (tables.length > 0 && (!manifest || typeof manifest !== "object")) {
    errors.push("Layout is missing its case-law reference manifest")
  }
  if (manifest && typeof manifest === "object") {
    if (
      !Number.isInteger(manifest.tableCount) ||
      manifest.tableCount !== tables.length
    ) {
      errors.push(
        `Case-law reference manifest tableCount ${manifest.tableCount ?? "missing"} does not match ${tables.length}`
      )
    }
    if (
      !Number.isInteger(manifest.rowCount) ||
      manifest.rowCount !== rowCount
    ) {
      errors.push(
        `Case-law reference manifest rowCount ${manifest.rowCount ?? "missing"} does not match ${rowCount}`
      )
    }
  }

  const structuredChunkIds = new Set(
    tables.flatMap((table) =>
      Array.isArray(table.sourceChunkIds) ? table.sourceChunkIds : []
    )
  )
  const denseCandidateRuns = []
  let candidateRun = []
  for (const block of blocks) {
    if (parseCaseLawReferenceLine(block.text ?? "")) {
      candidateRun.push(block)
      continue
    }
    if (candidateRun.length >= 4) denseCandidateRuns.push(candidateRun)
    candidateRun = []
  }
  if (candidateRun.length >= 4) denseCandidateRuns.push(candidateRun)

  const unstructuredCandidateBlocks = denseCandidateRuns
    .flat()
    .filter((block) =>
      (block.sourceChunkIds ?? []).some(
        (chunkId) => !structuredChunkIds.has(chunkId)
      )
    )
  if (unstructuredCandidateBlocks.length) {
    errors.push(
      `${unstructuredCandidateBlocks.length} row-like case-law reference block(s) in dense runs were not promoted to a validated table`
    )
  }

  return {
    tables: tables.length,
    rows: rowCount,
    lowConfidenceRows,
    rowsWithoutProvenance,
    denseCandidateRuns: denseCandidateRuns.length,
    unstructuredCandidateBlocks: unstructuredCandidateBlocks.length,
  }
}

export function validateReadingCopyLayout(document) {
  const errors = []
  const warnings = []
  const blocks = Array.isArray(document.blocks) ? document.blocks : []

  if (document.schema !== "lex-archives-reading-copy-layout/v1") {
    errors.push("Unsupported or missing layout schema")
  }
  if (!blocks.length) errors.push("Layout contains no blocks")
  if (!/^[a-f0-9]{64}$/i.test(document.layout?.sourcePdfSha256 ?? "")) {
    errors.push("Layout is missing a valid source PDF SHA-256")
  }

  let previousPage = 0
  const seenChunkIds = new Set()
  for (const block of blocks) {
    if (
      !Number.isInteger(block.sourcePage) ||
      block.sourcePage < previousPage
    ) {
      errors.push(
        `Non-monotonic source page at ${block.sourceChunkIds?.[0] ?? "unknown block"}`
      )
      break
    }
    previousPage = block.sourcePage
    for (const chunkId of block.sourceChunkIds ?? []) {
      if (seenChunkIds.has(chunkId)) {
        errors.push(`Chunk ID appears in more than one block: ${chunkId}`)
      }
      seenChunkIds.add(chunkId)
    }
  }

  const judgmentStart = blocks.findIndex(
    (block) => paragraphNumber(block) === 1
  )
  const mainParagraphs = []
  if (judgmentStart >= 0) {
    let expected = 1
    for (const block of blocks.slice(judgmentStart)) {
      const supplied = paragraphNumber(block)
      if (supplied === expected) {
        mainParagraphs.push(supplied)
        expected += 1
      } else if (supplied && supplied > expected && supplied <= expected + 3) {
        errors.push(
          `Main judgment paragraph ${expected} is missing before paragraph ${supplied}`
        )
        break
      }
    }
  } else {
    warnings.push("No numbered main judgment sequence was detected")
  }

  const lowConfidenceSubstantive = blocks.filter(
    (block) =>
      block.role !== "front_matter" &&
      Number.isFinite(block.typography?.coverage) &&
      block.typography.coverage < 0.8
  )
  if (lowConfidenceSubstantive.length) {
    warnings.push(
      `${lowConfidenceSubstantive.length} substantive block(s) have typography alignment below 80%`
    )
  }

  // Fail closed on an undetected judgment body. When findJudgmentStart cannot
  // place the body, every block is labelled front_matter and the renderer emits
  // a correctly-branded PDF containing no judgment at all. That is silent data
  // loss, so it has to be an error rather than a warning.
  const bodyBlocks = blocks.filter((block) =>
    ["judgment_paragraph", "judgment_continuation", "quote", "footnote"].includes(
      block.role
    )
  )
  if (!bodyBlocks.length) {
    errors.push(
      "No judgment body blocks were detected; the reading copy would render an empty judgment"
    )
  }

  const semanticBlocks = blocks.filter((block) => block.role !== "front_matter")
  const crossPageHeadnotePairs = semanticBlocks.filter((block, index) => {
    const next = semanticBlocks[index + 1]
    return (
      block.role === "headnote" &&
      next?.role === "headnote" &&
      next.sourcePage > block.sourcePage &&
      block.typography?.dominantStyle === next.typography?.dominantStyle
    )
  }).length
  const caseLawReference = validateCaseLawReferenceTables(
    document,
    blocks,
    errors
  )

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    stats: {
      blocks: blocks.length,
      uniqueChunkIds: seenChunkIds.size,
      sourcePages: new Set(blocks.map((block) => block.sourcePage)).size,
      numberedMainParagraphs: mainParagraphs.length,
      finalMainParagraph: mainParagraphs.at(-1) ?? null,
      crossPageHeadnotePairs,
      lowConfidenceSubstantive: lowConfidenceSubstantive.length,
      caseLawReferenceTables: caseLawReference.tables,
      caseLawReferenceRows: caseLawReference.rows,
      lowConfidenceCaseLawReferenceRows: caseLawReference.lowConfidenceRows,
      caseLawReferenceRowsWithoutProvenance:
        caseLawReference.rowsWithoutProvenance,
      denseCaseLawReferenceCandidateRuns: caseLawReference.denseCandidateRuns,
      unstructuredCaseLawReferenceCandidateBlocks:
        caseLawReference.unstructuredCandidateBlocks,
    },
  }
}
