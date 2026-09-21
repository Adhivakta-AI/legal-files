import assert from "node:assert/strict"
import test from "node:test"
import {
  alignBlockTypography,
  enrichBlocksWithTypography,
  parsePopplerXml,
} from "./poppler-layout.mjs"

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<pdf2xml>
  <page number="1" width="612" height="792">
    <fontspec id="0" size="11" family="ABCDEF+TimesNewRoman,Italic"/>
    <fontspec id="1" size="11" family="ABCDEF+TimesNewRoman,Bold"/>
    <text top="620" left="157" width="300" height="10" font="0"><i>Headnote pending active</i></text>
  </page>
  <page number="2" width="612" height="792">
    <text top="149" left="143" width="300" height="10" font="0"><i>consideration before Parliament.</i></text>
    <text top="286" left="171" width="150" height="10" font="0"><i>Example v. State</i></text>
    <text top="286" left="321" width="120" height="10" font="1"><b>(2020) 1 SCC 1 – relied on.</b></text>
    <text top="500" left="143" width="300" height="10" font="1"><b>1. Judgment begins.</b></text>
  </page>
</pdf2xml>`

test("extracts subset-font typography and aligns it to chunk text", () => {
  const pdf = parsePopplerXml(xml)
  const aligned = alignBlockTypography(
    { text: "Headnote pending active" },
    pdf.pages.get(1)
  )

  assert.equal(aligned.coverage, 1)
  assert.equal(aligned.dominantStyle, "italic")
  assert.equal(aligned.stylePurity, 1)
  assert.deepEqual(aligned.styleRuns, [
    { start: 0, end: 23, style: "italic" },
  ])
})

test("classifies cross-page headnote continuations and mixed authorities", () => {
  const pdf = parsePopplerXml(xml)
  const source = {
    metadata: { title: "HEADNOTE CASE versus STATE" },
    blocks: [
      {
        label: "Unnumbered passage",
        sourcePage: 1,
        sourceChunkIds: ["case:p0001:para0001:part01"],
        text: "Headnote pending active",
      },
      {
        label: "Unnumbered passage",
        sourcePage: 2,
        sourceChunkIds: ["case:p0002:para0001:part01"],
        text: "consideration before Parliament.",
      },
      {
        label: "Unnumbered passage",
        sourcePage: 2,
        sourceChunkIds: ["case:p0002:para0002:part01"],
        text: "Example v. State (2020) 1 SCC 1 – relied on.",
      },
      {
        label: "Paragraph 1",
        sourcePage: 2,
        sourceChunkIds: ["case:p0002:para0003:part01"],
        text: "1. Judgment begins.",
      },
    ],
  }

  const blocks = enrichBlocksWithTypography(source, pdf)
  assert.deepEqual(
    blocks.map((block) => block.role),
    ["headnote", "headnote", "authority_list", "judgment_paragraph"]
  )
  assert.equal(blocks[2].typography.styleCounts.italic, 3)
  assert.equal(blocks[2].typography.styleCounts.bold, 6)
})
