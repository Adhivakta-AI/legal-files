import assert from "node:assert/strict"
import fs from "node:fs/promises"
import test from "node:test"
import swc from "next/dist/build/swc/index.js"

await swc.loadBindings()
const source = await fs.readFile(
  new URL("./grounding-validation.ts", import.meta.url),
  "utf8"
)
const transformed = await swc.transform(source, {
  filename: "grounding-validation.ts",
  jsc: { parser: { syntax: "typescript" } },
  module: { type: "es6" },
})
const validationModule = await import(
  `data:text/javascript;base64,${Buffer.from(transformed.code).toString("base64")}`
)
const {
  composeGroundedDraft,
  inlineSourceIds,
  substantiveClaimSegments,
  validateGroundedDraft,
} = validationModule

const sources = {
  judgmentSources: [
    { judgment_id: "judgment-1", chunk_id: "judgment-1:chunk-1" },
  ],
  legalSources: [{ chunk_id: "bns:section-106:part-1" }],
}

test("accepts sentence-level legal and judgment grounding", () => {
  const answer =
    "BNS section 106 addresses causing death by negligence [[bns:section-106:part-1]]. The retrieved judgment discusses the required causal connection [[judgment-1:chunk-1]]."
  assert.equal(
    validateGroundedDraft({
      answer,
      ...sources,
    }),
    null
  )
})

test("accepts one or more citations for a substantive legal paragraph", () => {
  const answer =
    "BNS section 106 addresses causing death by negligence [[bns:section-106:part-1]]. A conviction therefore requires proof of every statutory ingredient beyond reasonable doubt."
  assert.equal(
    validateGroundedDraft({
      answer,
      ...sources,
    }),
    null
  )
})

test("requires a citation in every substantive legal paragraph", () => {
  const answer =
    "BNS section 106 addresses causing death by negligence [[bns:section-106:part-1]].\n\nA conviction requires proof of every statutory ingredient beyond reasonable doubt."
  assert.match(
    validateGroundedDraft({
      answer,
      ...sources,
    }),
    /paragraph or bullet lacked/
  )
})

test("requires a citation in every substantive bullet", () => {
  const answer =
    "- BNS section 106 addresses causing death by negligence [[bns:section-106:part-1]].\n- A conviction requires proof of every statutory ingredient beyond reasonable doubt."
  assert.match(
    validateGroundedDraft({
      answer,
      ...sources,
    }),
    /paragraph or bullet lacked/
  )
})

test("rejects an inline source outside the retrieved allow-list", () => {
  assert.match(
    validateGroundedDraft({
      answer:
        "BNS section 106 addresses causing death by negligence [[unknown:chunk-1]].",
      ...sources,
    }),
    /outside the retrieved allow-list/
  )
})

test("allows headings and explicit insufficiency statements without citations", () => {
  const answer =
    "## Likely provision\n\nBNS section 106 addresses causing death by negligence [[bns:section-106:part-1]].\n\nThe retrieved sources are insufficient to establish the suspect's intent."
  assert.equal(substantiveClaimSegments(answer).length, 1)
  assert.deepEqual(inlineSourceIds(answer), ["bns:section-106:part-1"])
})

test("does not let a heading hide an uncited sentence in the same block", () => {
  const answer =
    "## Application\nA conviction requires proof of every statutory ingredient beyond reasonable doubt."
  assert.deepEqual(substantiveClaimSegments(answer), [
    "A conviction requires proof of every statutory ingredient beyond reasonable doubt.",
  ])
})

test("composes verified citations from structured answer sections", () => {
  const composed = composeGroundedDraft(
    [
      {
        heading: "Governing provision",
        body: "Article 21 protects life and personal liberty.",
        source_ids: ["bns:section-106:part-1"],
      },
      {
        heading: "Judicial approach",
        body: "The retrieved judgment discusses the required causal connection.",
        source_ids: ["judgment-1:chunk-1"],
      },
    ],
    new Set(["bns:section-106:part-1", "judgment-1:chunk-1"])
  )
  assert.ok(composed)
  assert.deepEqual(composed.sourceIds, [
    "bns:section-106:part-1",
    "judgment-1:chunk-1",
  ])
  assert.equal(
    validateGroundedDraft({ answer: composed.answer, ...sources }),
    null
  )
})

test("drops sections without an allow-listed supporting source", () => {
  const composed = composeGroundedDraft(
    [
      {
        heading: "Unsupported",
        body: "This paragraph cites an invented source.",
        source_ids: ["invented-source"],
      },
      {
        heading: "Supported",
        body: "Article 21 protects life and personal liberty.",
        source_ids: ["bns:section-106:part-1"],
      },
    ],
    new Set(["bns:section-106:part-1"])
  )
  assert.ok(composed)
  assert.equal(composed.droppedSectionCount, 1)
  assert.doesNotMatch(composed.answer, /invented source/)
  assert.match(composed.answer, /\[\[bns:section-106:part-1\]\]/)
})
