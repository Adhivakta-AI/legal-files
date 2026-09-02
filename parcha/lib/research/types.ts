export type ResearchMode = "search" | "ai_pro"

export type SynthesisStatus = "not_requested" | "grounded" | "retrieval_only"

export type LegalIntent =
  "case_law_lookup" | "statute_lookup" | "doctrine_explanation" | "drafting"

export type PipelineStage =
  "spelling" | "acronyms" | "context" | "retrieval" | "generation"

export type StageStatus = "queued" | "running" | "complete" | "error"

export interface QueryCorrection {
  from: string
  to: string
  reason: string
}

export interface AcronymExpansion {
  acronym: string
  expansion: string
}

export interface QueryAnalysis {
  original_query: string
  corrected_query: string
  enriched_query: string
  query_valid: boolean
  retrieval_order: "relevance" | "recent"
  case_name_query: string | null
  corrections: QueryCorrection[]
  acronym_expansions: AcronymExpansion[]
  intent: LegalIntent
  legal_context: string[]
  statutes: string[]
  confidence: "high" | "medium" | "low"
  analyzer: "gemini" | "rules"
}

export interface SearchChunk {
  judgment_id: string
  chunk_id: string
  title: string
  citation: string | null
  decision_date: string | null
  judge: string | null
  chunk_text: string
  pdf_url: string
  pdf_page: number
  paragraph_number: string | null
  text_source: string
  keyword_score: number | null
  semantic_score: number | null
  rrf_score: number
  title_match_score?: number
}

export interface JudgmentContext {
  judgment_id: string
  chunks: SearchChunk[]
  truncated: boolean
  included_characters: number
}

export interface Citation {
  judgment_id: string
  case_name: string
  citation: string
  court: string
  paragraph_number?: string
  pdf_url: string
  pdf_page: number
  relevance_note: string
  chunk_id?: string
  excerpt?: string
}

export interface ResearchAnswer {
  answer: string
  citations: Citation[]
  statutes_referenced: string[]
  confidence: "high" | "medium" | "low"
  synthesis_status: SynthesisStatus
}

export interface ResearchResult extends ResearchAnswer {
  mode: ResearchMode
  synthesis_status: SynthesisStatus
  analysis: QueryAnalysis
  retrieval: {
    query: string
    result_count: number
    judgment_count: number
    latency_ms: number
    widened: boolean
  }
}

export type ResearchStreamEvent =
  | {
      type: "stage"
      stage: PipelineStage
      status: StageStatus
      message: string
      detail?: string
      elapsed_ms?: number
    }
  | { type: "analysis"; analysis: QueryAnalysis }
  | {
      type: "sources"
      count: number
      judgment_count: number
      chunks: SearchChunk[]
    }
  | { type: "answer_delta"; delta: string }
  | { type: "result"; result: ResearchResult }
  | {
      type: "error"
      stage?: PipelineStage
      message: string
      retryable: boolean
    }

export interface ResearchRequest {
  query: string
  mode: ResearchMode
  year_from?: number
  year_to?: number
}
