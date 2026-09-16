export interface JudgmentAnalysisCitation {
  chunk_id: string
  pdf_page: number
  paragraph_number: string | null
  excerpt: string
}

export interface JudgmentAnalysisPoint {
  text: string
  citations: JudgmentAnalysisCitation[]
}

export interface JudgmentTimelineEvent {
  date: string
  event: string
  significance: string
  citations: JudgmentAnalysisCitation[]
}

export interface JudgmentAiAnalysis {
  judgment_id: string
  generated_at: string
  cached: boolean
  summary: {
    overview: JudgmentAnalysisPoint
    facts: JudgmentAnalysisPoint[]
    issues: JudgmentAnalysisPoint[]
    holding: JudgmentAnalysisPoint[]
    reasoning: JudgmentAnalysisPoint[]
    outcome: JudgmentAnalysisPoint
  }
  timeline: JudgmentTimelineEvent[]
  coverage: {
    source_chunks: number
    analysed_chunks: number
    source_pages: number
    analysed_pages: number
    complete: boolean
  }
}
