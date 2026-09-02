import { LibraryBig } from "lucide-react"

import type { SearchChunk } from "@/lib/research/types"

import { sourceToken } from "./lib/format"
import styles from "./research.module.css"

const VISIBLE_SOURCES = 5

export function SourcesPanel({ sources }: { sources: SearchChunk[] }) {
  return (
    <div className={styles.sourcesPanel}>
      <div className={styles.panelLabel}>
        <LibraryBig size={12} /> RETRIEVED PASSAGES
      </div>
      {sources.slice(0, VISIBLE_SOURCES).map((source) => (
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
      {sources.length > VISIBLE_SOURCES ? (
        <div className={styles.moreSources}>
          + {sources.length - VISIBLE_SOURCES} MORE PASSAGES
        </div>
      ) : null}
    </div>
  )
}
