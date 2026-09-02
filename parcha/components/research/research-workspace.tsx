"use client"

import { useEffect } from "react"

import { AnswerPanel } from "./answer-panel"
import { HistorySidebar } from "./history-sidebar"
import { PdfModal } from "./pdf-modal"
import { PipelinePanel } from "./pipeline-panel"
import { QueryComposer } from "./query-composer"
import { ResearchHeader } from "./research-header"
import { type ResearchUser } from "./research-account-menu"
import styles from "./research.module.css"
import { useHistoryStore } from "./store/history-store"
import { useResearchStore } from "./store/research-store"

export function ResearchWorkspace({ user }: { user: ResearchUser }) {
  const hasSubmitted = useResearchStore((state) => state.hasSubmitted)
  const abort = useResearchStore((state) => state.abort)
  const hydrateHistory = useHistoryStore((state) => state.hydrate)

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
          {hasSubmitted ? <AnswerPanel /> : <QueryComposer />}
        </main>

        <PipelinePanel />
      </div>

      <PdfModal />
    </div>
  )
}
