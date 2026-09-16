import { LibraryBig } from "lucide-react"

import type { LegalSearchChunk, SearchChunk } from "@/lib/research/types"

import { sourceToken } from "./lib/format"
import styles from "./research.module.css"

const VISIBLE_SOURCES = 5

export function SourcesPanel({
  sources,
  legalSources,
}: {
  sources: SearchChunk[]
  legalSources: LegalSearchChunk[]
}) {
  const visibleLegal = legalSources.slice(0, 3)
  const visibleJudgments = sources.slice(
    0,
    Math.max(0, VISIBLE_SOURCES - visibleLegal.length)
  )
  const hidden =
    legalSources.length +
    sources.length -
    visibleLegal.length -
    visibleJudgments.length
  return (
    <div className={styles.sourcesPanel}>
      <div className={styles.panelLabel}>
        <LibraryBig size={12} /> RETRIEVED PASSAGES
      </div>
      {visibleLegal.map((source) => (
        <div className={styles.sourceRow} key={source.chunk_id}>
          <span>{sourceToken(source.chunk_id)}</span>
          <p>
            {source.short_title} {source.unit_kind.replaceAll("_", " ")}{" "}
            {source.unit_number}
          </p>
          <div>
            <span>
              {source.direct_match
                ? "EXACT PROVISION"
                : `LAW RRF ${source.rrf_score.toFixed(4)}`}
            </span>
            <span>P.{source.pdf_page_start ?? "—"}</span>
          </div>
        </div>
      ))}
      {visibleJudgments.map((source) => (
        <div className={styles.sourceRow} key={source.chunk_id}>
          <span>{sourceToken(source.judgment_id)}</span>
          <p>{source.title}</p>
          <div>
            <span>
              {source.title_match_score !== undefined
                ? `TITLE MATCH ${Math.round(source.title_match_score * 100)}%`
                : `RRF ${source.rrf_score.toFixed(4)}`}
            </span>
            <span>P.{source.pdf_page}</span>
          </div>
        </div>
      ))}
      {hidden > 0 ? (
        <div className={styles.moreSources}>+ {hidden} MORE PASSAGES</div>
      ) : null}
    </div>
  )
}
