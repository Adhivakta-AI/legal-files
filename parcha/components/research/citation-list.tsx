"use client"

import { ChevronLeft, ChevronRight } from "lucide-react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import type { Citation, ResearchMode } from "@/lib/research/types"

import { CitationCard } from "./citation-card"
import styles from "./research.module.css"
import { useResearchStore } from "./store/research-store"

const CITATIONS_PER_PAGE = 10

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
  const citationPage = useResearchStore((state) => state.citationPage)
  const toggleCitation = useResearchStore((state) => state.toggleCitation)
  const setCitationPage = useResearchStore((state) => state.setCitationPage)
  const router = useRouter()

  if (!citations.length) return null

  const pageCount = Math.max(
    1,
    Math.ceil(citations.length / CITATIONS_PER_PAGE)
  )
  const currentPage = Math.min(citationPage, pageCount)
  const start = (currentPage - 1) * CITATIONS_PER_PAGE
  const end = Math.min(start + CITATIONS_PER_PAGE, citations.length)
  const visibleCitations = citations.slice(start, end)

  const openSource = (citation: Citation) => {
    toast.message("Opening source PDF", {
      description: citation.case_name,
    })
    router.push(
      `/browse/${encodeURIComponent(citation.judgment_id)}?page=${Math.max(1, citation.pdf_page)}`
    )
  }

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
          {start + 1}-{end} OF {citations.length}{" "}
          {mode === "search" ? "FOUND" : "VERIFIED"}
        </span>
      </div>
      <div className={styles.citationList}>
        {visibleCitations.map((citation, index) => (
          <CitationCard
            key={citation.judgment_id}
            citation={citation}
            index={start + index}
            mode={mode}
            showRelevance={showRelevance}
            expanded={expandedCitationId === citation.judgment_id}
            onToggle={() => toggleCitation(citation.judgment_id)}
            onOpen={() => openSource(citation)}
          />
        ))}
      </div>
      {pageCount > 1 ? (
        <nav className={styles.citationPagination} aria-label="Citation pages">
          <button
            type="button"
            onClick={() => setCitationPage(currentPage - 1)}
            disabled={currentPage === 1}
          >
            <ChevronLeft size={14} /> Previous
          </button>
          <span>
            Page {currentPage} of {pageCount}
          </span>
          <button
            type="button"
            onClick={() => setCitationPage(currentPage + 1)}
            disabled={currentPage === pageCount}
          >
            Next <ChevronRight size={14} />
          </button>
        </nav>
      ) : null}
    </div>
  )
}
