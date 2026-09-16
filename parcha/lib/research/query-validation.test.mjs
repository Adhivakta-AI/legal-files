import assert from "node:assert/strict"
import fs from "node:fs/promises"
import test from "node:test"
import swc from "next/dist/build/swc/index.js"

await swc.loadBindings()
const source = await fs.readFile(
  new URL("./query-validation.ts", import.meta.url),
  "utf8"
)
const transformed = await swc.transform(source, {
  filename: "query-validation.ts",
  jsc: { parser: { syntax: "typescript" } },
  module: { type: "es6" },
})
const validationModule = await import(
  `data:text/javascript;base64,${Buffer.from(transformed.code).toString("base64")}`
)
const {
  INVALID_QUERY_MESSAGE,
  QUERY_TOO_SHORT_MESSAGE,
  deterministicQueryError,
  queryGateError,
} = validationModule

test("accepts an incomplete but legally relevant factual scenario", () => {
  const query = "there is a forest behind I want to cut it"
  assert.equal(deterministicQueryError(query), null)
  assert.equal(queryGateError(query), null)
})

test("accepts the clarified forest-permission query", () => {
  assert.equal(
    queryGateError(
      "there is a forest behind I want to cut it, legal ways to do it"
    ),
    null
  )
})

test("keeps genuinely short and casual input out of the research pipeline", () => {
  assert.equal(queryGateError("forest"), QUERY_TOO_SHORT_MESSAGE)
  assert.equal(queryGateError("hello there"), INVALID_QUERY_MESSAGE)
})

test("allows a short referential follow-up when conversation supplies context", () => {
  assert.equal(queryGateError("why?", true), null)
  assert.equal(queryGateError("why?", false), QUERY_TOO_SHORT_MESSAGE)
})
