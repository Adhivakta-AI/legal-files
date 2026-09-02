import {
  ArrowRight,
  ChevronDown,
  FileText,
  Search,
  ShieldCheck,
} from "lucide-react"

import type { Citation, ResearchMode } from "@/lib/research/types"

import { sourceToken } from "./lib/format"
import styles from "./research.module.css"

export function CitationCard({
  citation,
  index,
  mode,
  showRelevance,
  expanded,
  onToggle,
  onOpen,
}: {
  citation: Citation
  index: number
  mode: ResearchMode
  showRelevance: boolean
  expanded: boolean
  onToggle: () => void
  onOpen: () => void
}) {
  return (
    <article
      id={`citation-${citation.judgment_id}`}
      className={styles.citationCard}
      data-open={expanded}
    >
      <button
        type="button"
        className={styles.citationSummary}
        onClick={onToggle}
      >
        <span className={styles.citationNumber}>
          {String(index + 1).padStart(2, "0")}
        </span>
        <span className={styles.citationTitleBlock}>
          <strong>{citation.case_name}</strong>
          <span className={styles.citationMeta}>
            {citation.citation} · {citation.court}
          </span>
          {citation.excerpt ? (
            <span className={styles.citationExcerptPreview}>
              {citation.excerpt}
            </span>
          ) : null}
        </span>
        <span className={styles.verifiedBadge}>
          {mode === "search" ? <Search size={12} /> : <ShieldCheck size={12} />}
          {mode === "search" ? "RELEVANT MATCH" : "VERIFIED CITATION"}
        </span>
        <ChevronDown size={16} className={styles.citationChevron} />
      </button>
      {expanded ? (
        <div className={styles.citationDetails}>
          <div className={styles.citationCoordinates}>
            <span>JUDGMENT {sourceToken(citation.judgment_id)}</span>
            {citation.chunk_id ? (
              <span>CHUNK {sourceToken(citation.chunk_id)}</span>
            ) : null}
            <span>PARA {citation.paragraph_number ?? "—"}</span>
            <span>PDF PAGE {citation.pdf_page}</span>
          </div>
          {citation.excerpt ? (
            <div className={styles.retrievedPassage}>
              <span>RETRIEVED PASSAGE</span>
              <blockquote>{citation.excerpt}</blockquote>
            </div>
          ) : null}
          {showRelevance ? (
            <div className={styles.relevanceReason}>
              <span>WHY THIS CASE MATTERS</span>
              <p>{citation.relevance_note}</p>
            </div>
          ) : null}
          <button
            type="button"
            className={styles.openPdfButton}
            onClick={onOpen}
          >
            <FileText size={15} /> Open source PDF <ArrowRight size={15} />
          </button>
        </div>
      ) : null}
    </article>
  )
}
