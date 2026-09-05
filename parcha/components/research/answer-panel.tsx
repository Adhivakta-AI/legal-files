"use client"

import { ArrowRight } from "lucide-react"

import type { Citation } from "@/lib/research/types"

import { ResearchRunSkeleton } from "../loading/page-skeletons"
import { AnswerText } from "./answer-text"
import { CitationList } from "./citation-list"
import styles from "./research.module.css"
import { useHistoryStore } from "./store/history-store"
import { useResearchStore } from "./store/research-store"

export function AnswerPanel() {
  const query = useResearchStore((state) => state.query)
  const result = useResearchStore((state) => state.result)
  const streamedAnswer = useResearchStore((state) => state.streamedAnswer)
  const mode = useResearchStore((state) => state.mode)
  const analysis = useResearchStore((state) => state.analysis)
  const sources = useResearchStore((state) => state.sources)
  const error = useResearchStore((state) => state.error)
  const running = useResearchStore((state) => state.running)
  const reset = useResearchStore((state) => state.reset)
  const setExpandedCitation = useResearchStore(
    (state) => state.setExpandedCitation
  )
  const closeHistory = useHistoryStore((state) => state.setOpen)

  const citations = result?.citations ?? []
  const visibleAnswer = result?.answer ?? streamedAnswer
  const displayMode = result?.mode ?? mode
  const showRelevance = displayMode === "ai_pro"

  const startNew = () => {
    reset()
    closeHistory(false)
  }

  const focusCitation = (citation: Citation) => {
    setExpandedCitation(citation.judgment_id)
    window.requestAnimationFrame(() => {
      document
        .getElementById(`citation-${citation.judgment_id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" })
    })
  }

  return (
    <section className={styles.answerSection}>
      <div className={styles.answerHeader}>
        <div>
          {/* <span className={styles.eyebrow}>
            {displayMode === "search"
              ? "CLOUDFLARE SEARCH"
              : "GROUNDED RESPONSE"}
          </span> */}
          <h2>
            {query}
            {/* {displayMode === "search" */}
              {/* ? "Relevant cases" */}
              {/* : "Research memorandum"} */}
          </h2>
        </div>
        {result ? (
          <span
            className={styles.confidenceBadge}
            data-confidence={result.confidence}
          >
            {displayMode === "search"
              ? `${citations.length} CASE${citations.length === 1 ? "" : "S"}`
              : result.synthesis_status === "retrieval_only"
                ? "SOURCE REVIEW"
                : `${result.confidence.toUpperCase()} CONFIDENCE`}
          </span>
        ) : running ? (
          <span className={styles.streamingBadge}>
            <span /> {displayMode === "search" ? "SEARCHING" : "SYNTHESIZING"}
          </span>
        ) : null}
      </div>

      {error ? (
        <div className={styles.errorPanel}>
          <span>
            {analysis && !analysis.query_valid
              ? "QUERY REQUIRED"
              : "PIPELINE ERROR"}
          </span>
          <strong>
            {analysis && !analysis.query_valid
              ? "Enter a clear legal research question."
              : "The archive could not complete this request."}
          </strong>
          <p>{error}</p>
          <button type="button" onClick={startNew} disabled={running}>
            Start new research <ArrowRight size={14} />
          </button>
        </div>
      ) : displayMode === "ai_pro" && visibleAnswer ? (
        <AnswerText
          answer={visibleAnswer}
          citations={citations}
          streaming={running && !result}
          onCitation={focusCitation}
        />
      ) : running && !result ? (
        <ResearchRunSkeleton />
      ) : !result ? (
        <div className={styles.answerWaiting}>
          <span className={styles.streamCursor} />
          {displayMode === "search"
            ? "Searching Cloudflare D1 and Vectorize for relevant cases."
            : sources.length
              ? "Sources locked. Building a grounded answer."
              : "The analyzer is preparing a retrieval query."}
        </div>
      ) : null}

      {result?.statutes_referenced.length ? (
        <div className={styles.statutesRow}>
          <span>STATUTES REFERENCED</span>
          <div>
            {result.statutes_referenced.map((statute) => (
              <span key={statute}>{statute}</span>
            ))}
          </div>
        </div>
      ) : null}

      <CitationList
        citations={citations}
        mode={displayMode}
        showRelevance={showRelevance}
      />

      {result ? (
        <p className={styles.disclaimer}>
          {displayMode === "search"
            ? "Results are ranked from indexed passages. Review the linked judgment PDFs before relying on any proposition."
            : "Lex Archives provides research assistance, not legal advice. Verify propositions against the linked judgment PDFs."}
        </p>
      ) : null}
    </section>
  )
}
