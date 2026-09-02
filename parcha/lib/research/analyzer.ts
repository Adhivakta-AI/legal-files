import "server-only"

import { generateJson } from "./gemini"
import { deterministicQueryError } from "./query-validation"
import type {
  AcronymExpansion,
  LegalIntent,
  QueryAnalysis,
  QueryCorrection,
  ResearchMode,
} from "./types"

const ACRONYMS: Array<[RegExp, string, string]> = [
  [
    /\bPOCSO\b/gi,
    "POCSO",
    "Protection of Children from Sexual Offences Act, 2012",
  ],
  [/\bCr\.?P\.?C\.?\b/gi, "CrPC", "Code of Criminal Procedure, 1973"],
  [/\bC\.?P\.?C\.?\b/gi, "CPC", "Code of Civil Procedure, 1908"],
  [/\bI\.?P\.?C\.?\b/gi, "IPC", "Indian Penal Code, 1860"],
  [/\bBNS\b/gi, "BNS", "Bharatiya Nyaya Sanhita, 2023"],
  [/\bBNSS\b/gi, "BNSS", "Bharatiya Nagarik Suraksha Sanhita, 2023"],
  [/\bBSA\b/gi, "BSA", "Bharatiya Sakshya Adhiniyam, 2023"],
  [
    /\bSLP\b/gi,
    "SLP",
    "Special Leave Petition under Article 136 of the Constitution",
  ],
  [/\bNI\s+Act\b/gi, "NI Act", "Negotiable Instruments Act, 1881"],
  [
    /\bNDPS\b/gi,
    "NDPS",
    "Narcotic Drugs and Psychotropic Substances Act, 1985",
  ],
  [/\bUAPA\b/gi, "UAPA", "Unlawful Activities (Prevention) Act, 1967"],
  [/\bPMLA\b/gi, "PMLA", "Prevention of Money Laundering Act, 2002"],
  [/\bIBC\b/gi, "IBC", "Insolvency and Bankruptcy Code, 2016"],
  [/\bRTI\b/gi, "RTI", "Right to Information Act, 2005"],
  [
    /\bSC\s*\/\s*ST\s+Act\b/gi,
    "SC/ST Act",
    "Scheduled Castes and Scheduled Tribes (Prevention of Atrocities) Act, 1989",
  ],
]

const SPELLING_RULES: Array<[RegExp, string, string]> = [
  [
    /\bposco\b/gi,
    "POCSO",
    "Common transposition of the statutory acronym POCSO",
  ],
  [/\bcrpc\b/gi, "CrPC", "Normalized Indian procedural-code acronym"],
  [/\bpetitoner\b/gi, "petitioner", "Legal-term spelling correction"],
  [/\bresponent\b/gi, "respondent", "Legal-term spelling correction"],
  [/\binjuction\b/gi, "injunction", "Legal-term spelling correction"],
]

interface ModelAnalysis {
  query_valid?: unknown
  corrected_query?: unknown
  retrieval_order?: unknown
  case_name_query?: unknown
  corrections?: unknown
  acronym_expansions?: unknown
  intent?: unknown
  legal_context?: unknown
  statutes?: unknown
  confidence?: unknown
}

interface ModelSpellingCorrection {
  corrected_query?: unknown
  corrections?: unknown
}

const SPELLING_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    query_valid: { type: "boolean" },
    corrected_query: { type: "string" },
    corrections: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          from: { type: "string" },
          to: { type: "string" },
          reason: { type: "string" },
        },
        required: ["from", "to", "reason"],
      },
    },
  },
  required: ["corrected_query", "corrections"],
}

const SPELLING_SYSTEM_PROMPT = `You are the spelling-correction layer for an Indian Supreme Court case-law search engine.

Correct only clear spelling errors and common legal-acronym transpositions. Preserve the query's meaning, word order, party names, citations, dates, sections, and legal terminology. Do not expand the query, add synonyms, infer doctrines, answer it, or rewrite it for style. If a correction is uncertain, leave the text unchanged.

Return the complete corrected query and list only corrections that actually changed text.`

const ANALYSIS_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    corrected_query: { type: "string" },
    retrieval_order: { type: "string", enum: ["relevance", "recent"] },
    case_name_query: { type: "string" },
    corrections: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          from: { type: "string" },
          to: { type: "string" },
          reason: { type: "string" },
        },
        required: ["from", "to", "reason"],
      },
    },
    acronym_expansions: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          acronym: { type: "string" },
          expansion: { type: "string" },
        },
        required: ["acronym", "expansion"],
      },
    },
    intent: {
      type: "string",
      enum: [
        "case_law_lookup",
        "statute_lookup",
        "doctrine_explanation",
        "drafting",
      ],
    },
    legal_context: { type: "array", maxItems: 8, items: { type: "string" } },
    statutes: { type: "array", maxItems: 8, items: { type: "string" } },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
  required: [
    "query_valid",
    "corrected_query",
    "retrieval_order",
    "case_name_query",
    "corrections",
    "acronym_expansions",
    "intent",
    "legal_context",
    "statutes",
    "confidence",
  ],
}

const ANALYZER_SYSTEM_PROMPT = `You are the query-analysis layer for Lex Archives, an Indian Supreme Court case-law retrieval system.

Your only job is to improve retrieval. Treat every request as an independent research query. Never answer the legal question and never invent facts, party names, statutes, sections, or cases.

First decide whether the input is a usable legal research query:
- Set query_valid to false for gibberish, random characters, casual conversation, insults, isolated adjectives, test messages, or any single-word input.
- Set query_valid to false when the input does not identify a legal issue, case, statute, section, remedy, doctrine, court procedure, or legally relevant factual situation.
- Set query_valid to true for short or imperfectly written queries when they still identify a meaningful legal research subject. For example, "anticipatory bail cases" and "injunction under CPC" are valid.
- Invalid examples include "asfkjdsnajk", "pretty", "dumb", "hello there", and "latest cases" without a legal topic.
- Be conservative about rejection: spelling and grammar errors alone never make a query invalid.
- When query_valid is false, preserve the input in corrected_query and do not invent legal context to make it valid.

Perform these operations conservatively:
1. Correct clear spelling/transposition errors in Indian legal terminology and well-known statute acronyms. Preserve party names unless the correction is highly certain.
2. Expand every Indian legal acronym that appears. Important examples include CPC, IPC, CrPC, SLP, POCSO, NI Act, NDPS, UAPA, PMLA, IBC, BNS, BNSS, and BSA.
3. Classify intent as case_law_lookup, statute_lookup, doctrine_explanation, or drafting.
4. Add short retrieval concepts: doctrines, remedies, constitutional articles, statutory sections, and procedural posture only when supported by the query.
5. Set retrieval_order to recent only when the user explicitly asks for latest, newest, recent, or current authorities. Otherwise use relevance.
6. If the user identifies a particular case by party names (for example, "A versus B", "A v. B", or "A vs B") or gives a reported citation, put only that case name/citation in case_name_query. Otherwise return an empty string. Do not invent or complete a case name.

Keep corrected_query natural and concise. Put expansions in acronym_expansions rather than stuffing prose into corrected_query. If uncertain, preserve the user's wording and lower confidence.`

function uniqueStrings(values: unknown, limit = 8): string[] {
  if (!Array.isArray(values)) return []
  return [
    ...new Set(
      values
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    ),
  ].slice(0, limit)
}

function validIntent(value: unknown): LegalIntent {
  const intents: LegalIntent[] = [
    "case_law_lookup",
    "statute_lookup",
    "doctrine_explanation",
    "drafting",
  ]
  if (typeof value === "string" && intents.includes(value as LegalIntent)) {
    return value as LegalIntent
  }
  return "case_law_lookup"
}

function deterministicAnalysis(query: string) {
  let correctedQuery = query
  const corrections: QueryCorrection[] = []

  for (const [pattern, replacement, reason] of SPELLING_RULES) {
    const match = correctedQuery.match(pattern)?.[0]
    if (!match) continue
    correctedQuery = correctedQuery.replace(pattern, replacement)
    corrections.push({ from: match, to: replacement, reason })
  }

  const acronymExpansions: AcronymExpansion[] = []
  for (const [pattern, acronym, expansion] of ACRONYMS) {
    pattern.lastIndex = 0
    if (pattern.test(correctedQuery))
      acronymExpansions.push({ acronym, expansion })
  }

  return {
    correctedQuery,
    corrections,
    acronymExpansions,
    intent: validIntent(undefined),
  }
}

function deterministicCaseName(query: string): string | null {
  if (!/\s(?:v\.?|vs\.?|versus)\s/i.test(` ${query} `)) return null
  return (
    query
      .replace(
        /^(?:find|show|search for|tell me about|what (?:was|is) (?:held|decided) in|give me)\s+/i,
        ""
      )
      .trim()
      .slice(0, 240) || null
  )
}

function correctionsFrom(value: unknown): QueryCorrection[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(
      (item): item is QueryCorrection =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as QueryCorrection).from === "string" &&
        typeof (item as QueryCorrection).to === "string" &&
        typeof (item as QueryCorrection).reason === "string"
    )
    .slice(0, 8)
}

function expansionsFrom(value: unknown): AcronymExpansion[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(
      (item): item is AcronymExpansion =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as AcronymExpansion).acronym === "string" &&
        typeof (item as AcronymExpansion).expansion === "string"
    )
    .slice(0, 10)
}

function uniqueBy<T>(values: T[], key: (value: T) => string): T[] {
  const unique = new Map<string, T>()
  values.forEach((value) => {
    const id = key(value).toLowerCase()
    if (!unique.has(id)) unique.set(id, value)
  })
  return [...unique.values()]
}

function enrichedQuery(
  correctedQuery: string,
  expansions: AcronymExpansion[],
  context: string[]
): string {
  const parts = [
    correctedQuery,
    expansions.length
      ? `Statutory expansions: ${expansions.map((item) => item.expansion).join("; ")}`
      : "",
    context.length ? `Legal concepts: ${context.join("; ")}` : "",
  ].filter(Boolean)
  return parts.join(". ").slice(0, 500)
}

export async function analyzeQuery(
  query: string,
  mode: ResearchMode,
  signal?: AbortSignal
): Promise<QueryAnalysis> {
  const rules = deterministicAnalysis(query)
  const deterministicError = deterministicQueryError(query)
  const rulesOrder = /\b(latest|newest|recent|current|most recent)\b/i.test(
    query
  )
    ? "recent"
    : "relevance"

  if (deterministicError) {
    return {
      original_query: query,
      corrected_query: query,
      enriched_query: query,
      query_valid: false,
      retrieval_order: rulesOrder,
      case_name_query: null,
      corrections: [],
      acronym_expansions: [],
      intent: "case_law_lookup",
      legal_context: [],
      statutes: [],
      confidence: "low",
      analyzer: "rules",
    }
  }

  try {
    const modelResult = await generateJson<ModelAnalysis>({
      systemInstruction: ANALYZER_SYSTEM_PROMPT,
      prompt: JSON.stringify({
        current_query: query,
        requested_mode: mode,
      }),
      schema: ANALYSIS_SCHEMA,
      signal,
    })
    const correctedQuery =
      typeof modelResult.corrected_query === "string" &&
      modelResult.corrected_query.trim()
        ? modelResult.corrected_query.trim().slice(0, 500)
        : rules.correctedQuery
    const corrections = uniqueBy(
      [...rules.corrections, ...correctionsFrom(modelResult.corrections)],
      (item) => `${item.from}:${item.to}`
    )
    const expansions = uniqueBy(
      [
        ...rules.acronymExpansions,
        ...expansionsFrom(modelResult.acronym_expansions),
      ],
      (item) => item.acronym
    )
    const context = uniqueStrings(modelResult.legal_context)
    const statutes = uniqueStrings(modelResult.statutes)
    const retrievalOrder =
      modelResult.retrieval_order === "recent" ? "recent" : rulesOrder
    const caseNameQuery =
      typeof modelResult.case_name_query === "string" &&
      modelResult.case_name_query.trim()
        ? modelResult.case_name_query.trim().slice(0, 240)
        : deterministicCaseName(correctedQuery)

    return {
      original_query: query,
      corrected_query: correctedQuery,
      enriched_query: enrichedQuery(correctedQuery, expansions, context),
      query_valid: modelResult.query_valid === true,
      retrieval_order: retrievalOrder,
      case_name_query: caseNameQuery,
      corrections,
      acronym_expansions: expansions,
      intent: validIntent(modelResult.intent),
      legal_context: context,
      statutes,
      confidence:
        modelResult.confidence === "high" ||
        modelResult.confidence === "medium" ||
        modelResult.confidence === "low"
          ? modelResult.confidence
          : "medium",
      analyzer: "gemini",
    }
  } catch {
    const context: string[] = []
    const correctedQuery = rules.correctedQuery
    return {
      original_query: query,
      corrected_query: correctedQuery,
      enriched_query: enrichedQuery(
        correctedQuery,
        rules.acronymExpansions,
        context
      ),
      query_valid: true,
      retrieval_order: rulesOrder,
      case_name_query: deterministicCaseName(correctedQuery),
      corrections: rules.corrections,
      acronym_expansions: rules.acronymExpansions,
      intent: rules.intent,
      legal_context: context,
      statutes: rules.acronymExpansions.map((item) => item.expansion),
      confidence:
        rules.corrections.length || rules.acronymExpansions.length
          ? "high"
          : "low",
      analyzer: "rules",
    }
  }
}

export async function analyzeSearchQuery(
  query: string,
  signal?: AbortSignal
): Promise<QueryAnalysis> {
  const rules = deterministicAnalysis(query)

  try {
    const modelResult = await generateJson<ModelSpellingCorrection>({
      systemInstruction: SPELLING_SYSTEM_PROMPT,
      prompt: query,
      schema: SPELLING_SCHEMA,
      signal,
    })
    const correctedQuery =
      typeof modelResult.corrected_query === "string" &&
      modelResult.corrected_query.trim()
        ? modelResult.corrected_query.trim().replace(/\s+/g, " ").slice(0, 500)
        : rules.correctedQuery
    const corrections = uniqueBy(
      [...rules.corrections, ...correctionsFrom(modelResult.corrections)],
      (item) => `${item.from}:${item.to}`
    )

    return {
      original_query: query,
      corrected_query: correctedQuery,
      enriched_query: correctedQuery,
      query_valid: true,
      retrieval_order: "relevance",
      case_name_query: deterministicCaseName(correctedQuery),
      corrections,
      acronym_expansions: [],
      intent: "case_law_lookup",
      legal_context: [],
      statutes: [],
      confidence: corrections.length ? "high" : "medium",
      analyzer: "gemini",
    }
  } catch {
    return {
      original_query: query,
      corrected_query: rules.correctedQuery,
      enriched_query: rules.correctedQuery,
      query_valid: true,
      retrieval_order: "relevance",
      case_name_query: deterministicCaseName(rules.correctedQuery),
      corrections: rules.corrections,
      acronym_expansions: [],
      intent: "case_law_lookup",
      legal_context: [],
      statutes: [],
      confidence: rules.corrections.length ? "high" : "low",
      analyzer: "rules",
    }
  }
}
