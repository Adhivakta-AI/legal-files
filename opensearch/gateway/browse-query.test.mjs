import assert from "node:assert/strict";
import test from "node:test";

import { browseResponse, buildBrowseBody, normalizeBrowseRequest } from "./browse-query.mjs";

test("normalizes browse filters", () => {
  const input = normalizeBrowseRequest({
    q: "  anticipatory   bail ",
    year_from: 2000,
    judges: ["A. Judge", "A. Judge"],
    language: ["eng"],
    page: 2,
    page_size: 20,
    facets: true,
  });
  assert.equal(input.q, "anticipatory bail");
  assert.deepEqual(input.judges, ["A. Judge"]);
  assert.deepEqual(input.language, ["ENG"]);
  assert.equal(input.page, 2);
  assert.equal(input.facets, true);
});

test("builds full-text, filter, pagination, and facet query", () => {
  const body = buildBrowseBody(normalizeBrowseRequest({
    q: "specific performance limitation",
    year_from: 1990,
    year_to: 2020,
    disposal: ["Allowed"],
    page: 3,
    page_size: 20,
    facets: true,
  }));
  assert.equal(body.from, 40);
  assert.equal(body.size, 20);
  assert.equal(body.track_total_hits, true);
  assert.equal(body.query.bool.should.length, 7);
  assert.equal(body.query.bool.filter.length, 2);
  assert.deepEqual(Object.keys(body.aggs), [
    "disposal_nature", "era", "decision_year", "bench_size", "judges",
  ]);
});

test("converts OpenSearch hits and facets", () => {
  assert.deepEqual(browseResponse({
    hits: { total: { value: 2 }, hits: [{ _id: "J1", _score: 4.2 }, { _id: "J2", _score: null }] },
    aggregations: { era: { buckets: [{ key: "2010-2029", doc_count: 2 }] } },
  }), {
    results: [{ id: "J1", score: 4.2 }, { id: "J2", score: null }],
    total: 2,
    facets: { era: [{ value: "2010-2029", count: 2 }] },
  });
});
