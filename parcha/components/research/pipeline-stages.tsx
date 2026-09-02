import { Check, X } from "lucide-react"

import type { StageStatus } from "@/lib/research/types"

import type { StageMap, StageMeta } from "./lib/stage-meta"
import styles from "./research.module.css"

function StatusIcon({ status }: { status: StageStatus }) {
  if (status === "complete") return <Check size={13} />
  if (status === "running") return <span className={styles.liveGlyph}>›</span>
  if (status === "error") return <X size={13} />
  return <span className={styles.queuedGlyph}>·</span>
}

export function PipelineStages({
  meta,
  stages,
}: {
  meta: StageMeta[]
  stages: StageMap
}) {
  return (
    <div className={styles.pipelineStages}>
      {meta.map((stage) => {
        const current = stages[stage.id]
        return (
          <div
            className={styles.pipelineStage}
            data-status={current.status}
            key={stage.id}
          >
            <span className={styles.stageIndex}>{stage.index}</span>
            <div>
              <span className={styles.stageLabel}>{stage.label}</span>
              <strong>{current.message}</strong>
              {current.detail ? <small>{current.detail}</small> : null}
            </div>
            <span className={styles.stageStatus}>
              <StatusIcon status={current.status} />
            </span>
            {current.elapsed_ms !== undefined ? (
              <time>{current.elapsed_ms}ms</time>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
