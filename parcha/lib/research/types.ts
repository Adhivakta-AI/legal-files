export type ResearchMode = "search" | "ai_pro"

export type SearchSortOrder = "relevance" | "recent"

export interface SemanticSearchFilters {
  year_from?: number
  year_to?: number
  sort: SearchSortOrder
  limit: number
}

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
  /** Standalone form used for retrieval when the user asks a follow-up. */
  resolved_query: string
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

export interface LegalSearchChunk {
  chunk_id: string
  document_id: string
  unit_id: string
  document_title: string
  short_title: string
  source_kind: "statute" | "constitution"
  unit_kind: "preamble" | "article" | "section" | "schedule_page"
  unit_number: string
  parent_label: string | null
  heading: string
  part_index: number
  chunk_text: string
  source_url: string
  canonical_url: string
  authority: string
  pdf_page_start: number | null
  pdf_page_end: number | null
  effective_from: string | null
  current_through: string | null
  commencement_note: string | null
  keyword_score: number | null
  semantic_score: number | null
  rrf_score: number
  direct_match: boolean
}

export interface JudgmentContext {
  judgment_id: string
  chunks: SearchChunk[]
  truncated: boolean
  included_characters: number
}

export interface Citation {
  source_id: string
  source_type: "judgment" | "legislation"
  judgment_id?: string
  document_id?: string
  unit_id?: string
  unit_kind?: LegalSearchChunk["unit_kind"]
  unit_number?: string
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
    legal_result_count?: number
    legal_unit_count?: number
  }
}

export interface ResearchThreadSummary {
  id: string
  title: string
  created_at: string
  updated_at: string
  message_count: number
}

export interface ResearchChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
  created_at: string
  result?: ResearchResult
}

export interface ResearchThread extends ResearchThreadSummary {
  messages: ResearchChatMessage[]
}

export interface ResearchConversationTurn {
  role: "user" | "assistant"
  content: string
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
      legal_count?: number
      legal_unit_count?: number
      legal_chunks?: LegalSearchChunk[]
    }
  | { type: "answer_delta"; delta: string }
  | {
      type: "result"
      result: ResearchResult
      thread?: ResearchThreadSummary
    }
  | {
      type: "error"
      stage?: PipelineStage
      message: string
      retryable: boolean
    }

export interface ResearchRequest {
  query: string
  mode: ResearchMode
  thread_id?: string
  limit?: number
  year_from?: number
  year_to?: number
  sort?: SearchSortOrder
}
