import assert from "node:assert/strict"
import test from "node:test"
import {
  caseLawReferenceTreatmentTotals,
  extractCaseLawReferenceTables,
  parseCaseLawReferenceLine,
} from "./case-law-reference.mjs"
import { parsePopplerXml } from "./poppler-layout.mjs"

const page8Rows = [
  ["[1996] 10 Suppl. SCR 284", "referred to", "Para 4"],
  ["[1979] 1 SCR 392", "referred to", "Para 4"],
  ["[1981] 2 SCR 516", "referred to", "Para 4"],
  ["[2017] 10 SCR 569", "referred to", "Para 4"],
  ["[2018] 11 SCR 951", "referred to", "Para 4"],
  ["[2018] 9 SCR 291", "referred to", "Para 4"],
  ["[1997] 3 Suppl. SCR 404", "referred to", "Para 4"],
  ["[1997] 6 Suppl. SCR 595", "referred to", "Para 4"],
  ["(2009) 5 SCC 212", "referred to", "Para 4"],
  ["(1984) 2 SCC 244", "referred to", "Para 4"],
  ["(1985) 1 SCC 317", "referred to", "Para 4"],
  ["(1991) 3 SCC 655", "referred to", "Para 4"],
  ["(1991) 4 SCC 406", "referred to", "Para 4"],
  ["(2018) SCC Online 2679", "referred to", "Para 4"],
  ["[1973] 0 Suppl. SCR 1", "followed", "Para 14"],
  ["[1978] 1 SCR 1", "followed", "Para 14"],
  ["[2007] 1 SCR 706", "followed", "Para 14"],
  ["[2014] 12 SCR 875", "followed", "Para 14"],
  ["[1970] 1 SCR 388", "referred to", "Para 14"],
  ["[2017] 7 SCR 1", "relied on", "Para 15"],
  ["[2018] 4 SCR 1", "relied on", "Para 16"],
  ["[2015] 14 SCR 613", "referred to", "Para 21"],
  ["(2002) 4 SCC 578", "referred to", "Para 22"],
  ["[2010] 6 SCR 218", "referred to", "Para 24"],
  ["[1989] 3 SCR 488", "relied on", "Para 28"],
  ["[2012] 2 SCR 912", "relied on", "Para 29"],
  ["[2017] 1 SCR 658", "relied on", "Para 30"],
  ["[2014] 9 SCR 965", "referred to", "Para 30"],
  ["[2010] 12 SCR 996", "referred to", "Para 30"],
]

const page9Rows = [
  ["[2017] 3 SCR 291", "referred to", "Para 31"],
  ["[2003] 4 Suppl. SCR 222", "referred to", "Para 34"],
  ["[1993] 3 Suppl. SCR 141", "referred to", "Para 34"],
  ["[2004] 2 Suppl. SCR 723", "referred to", "Para 34"],
  ["AIR 1994 Bom 323", "referred to", "Para 34"],
  ["[1983] 2 SCR 337", "referred to", "Para 35"],
  ["[1993] 2 SCR 581", "referred to", "Para 36"],
  ["[1995] 1 Suppl. SCR 44", "referred to", "Para 36"],
  ["[2018] 12 SCR 51", "referred to", "Para 39"],
  ["[2012] 14 SCR 862", "referred to", "Para 40"],
]

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}

function rowXml(row, top, columns, splitCells = false) {
  const [citation, treatment, pinpoint] = row
  const citationElement = `<text top="${top}" left="${columns[0]}" width="130" height="10" font="1"><b>${escapeXml(citation)}</b></text>`
  if (!splitCells) {
    return [
      citationElement,
      `<text top="${top}" left="${columns[1]}" width="70" height="10" font="1"><b>${treatment}</b></text>`,
      `<text top="${top}" left="${columns[2]}" width="50" height="10" font="1"><b>${pinpoint}</b></text>`,
    ].join("\n")
  }

  const [treatmentFirst, treatmentSecond] = treatment.split(" ")
  const [pinpointFirst, pinpointSecond] = pinpoint.split(" ")
  return [
    citationElement,
    `<text top="${top}" left="${columns[1]}" width="34" height="10" font="1"><b>${treatmentFirst}</b></text>`,
    `<text top="${top}" left="${columns[1] + 36}" width="30" height="10" font="1"><b>${treatmentSecond}</b></text>`,
    `<text top="${top}" left="${columns[2]}" width="29" height="10" font="1"><b>${pinpointFirst}</b></text>`,
    `<text top="${top}" left="${columns[2] + 31}" width="18" height="10" font="1"><b>${pinpointSecond}</b></text>`,
  ].join("\n")
}

function gutterXml(left, tops) {
  return "ABCDEFGH"
    .split("")
    .map(
      (letter, index) =>
        `<text top="${tops[index]}" left="${left}" width="8" height="10" font="0">${letter}</text>`
    )
    .join("\n")
}

function sourceChunkId(page, rowIndex) {
  let paragraph
  if (page === 8) {
    paragraph =
      rowIndex <= 19 ? rowIndex + 3 : rowIndex === 20 ? 22 : rowIndex + 2
  } else {
    paragraph = rowIndex <= 3 ? rowIndex + 2 : rowIndex === 4 ? 5 : rowIndex + 1
  }
  return `case:p${String(page).padStart(4, "0")}:para${String(paragraph).padStart(4, "0")}:part01`
}

function provenanceBlocks(page, rows, firstTop, lineHeight) {
  const grouped = new Map()
  rows.forEach((_, rowIndex) => {
    const chunkId = sourceChunkId(page, rowIndex)
    const top = firstTop + rowIndex * lineHeight
    const existing = grouped.get(chunkId) ?? { tops: [], chunkId }
    existing.tops.push(top)
    grouped.set(chunkId, existing)
  })
  return [...grouped.values()].map(({ chunkId, tops }) => ({
    sourcePage: page,
    sourceChunkIds: [chunkId],
    typography: {
      bounds: {
        top: Math.min(...tops),
        bottom: Math.max(...tops) + 10,
        left: 140,
        right: 430,
      },
    },
  }))
}

function samplePdfAndBlocks() {
  const page8FirstTop = 166
  const page8LineHeight = 17
  const page9FirstTop = 149
  const page9LineHeight = 19
  const page8Columns = [143, 298, 379]
  const page9Columns = [157, 312, 393]
  const page8RowXml = page8Rows
    .map((row, index) =>
      rowXml(
        row,
        page8FirstTop + index * page8LineHeight,
        page8Columns,
        index === 0
      )
    )
    .join("\n")
  const page9RowXml = page9Rows
    .map((row, index) =>
      rowXml(row, page9FirstTop + index * page9LineHeight, page9Columns)
    )
    .join("\n")
  const page8GutterTops = [
    90,
    170,
    250,
    330,
    410,
    page8FirstTop + 19 * page8LineHeight,
    650,
    720,
  ]
  const page9GutterTops = [page9FirstTop, 230, 310, 390, 470, 550, 630, 710]

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<pdf2xml>
  <fontspec id="0" size="11" family="ABCDEF+TimesNewRoman"/>
  <fontspec id="1" size="11" family="ABCDEF+TimesNewRoman,Bold"/>
  <page number="8" width="612" height="792">
    ${gutterXml(470, page8GutterTops)}
    <text top="148" left="248" width="103" height="10" font="1"><b>Case Law Reference</b></text>
    ${page8RowXml}
  </page>
  <page number="9" width="612" height="792">
    ${gutterXml(137, page9GutterTops)}
    ${page9RowXml}
    <text top="350" left="185" width="300" height="10" font="0">CIVIL ORIGINAL JURISDICTION: Application No. 1</text>
    ${rowXml(["[2020] 1 SCR 999", "referred to", "Para 99"], 400, page9Columns)}
  </page>
</pdf2xml>`

  return {
    pdf: parsePopplerXml(xml),
    blocks: [
      ...provenanceBlocks(8, page8Rows, page8FirstTop, page8LineHeight),
      ...provenanceBlocks(9, page9Rows, page9FirstTop, page9LineHeight),
    ],
  }
}

test("parses supported case-reference row forms and rejects narrative text", () => {
  assert.deepEqual(
    parseCaseLawReferenceLine("[1996] 10 Suppl. SCR 284 referred to Para 4"),
    {
      citation: "[1996] 10 Suppl. SCR 284",
      treatment: "referred to",
      pinpoint: "Para 4",
      paragraphRefs: [4],
    }
  )
  assert.equal(
    parseCaseLawReferenceLine("(2018) SCC Online 2679 referred to Para 4")
      ?.citation,
    "(2018) SCC Online 2679"
  )
  assert.equal(
    parseCaseLawReferenceLine("AIR 1994 Bom 323 referred to Para 34")?.citation,
    "AIR 1994 Bom 323"
  )
  assert.equal(
    parseCaseLawReferenceLine("[2001] 2 SCR 10 not followed Para 7")?.treatment,
    "not followed"
  )
  assert.equal(
    parseCaseLawReferenceLine("[2001] 2 SCR 10 applied Paras 7 and 9")
      ?.treatment,
    "applied"
  )
  assert.equal(
    parseCaseLawReferenceLine(
      "Example v. State (2020) 1 SCC 1 referred to Para 4"
    ),
    null
  )
  assert.equal(
    parseCaseLawReferenceLine("[2020] bananas referred to Para 4"),
    null
  )
  assert.equal(
    parseCaseLawReferenceLine("[2020) 1 SCR 2 referred to Para 4"),
    null
  )
})

test("extracts the complete two-page 39-row table with provenance and no gutters", () => {
  const { pdf, blocks } = samplePdfAndBlocks()
  const tables = extractCaseLawReferenceTables(pdf, blocks)

  assert.equal(tables.length, 1)
  const [table] = tables
  assert.equal(table.rowCount, 39)
  assert.deepEqual(table.sourcePages, [8, 9])
  assert.deepEqual(caseLawReferenceTreatmentTotals(table.rows), {
    "referred to": 30,
    followed: 4,
    "relied on": 5,
  })
  assert.equal(table.provenanceCoverage, 1)
  assert.equal(table.confidence, 1)
  assert.equal(table.sourceChunkIds.length, 37)
  assert.ok(table.rows.every((row) => row.sourceChunkIds.length > 0))
  assert.deepEqual(
    table.rows.map((row) => [row.citation, row.treatment, row.pinpoint]),
    [...page8Rows, ...page9Rows]
  )

  const sharedPage8Chunk = "case:p0008:para0022:part01"
  assert.deepEqual(
    table.rows
      .filter((row) => row.sourceChunkIds.includes(sharedPage8Chunk))
      .map((row) => row.citation),
    ["[2017] 7 SCR 1", "[2018] 4 SCR 1"]
  )
  const sharedPage9Chunk = "case:p0009:para0005:part01"
  assert.deepEqual(
    table.rows
      .filter((row) => row.sourceChunkIds.includes(sharedPage9Chunk))
      .map((row) => row.citation),
    ["[2004] 2 Suppl. SCR 723", "AIR 1994 Bom 323"]
  )
  assert.ok(
    table.rows.every((row) => !/(?:^|\s)[A-H](?:\s|\[|$)/.test(row.citation))
  )
  assert.ok(!table.rows.some((row) => row.citation === "[2020] 1 SCR 999"))
})
