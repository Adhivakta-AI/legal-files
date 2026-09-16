# AI Pro legal evaluation

This directory contains the versioned, lawyer-reviewed evaluation contract for
AI Pro. The seed cases are intentionally marked `draft`; they are not gold
labels and are excluded from scoring until a lawyer completes the `gold` fields
and changes `review_status` to `lawyer_reviewed`.

## Evaluation workflow

1. A lawyer reviews a draft case, fixes its wording, records the applicable
   date, fills the gold provisions and relevant source IDs, and records whether
   the answer must qualify for insufficient facts.
2. Freeze the reviewed JSONL as a dataset version. Do not edit a frozen version;
   create a new version and preserve the old baseline.
3. Run AI Pro against every case and save retrieval order, predicted provisions,
   cited sources, latency, model version, prompt version, corpus version, and
   index version in a run JSONL.
4. A lawyer labels each citation as `entailed`, `partial`, or `irrelevant`; each
   named authority as `verified` or `hallucinated`; and temporal, insufficient-
   facts, and transition behavior as `pass`, `fail`, or `not_applicable`.
5. Score only `lawyer_reviewed` cases:

   ```bash
   npm run eval:score -- evaluation/cases.v1.jsonl evaluation/run.v1.jsonl
   ```

## Required case shape

```json
{
  "id": "stable-case-id",
  "review_status": "lawyer_reviewed",
  "dataset_version": "1.0.0",
  "category": "constitution | statute | case_law | insufficient_facts | code_transition",
  "question": "The user question",
  "as_of_date": "YYYY-MM-DD",
  "tags": ["controlled", "labels"],
  "gold": {
    "required_provision_ids": ["canonical provision IDs that must appear"],
    "acceptable_additional_provision_ids": ["allowed but optional IDs"],
    "relevant_source_ids": ["chunk IDs relevant for Recall@20"],
    "must_qualify": true,
    "expected_regime": "lawyer-authored temporal rule"
  },
  "review": {
    "reviewer_id": "internal stable ID",
    "reviewed_at": "ISO-8601 timestamp",
    "notes": "Why these labels are correct"
  }
}
```

`relevant_source_ids` must be pooled relevance judgments, not merely the sources
returned by the current system. Otherwise Recall@20 will reward the current
retriever for reproducing its own omissions.

## Required run shape

```json
{
  "case_id": "stable-case-id",
  "run_id": "model-prompt-corpus identifier",
  "predicted_provision_ids": [],
  "retrieved_source_ids": [],
  "cited_source_ids": [],
  "latency_ms": 0,
  "versions": {
    "model": "provider model ID",
    "prompt": "git SHA or prompt version",
    "corpus": "corpus version",
    "index": "index version"
  },
  "review": {
    "citations": [
      { "source_id": "chunk ID", "verdict": "entailed | partial | irrelevant" }
    ],
    "authorities": [
      { "authority": "case/statute as written", "verdict": "verified | hallucinated" }
    ],
    "temporal_applicability": "pass | fail | not_applicable",
    "insufficient_facts": "pass | fail | not_applicable",
    "code_transition": "pass | fail | not_applicable"
  }
}
```

Every reported metric includes its denominator. A `null` value means the
reviewed set does not yet contain enough labels for that metric; it is never
silently treated as zero or success.
