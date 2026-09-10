import assert from "node:assert/strict";
import test from "node:test";

import { buildSearchBody, normalizeSearchRequest } from "./search-query.mjs";

test("normalizes a bounded legal query", () => {
  assert.deepEqual(
    normalizeSearchRequest({ query: "  section   138 cheque  ", limit: 20, year_from: 2000 }),
    { query: "section 138 cheque", limit: 20, yearFrom: 2000, yearTo: null },
  );
});

test("rejects an inverted year range", () => {
  assert.throws(
    () => normalizeSearchRequest({ query: "anticipatory bail", year_from: 2020, year_to: 2010 }),
    /year_from must be less than or equal to year_to/,
  );
});

test("builds phrase, exact, recall, and stemmed clauses", () => {
  const body = buildSearchBody({
    query: "specific performance limitation",
    limit: 80,
    yearFrom: 1990,
    yearTo: 2020,
  });
  assert.equal(body.size, 80);
  assert.deepEqual(body.collapse, { field: "judgment_id" });
  assert.equal(body.query.bool.should.length, 5);
  assert.deepEqual(body.query.bool.filter, [
    { range: { decision_year: { gte: 1990, lte: 2020 } } },
  ]);
});
