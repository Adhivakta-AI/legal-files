import assert from "node:assert/strict"
import test from "node:test"
import { validateReadingCopyLayout } from "./reading-copy-validation.mjs"

function bounds(top, left, bottom, right) {
  return { top, left, bottom, right }
}

function validDocument() {
  const sourceChunkId = "case:p0001:para0001:part01"
  return {
    schema: "lex-archives-reading-copy-layout/v1",
    layout: {
      sourcePdfSha256: "a".repeat(64),
      caseLawReference: {
        tableCount: 1,
        rowCount: 1,
      },
    },
    blocks: [
      {
        label: "Unnumbered passage",
        role: "case_reference_source",
        sourcePage: 1,
        sourceChunkIds: [sourceChunkId],
        text: "[2020] 1 SCR 1 referred to Para 4",
        typography: { coverage: 1 },
      },
      {
        label: "Paragraph 1",
        role: "judgment_paragraph",
        sourcePage: 2,
        sourceChunkIds: ["case:p0002:para0001:part01"],
        text: "1. Judgment begins.",
        typography: { coverage: 1 },
      },
    ],
    caseLawReferenceTables: [
      {
        id: "case-law-reference-p0001",
        role: "case_law_reference",
        title: "Case Law Reference",
        sourcePages: [1],
        sourceChunkIds: [sourceChunkId],
        headingBounds: bounds(70, 170, 82, 310),
        rowCount: 1,
        provenanceCoverage: 1,
        confidence: 1,
        rows: [
          {
            citation: "[2020] 1 SCR 1",
            treatment: "referred to",
            pinpoint: "Para 4",
            paragraphRefs: [4],
            sourcePage: 1,
            top: 100,
            bounds: bounds(100, 100, 112, 390),
            cellBounds: {
              citation: bounds(100, 100, 112, 210),
              treatment: bounds(100, 230, 112, 290),
              pinpoint: bounds(100, 320, 112, 390),
            },
            sourceChunkIds: [sourceChunkId],
            confidence: 1,
          },
        ],
      },
    ],
  }
}

test("accepts a fully provenanced case-law reference table and reports stats", () => {
  const result = validateReadingCopyLayout(validDocument())

  assert.equal(result.ok, true)
  assert.deepEqual(result.errors, [])
  assert.equal(result.stats.caseLawReferenceTables, 1)
  assert.equal(result.stats.caseLawReferenceRows, 1)
  assert.equal(result.stats.lowConfidenceCaseLawReferenceRows, 0)
  assert.equal(result.stats.caseLawReferenceRowsWithoutProvenance, 0)
})

test("rejects manifest and table row-count mismatches", () => {
  const document = validDocument()
  document.caseLawReferenceTables[0].rowCount = 2
  document.layout.caseLawReference.rowCount = 3

  const result = validateReadingCopyLayout(document)

  assert.equal(result.ok, false)
  assert.ok(
    result.errors.some((error) =>
      error.includes("rowCount 2 does not match 1 row")
    )
  )
  assert.ok(
    result.errors.some((error) =>
      error.includes("manifest rowCount 3 does not match 1")
    )
  )
})

test("rejects malformed treatment, pinpoint, paragraph references, and low confidence", () => {
  const document = validDocument()
  const row = document.caseLawReferenceTables[0].rows[0]
  row.treatment = "mentioned"
  row.pinpoint = "near paragraph four"
  row.paragraphRefs = [0]
  row.confidence = 0.9
  document.caseLawReferenceTables[0].confidence = 0.9

  const result = validateReadingCopyLayout(document)

  assert.equal(result.ok, false)
  assert.ok(result.errors.some((error) => error.includes("invalid treatment")))
  assert.ok(
    result.errors.some((error) => error.includes("invalid paragraph pinpoint"))
  )
  assert.ok(
    result.errors.some((error) =>
      error.includes("invalid paragraph references")
    )
  )
  assert.ok(
    result.errors.some((error) => error.includes("confidence 0.9 is below"))
  )
  assert.equal(result.stats.lowConfidenceCaseLawReferenceRows, 1)
})

test("rejects a table confidence that does not equal its row confidence aggregate", () => {
  const document = validDocument()
  document.caseLawReferenceTables[0].confidence = 0.99

  const result = validateReadingCopyLayout(document)

  assert.equal(result.ok, false)
  assert.ok(
    result.errors.some((error) =>
      error.includes("confidence does not match its rows")
    )
  )
})

test("rejects duplicate, non-monotonic rows and unknown chunk provenance", () => {
  const document = validDocument()
  const table = document.caseLawReferenceTables[0]
  const duplicate = structuredClone(table.rows[0])
  duplicate.top = 90
  duplicate.bounds = bounds(90, 100, 102, 390)
  duplicate.cellBounds = {
    citation: bounds(90, 100, 102, 210),
    treatment: bounds(90, 230, 102, 290),
    pinpoint: bounds(90, 320, 102, 390),
  }
  duplicate.sourceChunkIds = ["unknown:chunk"]
  table.rows.push(duplicate)
  table.rowCount = 2
  table.sourceChunkIds.push("unknown:chunk")
  table.provenanceCoverage = 1
  document.layout.caseLawReference.rowCount = 2

  const result = validateReadingCopyLayout(document)

  assert.equal(result.ok, false)
  assert.ok(
    result.errors.some((error) =>
      error.includes("not in strictly increasing source order")
    )
  )
  assert.ok(
    result.errors.some((error) => error.includes("duplicates another row"))
  )
  assert.ok(result.errors.some((error) => error.includes("unknown chunk ID")))
})

test("rejects missing provenance and invalid or misordered cell geometry", () => {
  const document = validDocument()
  const table = document.caseLawReferenceTables[0]
  const row = table.rows[0]
  row.sourceChunkIds = []
  table.sourceChunkIds = []
  table.provenanceCoverage = 1
  row.cellBounds.treatment = bounds(99, 80, 113, 150)

  const result = validateReadingCopyLayout(document)

  assert.equal(result.ok, false)
  assert.ok(
    result.errors.some((error) => error.includes("missing chunk provenance"))
  )
  assert.ok(
    result.errors.some((error) => error.includes("lies outside the row bounds"))
  )
  assert.ok(
    result.errors.some((error) =>
      error.includes("cells are not in citation-treatment-pinpoint order")
    )
  )
  assert.ok(
    result.errors.some((error) =>
      error.includes("provenance coverage does not match")
    )
  )
  assert.equal(result.stats.caseLawReferenceRowsWithoutProvenance, 1)
})

test("rejects a dense case-reference run that was left as prose", () => {
  const document = validDocument()
  document.caseLawReferenceTables = []
  document.layout.caseLawReference = { tableCount: 0, rowCount: 0 }
  document.blocks = Array.from({ length: 4 }, (_, index) => ({
    label: "Unnumbered passage",
    role: "authority_list",
    sourcePage: 1,
    sourceChunkIds: [`case:p0001:para000${index + 1}:part01`],
    text: `[20${20 + index}] 1 SCR ${index + 1} referred to Para ${index + 1}`,
    typography: { coverage: 1 },
  }))

  const result = validateReadingCopyLayout(document)

  assert.equal(result.ok, false)
  assert.ok(
    result.errors.some((error) =>
      error.includes("were not promoted to a validated table")
    )
  )
  assert.equal(result.stats.denseCaseLawReferenceCandidateRuns, 1)
  assert.equal(result.stats.unstructuredCaseLawReferenceCandidateBlocks, 4)
})
