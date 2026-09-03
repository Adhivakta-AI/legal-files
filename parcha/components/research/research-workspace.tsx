"use client"

import { useEffect } from "react"

import type { ResearchMode } from "@/lib/research/types"

import { AnswerPanel } from "./answer-panel"
import { HistorySidebar } from "./history-sidebar"
import { PipelinePanel } from "./pipeline-panel"
import { QueryComposer } from "./query-composer"
import { ResearchHeader } from "./research-header"
import { type ResearchUser } from "./research-account-menu"
import styles from "./research.module.css"
import { useHistoryStore } from "./store/history-store"
import { useResearchStore } from "./store/research-store"

export function ResearchWorkspace({
  user,
  mode,
}: {
  user: ResearchUser
  mode: ResearchMode
}) {
  const hasSubmitted = useResearchStore((state) => state.hasSubmitted)
  const abort = useResearchStore((state) => state.abort)
  const reset = useResearchStore((state) => state.reset)
  const setMode = useResearchStore((state) => state.setMode)
  const hydrateHistory = useHistoryStore((state) => state.hydrate)

  useEffect(() => {
    if (useResearchStore.getState().mode !== mode) {
      reset()
      setMode(mode)
    }
  }, [mode, reset, setMode])

  useEffect(() => {
    const timer = window.setTimeout(hydrateHistory, 0)
    return () => {
      window.clearTimeout(timer)
      abort()
    }
  }, [hydrateHistory, abort])

  return (
    <div className={styles.root}>
      <ResearchHeader user={user} />

      <div className={styles.shell}>
        <HistorySidebar />

        <main className={styles.main}>
          {hasSubmitted ? <AnswerPanel /> : <QueryComposer mode={mode} />}
        </main>

        <PipelinePanel />
      </div>
    </div>
  )
}
