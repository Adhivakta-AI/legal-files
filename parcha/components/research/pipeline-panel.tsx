"use client"

import { Clock3 } from "lucide-react"

import { AnalysisPanel } from "./analysis-panel"
import { stageMetaFor } from "./lib/stage-meta"
import { PipelineStages } from "./pipeline-stages"
import styles from "./research.module.css"
import { SourcesPanel } from "./sources-panel"
import { useResearchStore } from "./store/research-store"

export function PipelinePanel() {
  const hasSubmitted = useResearchStore((state) => state.hasSubmitted)
  const stages = useResearchStore((state) => state.stages)
  const analysis = useResearchStore((state) => state.analysis)
  const sources = useResearchStore((state) => state.sources)
  const mode = useResearchStore((state) => state.mode)
  const resultMode = useResearchStore((state) => state.result?.mode)

  const displayMode = resultMode ?? mode
  const stageMeta = stageMetaFor(displayMode)
  const completeCount = stageMeta.filter(
    (meta) => stages[meta.id].status === "complete"
  ).length

  return (
    <aside className={styles.pipelinePanel} data-visible={hasSubmitted}>
      <div className={styles.pipelineHeader}>
        <div>
          <span className={styles.eyebrow}>QUERY PIPELINE</span>
          <strong>
            {displayMode === "search" ? "lex://search" : "lex://ai-pro"}
          </strong>
        </div>
        <span>
          {String(completeCount).padStart(2, "0")}/
          {String(stageMeta.length).padStart(2, "0")}
        </span>
      </div>

      <PipelineStages meta={stageMeta} stages={stages} />

      {analysis ? (
        <AnalysisPanel analysis={analysis} mode={displayMode} />
      ) : null}

      {sources.length ? (
        <SourcesPanel sources={sources} />
      ) : (
        <div className={styles.pipelineEmpty}>
          <Clock3 size={16} />
          <span>
            {hasSubmitted
              ? "Live stage output appears here."
              : "Submit a query to inspect every retrieval stage."}
          </span>
        </div>
      )}
    </aside>
  )
}
