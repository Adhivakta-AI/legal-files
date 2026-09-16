import assert from "node:assert/strict"
import test from "node:test"

import { scoreEvaluation } from "./metrics.mjs"

test("scores retrieval, grounding, safety, and transition metrics", () => {
  const cases = [
    {
      id: "transition-1",
      review_status: "lawyer_reviewed",
      dataset_version: "1.0.0",
      category: "code_transition",
      question: "Which code applies?",
      as_of_date: "2026-09-13",
      gold: {
        required_provision_ids: ["bns:106"],
        acceptable_additional_provision_ids: [],
        relevant_source_ids: ["bns:106:1", "judgment:1"],
        must_qualify: true,
      },
      review: {
        reviewer_id: "lawyer-1",
        reviewed_at: "2026-09-13T00:00:00.000Z",
      },
    },
    {
      id: "draft-ignored",
      review_status: "draft",
      category: "constitution",
      gold: {},
    },
  ]
  const runs = [
    {
      case_id: "transition-1",
      run_id: "fixture-run",
      predicted_provision_ids: ["bns:106"],
      retrieved_source_ids: ["bns:106:1", "unrelated"],
      review: {
        citations: [
          { source_id: "bns:106:1", verdict: "entailed" },
          { source_id: "judgment:1", verdict: "partial" },
        ],
        authorities: [
          { authority: "Known case", verdict: "verified" },
          { authority: "Invented case", verdict: "hallucinated" },
        ],
        temporal_applicability: "pass",
        insufficient_facts: "pass",
        code_transition: "fail",
      },
    },
  ]

  const report = scoreEvaluation(cases, runs)
  assert.equal(report.summary.lawyer_reviewed_case_count, 1)
  assert.equal(report.metrics.correct_section_accuracy.value, 1)
  assert.equal(report.metrics.retrieval_recall_at_20.value, 0.5)
  assert.equal(report.metrics.citation_precision.value, 1)
  assert.equal(report.metrics.citation_entailment.value, 0.5)
  assert.equal(report.metrics.temporal_applicability_accuracy.value, 1)
  assert.equal(report.metrics.hallucinated_authority_rate.value, 0.5)
  assert.equal(report.metrics.insufficient_facts_accuracy.value, 1)
  assert.equal(report.metrics.code_transition_accuracy.value, 0)
})

test("reports null rather than inventing a score without reviewed labels", () => {
  const report = scoreEvaluation(
    [{ id: "draft", review_status: "draft", category: "constitution" }],
    []
  )
  assert.equal(report.summary.scored_case_count, 0)
  assert.equal(report.metrics.correct_section_accuracy.value, null)
  assert.equal(report.metrics.citation_entailment.value, null)
})

test("rejects incomplete cases presented as lawyer reviewed", () => {
  assert.throws(
    () =>
      scoreEvaluation(
        [
          {
            id: "not-really-reviewed",
            review_status: "lawyer_reviewed",
            category: "constitution",
          },
        ],
        []
      ),
    /missing required gold metadata/
  )
})
