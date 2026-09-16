const PASS = "pass"
const CASE_CATEGORIES = new Set([
  "constitution",
  "statute",
  "case_law",
  "insufficient_facts",
  "code_transition",
])

function assertReviewedInputs(cases, runs) {
  const caseIds = new Set()
  cases.forEach((item, index) => {
    if (typeof item?.id !== "string" || !item.id.trim()) {
      throw new Error(`Evaluation case ${index + 1} has no stable id`)
    }
    if (caseIds.has(item.id)) {
      throw new Error(`Duplicate evaluation case id: ${item.id}`)
    }
    caseIds.add(item.id)
    if (
      item.review_status !== "draft" &&
      item.review_status !== "lawyer_reviewed"
    ) {
      throw new Error(`Case ${item.id} has an invalid review_status`)
    }
    if (item.review_status !== "lawyer_reviewed") return
    if (
      typeof item.dataset_version !== "string" ||
      typeof item.question !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(item.as_of_date ?? "") ||
      !CASE_CATEGORIES.has(item.category) ||
      typeof item.gold !== "object" ||
      item.gold === null ||
      !Array.isArray(item.gold.required_provision_ids) ||
      !Array.isArray(item.gold.acceptable_additional_provision_ids) ||
      !Array.isArray(item.gold.relevant_source_ids) ||
      typeof item.gold.must_qualify !== "boolean" ||
      typeof item.review?.reviewer_id !== "string" ||
      typeof item.review?.reviewed_at !== "string"
    ) {
      throw new Error(
        `Lawyer-reviewed case ${item.id} is missing required gold metadata`
      )
    }
  })

  const runCaseIds = new Set()
  runs.forEach((run, index) => {
    if (typeof run?.case_id !== "string" || !run.case_id.trim()) {
      throw new Error(`Evaluation run ${index + 1} has no case_id`)
    }
    if (runCaseIds.has(run.case_id)) {
      throw new Error(`Duplicate run for evaluation case: ${run.case_id}`)
    }
    runCaseIds.add(run.case_id)
    if (
      typeof run.run_id !== "string" ||
      !Array.isArray(run.predicted_provision_ids) ||
      !Array.isArray(run.retrieved_source_ids) ||
      typeof run.review !== "object" ||
      run.review === null
    ) {
      throw new Error(`Run ${run.case_id} is missing required result metadata`)
    }
  })
}

function strings(value) {
  return Array.isArray(value)
    ? [...new Set(value.filter((item) => typeof item === "string"))]
    : []
}

function rounded(value) {
  return Math.round(value * 10_000) / 10_000
}

function ratio(numerator, denominator) {
  return {
    value: denominator ? rounded(numerator / denominator) : null,
    numerator,
    denominator,
  }
}

function average(values) {
  return {
    value: values.length
      ? rounded(values.reduce((sum, value) => sum + value, 0) / values.length)
      : null,
    case_count: values.length,
  }
}

function correctSection(gold, run) {
  const required = strings(gold?.required_provision_ids)
  if (!required.length) return null
  const acceptable = new Set([
    ...required,
    ...strings(gold?.acceptable_additional_provision_ids),
  ])
  const predicted = strings(run?.predicted_provision_ids)
  return (
    required.every((id) => predicted.includes(id)) &&
    predicted.every((id) => acceptable.has(id))
  )
}

function reviewResult(value) {
  return value === "pass" || value === "fail" ? value : null
}

export function scoreEvaluation(cases, runs) {
  if (!Array.isArray(cases) || !Array.isArray(runs)) {
    throw new TypeError("Evaluation cases and runs must both be arrays")
  }
  assertReviewedInputs(cases, runs)

  const reviewedCases = cases.filter(
    (item) => item?.review_status === "lawyer_reviewed"
  )
  const runByCase = new Map(runs.map((run) => [run?.case_id, run]))
  const sectionScores = []
  const recallScores = []
  const temporalScores = []
  const insufficientScores = []
  const transitionScores = []
  let relevantCitations = 0
  let entailedCitations = 0
  let labeledCitations = 0
  let hallucinatedAuthorities = 0
  let labeledAuthorities = 0
  let answersWithHallucination = 0
  let answersWithAuthorityLabels = 0
  const perCase = []

  reviewedCases.forEach((evaluationCase) => {
    const run = runByCase.get(evaluationCase.id)
    if (!run) {
      perCase.push({ case_id: evaluationCase.id, status: "missing_run" })
      return
    }

    const section = correctSection(evaluationCase.gold, run)
    if (section !== null) sectionScores.push(section ? 1 : 0)

    const relevantSources = strings(evaluationCase.gold?.relevant_source_ids)
    const top20 = new Set(strings(run.retrieved_source_ids).slice(0, 20))
    const recall = relevantSources.length
      ? relevantSources.filter((id) => top20.has(id)).length /
        relevantSources.length
      : null
    if (recall !== null) recallScores.push(recall)

    const citationLabels = Array.isArray(run.review?.citations)
      ? run.review.citations
      : []
    citationLabels.forEach((citation) => {
      if (
        citation?.verdict !== "entailed" &&
        citation?.verdict !== "partial" &&
        citation?.verdict !== "irrelevant"
      ) {
        return
      }
      labeledCitations += 1
      if (citation.verdict !== "irrelevant") relevantCitations += 1
      if (citation.verdict === "entailed") entailedCitations += 1
    })

    const authorityLabels = Array.isArray(run.review?.authorities)
      ? run.review.authorities
      : []
    let caseHasHallucination = false
    authorityLabels.forEach((authority) => {
      if (
        authority?.verdict !== "verified" &&
        authority?.verdict !== "hallucinated"
      ) {
        return
      }
      labeledAuthorities += 1
      if (authority.verdict === "hallucinated") {
        hallucinatedAuthorities += 1
        caseHasHallucination = true
      }
    })
    if (authorityLabels.length) {
      answersWithAuthorityLabels += 1
      if (caseHasHallucination) answersWithHallucination += 1
    }

    const temporal = reviewResult(run.review?.temporal_applicability)
    if (temporal) temporalScores.push(temporal === PASS ? 1 : 0)

    const insufficient = reviewResult(run.review?.insufficient_facts)
    if (evaluationCase.gold?.must_qualify === true && insufficient) {
      insufficientScores.push(insufficient === PASS ? 1 : 0)
    }

    const transition = reviewResult(run.review?.code_transition)
    if (evaluationCase.category === "code_transition" && transition) {
      transitionScores.push(transition === PASS ? 1 : 0)
    }

    perCase.push({
      case_id: evaluationCase.id,
      status: "scored",
      correct_section: section,
      retrieval_recall_at_20: recall === null ? null : rounded(recall),
      citation_count_reviewed: citationLabels.length,
      authority_count_reviewed: authorityLabels.length,
      temporal_applicability: temporal,
      insufficient_facts: insufficient,
      code_transition: transition,
    })
  })

  const scoredCaseCount = perCase.filter(
    (item) => item.status === "scored"
  ).length
  return {
    summary: {
      dataset_case_count: cases.length,
      lawyer_reviewed_case_count: reviewedCases.length,
      submitted_run_count: runs.length,
      scored_case_count: scoredCaseCount,
      missing_run_count: reviewedCases.length - scoredCaseCount,
    },
    metrics: {
      correct_section_accuracy: ratio(
        sectionScores.reduce((sum, value) => sum + value, 0),
        sectionScores.length
      ),
      retrieval_recall_at_20: average(recallScores),
      citation_precision: ratio(relevantCitations, labeledCitations),
      citation_entailment: ratio(entailedCitations, labeledCitations),
      temporal_applicability_accuracy: ratio(
        temporalScores.reduce((sum, value) => sum + value, 0),
        temporalScores.length
      ),
      hallucinated_authority_rate: ratio(
        hallucinatedAuthorities,
        labeledAuthorities
      ),
      answers_with_hallucinated_authority_rate: ratio(
        answersWithHallucination,
        answersWithAuthorityLabels
      ),
      insufficient_facts_accuracy: ratio(
        insufficientScores.reduce((sum, value) => sum + value, 0),
        insufficientScores.length
      ),
      code_transition_accuracy: ratio(
        transitionScores.reduce((sum, value) => sum + value, 0),
        transitionScores.length
      ),
    },
    cases: perCase,
  }
}
