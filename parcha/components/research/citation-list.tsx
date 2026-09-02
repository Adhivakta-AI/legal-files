"use client"

import type { Citation, ResearchMode } from "@/lib/research/types"

import { CitationCard } from "./citation-card"
import styles from "./research.module.css"
import { useResearchStore } from "./store/research-store"

export function CitationList({
  citations,
  mode,
  showRelevance,
}: {
  citations: Citation[]
  mode: ResearchMode
  showRelevance: boolean
}) {
  const expandedCitationId = useResearchStore(
    (state) => state.expandedCitationId
  )
  const toggleCitation = useResearchStore((state) => state.toggleCitation)
  const openPdf = useResearchStore((state) => state.openPdf)

  if (!citations.length) return null

  return (
    <div className={styles.citationsSection} data-mode={mode}>
      <div className={styles.citationsHeading}>
        <div>
          <span className={styles.eyebrow}>
            {mode === "search" ? "RANKED AUTHORITIES" : "SOURCE RECORD"}
          </span>
          <h3>{mode === "search" ? "Cases" : "Citations"}</h3>
        </div>
        <span>
          {citations.length} {mode === "search" ? "FOUND" : "VERIFIED"}
        </span>
      </div>
      <div className={styles.citationList}>
        {citations.map((citation, index) => (
          <CitationCard
            key={citation.judgment_id}
            citation={citation}
            index={index}
            mode={mode}
            showRelevance={showRelevance}
            expanded={expandedCitationId === citation.judgment_id}
            onToggle={() => toggleCitation(citation.judgment_id)}
            onOpen={() => openPdf(citation)}
          />
        ))}
      </div>
    </div>
  )
}
