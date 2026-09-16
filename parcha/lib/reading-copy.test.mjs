import assert from "node:assert/strict"
import fs from "node:fs/promises"
import test from "node:test"
import swc from "next/dist/build/swc/index.js"

await swc.loadBindings()
const source = await fs.readFile(
  new URL("./reading-copy.ts", import.meta.url),
  "utf8"
)
const transformed = await swc.transform(source, {
  filename: "reading-copy.ts",
  jsc: { parser: { syntax: "typescript" } },
  module: { type: "es6" },
})
const { buildJudgmentReadingCopy } = await import(
  `data:text/javascript;base64,${Buffer.from(transformed.code).toString("base64")}`
)

function row({ id, page, paragraph, number = null, part = 1, text }) {
  return {
    id,
    pdf_page: page,
    paragraph_index: paragraph,
    paragraph_number: number,
    part_index: part,
    text,
    text_source: "embedded",
  }
}

test("merges overlapping chunk parts and maps every citation chunk", () => {
  const copy = buildJudgmentReadingCopy("ISC-TEST", [
    row({
      id: "ISC-TEST:p0004:para0002:part02",
      page: 4,
      paragraph: 2,
      number: "1",
      part: 2,
      text: "over the lazy dog and keeps running into the next field.",
    }),
    row({
      id: "ISC-TEST:p0004:para0002:part01",
      page: 4,
      paragraph: 2,
      number: "1",
      text: "1. The quick brown fox jumps over the lazy dog and keeps running",
    }),
  ])

  assert.equal(copy.version, 1)
  assert.equal(copy.blockCount, 1)
  assert.equal(copy.startPage, 4)
  assert.equal(copy.endPage, 4)
  assert.deepEqual(copy.pages[0].blocks[0], {
    id: "ISC-TEST:reading:p0004:para0002",
    sourcePage: 4,
    paragraphNumber: "1",
    kind: "paragraph",
    text: "1. The quick brown fox jumps over the lazy dog and keeps running into the next field.",
    sourceChunkIds: [
      "ISC-TEST:p0004:para0002:part01",
      "ISC-TEST:p0004:para0002:part02",
    ],
  })
  assert.deepEqual(copy.chunkToBlockId, {
    "ISC-TEST:p0004:para0002:part01": "ISC-TEST:reading:p0004:para0002",
    "ISC-TEST:p0004:para0002:part02": "ISC-TEST:reading:p0004:para0002",
  })
})

test("starts at the true paragraph 1 and removes later SCR running headers", () => {
  const copy = buildJudgmentReadingCopy("ISC-HEADERS", [
    row({
      id: "front-footnote",
      page: 1,
      paragraph: 1,
      number: "1",
      text: "1 (2008) 1 SCC 1.",
    }),
    row({
      id: "front-title",
      page: 1,
      paragraph: 2,
      text: "ALPHA COMPANY versus THE STATE",
    }),
    row({
      id: "page-two-running-title",
      page: 2,
      paragraph: 1,
      text: "ALPHA COMPANY versus THE STATE",
    }),
    row({
      id: "first-paragraph",
      page: 2,
      paragraph: 2,
      number: "1",
      text: "1. This appeal concerns a question of law.",
    }),
    row({
      id: "scr-header",
      page: 3,
      paragraph: 1,
      number: "2026",
      text: "102 [2026] 7 S.C.R. SUPREME COURT REPORTS",
    }),
    row({
      id: "section-heading",
      page: 3,
      paragraph: 2,
      text: "QUESTIONS FOR DETERMINATION",
    }),
    row({
      id: "second-paragraph",
      page: 3,
      paragraph: 3,
      number: "2",
      text: "2. We have heard learned counsel for the parties.",
    }),
    row({
      id: "star-note",
      page: 3,
      paragraph: 4,
      text: "* Emphasis supplied.",
    }),
    row({
      id: "headnote-credit",
      page: 3,
      paragraph: 5,
      text: "†Headnotes prepared by the Editorial Office.",
    }),
    row({
      id: "editorial-result",
      page: 3,
      paragraph: 6,
      text: "Result of the case: Appeal allowed.",
    }),
  ])

  assert.deepEqual(
    copy.pages.map((page) => page.sourcePage),
    [2, 3]
  )
  assert.deepEqual(
    copy.pages.flatMap((page) => page.blocks.map((block) => block.text)),
    [
      "1. This appeal concerns a question of law.",
      "QUESTIONS FOR DETERMINATION",
      "2. We have heard learned counsel for the parties.",
      "* Emphasis supplied.",
    ]
  )
  assert.deepEqual(
    copy.pages[1].blocks.map((block) => block.kind),
    ["heading", "paragraph", "footnote"]
  )
  assert.equal(copy.chunkToBlockId["front-title"], undefined)
  assert.equal(copy.chunkToBlockId["scr-header"], undefined)
  assert.equal(copy.chunkToBlockId["headnote-credit"], undefined)
  assert.equal(copy.chunkToBlockId["editorial-result"], undefined)
})

test("keeps non-header front matter when no true paragraph 1 is present", () => {
  const copy = buildJudgmentReadingCopy("ISC-NO-ONE", [
    row({
      id: "order-heading",
      page: 8,
      paragraph: 1,
      text: "ORDER",
    }),
    row({
      id: "unnumbered-order",
      page: 8,
      paragraph: 2,
      text: "Leave is granted and the matter is disposed of.",
    }),
  ])

  assert.equal(copy.blockCount, 2)
  assert.equal(copy.pages[0].blocks[0].kind, "heading")
  assert.equal(copy.pages[0].blocks[1].kind, "paragraph")
})

test("returns a serializable empty copy", () => {
  const copy = buildJudgmentReadingCopy("ISC-EMPTY", [])
  assert.deepEqual(copy, {
    version: 1,
    pages: [],
    blockCount: 0,
    startPage: null,
    endPage: null,
    chunkToBlockId: {},
  })
  assert.equal(JSON.parse(JSON.stringify(copy)).version, 1)
})
