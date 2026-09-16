"use client"

import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  FileSearch,
  LoaderCircle,
  RotateCcw,
  Sparkles,
} from "lucide-react"
import { useEffect, useState } from "react"

import type {
  JudgmentAiAnalysis,
  JudgmentAnalysisCitation,
  JudgmentAnalysisPoint,
} from "@/lib/judgment-analysis-types"

import styles from "./judgment-ai-analysis.module.css"

export type JudgmentAiView = "summary" | "timeline"

function SourceButtons({
  citations,
  onOpenSource,
}: {
  citations: JudgmentAnalysisCitation[]
  onOpenSource: (page: number) => void
}) {
  const pages = [...new Set(citations.map((citation) => citation.pdf_page))]
  return (
    <div className={styles.sources}>
      {pages.map((page) => (
        <button key={page} type="button" onClick={() => onOpenSource(page)}>
          <FileSearch size={12} /> PAGE {page}
        </button>
      ))}
    </div>
  )
}

function Point({
  point,
  onOpenSource,
}: {
  point: JudgmentAnalysisPoint
  onOpenSource: (page: number) => void
}) {
  return (
    <li className={styles.point}>
      <p>{point.text}</p>
      <SourceButtons citations={point.citations} onOpenSource={onOpenSource} />
    </li>
  )
}

function Section({
  title,
  points,
  onOpenSource,
}: {
  title: string
  points: JudgmentAnalysisPoint[]
  onOpenSource: (page: number) => void
}) {
  if (!points.length) return null
  return (
    <section className={styles.section}>
      <h2>{title}</h2>
      <ul className={styles.pointList}>
        {points.map((point, index) => (
          <Point
            key={`${title}-${index}`}
            point={point}
            onOpenSource={onOpenSource}
          />
        ))}
      </ul>
    </section>
  )
}

export function JudgmentAiAnalysisView({
  judgmentId,
  activeView,
  onOpenSource,
}: {
  judgmentId: string
  activeView: JudgmentAiView | null
  onOpenSource: (page: number) => void
}) {
  const [analysis, setAnalysis] = useState<JudgmentAiAnalysis | null>(null)
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [error, setError] = useState("")
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    void fetch(`/api/judgments/${encodeURIComponent(judgmentId)}/analysis`, {
      method: "POST",
      headers: { accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          analysis?: JudgmentAiAnalysis
          error?: string
        }
        if (!response.ok || !payload.analysis) {
          throw new Error(
            payload.error || "The analysis could not be prepared."
          )
        }
        if (!active) return
        setAnalysis(payload.analysis)
        setStatus("ready")
      })
      .catch((reason: unknown) => {
        if (!active || controller.signal.aborted) return
        setError(
          reason instanceof Error
            ? reason.message
            : "The analysis could not be prepared."
        )
        setStatus("error")
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [attempt, judgmentId])

  if (!activeView) return null

  if (status === "loading") {
    return (
      <div className={styles.state}>
        <LoaderCircle className={styles.spinner} size={26} />
        <strong>AI Pro is reading the judgment</strong>
        <p>
          Building a source-linked summary and chronology from the indexed
          judgment text. The first analysis can take a little while.
        </p>
      </div>
    )
  }

  if (status === "error" || !analysis) {
    return (
      <div className={styles.state}>
        <AlertTriangle size={25} />
        <strong>Analysis unavailable</strong>
        <p>{error || "The analysis could not be prepared."}</p>
        <button
          type="button"
          className={styles.retry}
          onClick={() => {
            setError("")
            setStatus("loading")
            setAttempt((value) => value + 1)
          }}
        >
          <RotateCcw size={13} /> RETRY
        </button>
      </div>
    )
  }

  const generated = new Date(analysis.generated_at)
  const generatedLabel = Number.isNaN(generated.getTime())
    ? analysis.generated_at
    : generated.toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className={styles.eyebrow}>
          {activeView === "summary" ? (
            <Sparkles size={13} />
          ) : (
            <CalendarDays size={13} />
          )}
          AI PRO · SOURCE-GROUNDED
        </div>
        <h1>
          {activeView === "summary" ? "Judgment summary" : "Dates and events"}
        </h1>
        <div className={styles.coverage}>
          <span>
            <CheckCircle2 size={12} /> {analysis.coverage.analysed_chunks}{" "}
            source passages across {analysis.coverage.analysed_pages} PDF pages
          </span>
          <span>
            {analysis.cached ? "CACHED" : "NEW"} · {generatedLabel}
          </span>
        </div>
        {!analysis.coverage.complete ? (
          <p className={styles.coverageWarning}>
            This unusually long judgment exceeded the analysis context. The
            summary covers {analysis.coverage.analysed_chunks} of{" "}
            {analysis.coverage.source_chunks} indexed passages; verify omitted
            portions in the original PDF.
          </p>
        ) : null}
      </header>

      {activeView === "summary" ? (
        <main className={styles.content}>
          <section className={`${styles.section} ${styles.overview}`}>
            <h2>In brief</h2>
            <p>{analysis.summary.overview.text}</p>
            <SourceButtons
              citations={analysis.summary.overview.citations}
              onOpenSource={onOpenSource}
            />
          </section>
          <Section
            title="Material facts"
            points={analysis.summary.facts}
            onOpenSource={onOpenSource}
          />
          <Section
            title="Issues before the Court"
            points={analysis.summary.issues}
            onOpenSource={onOpenSource}
          />
          <Section
            title="Holding"
            points={analysis.summary.holding}
            onOpenSource={onOpenSource}
          />
          <Section
            title="Court's reasoning"
            points={analysis.summary.reasoning}
            onOpenSource={onOpenSource}
          />
          <section className={`${styles.section} ${styles.outcome}`}>
            <h2>Outcome</h2>
            <p>{analysis.summary.outcome.text}</p>
            <SourceButtons
              citations={analysis.summary.outcome.citations}
              onOpenSource={onOpenSource}
            />
          </section>
        </main>
      ) : (
        <main className={styles.content}>
          {analysis.timeline.length ? (
            <ol className={styles.timeline}>
              {analysis.timeline.map((item, index) => (
                <li key={`${item.date}-${index}`}>
                  <div className={styles.timelineMarker} />
                  <div className={styles.timelineCard}>
                    <time>{item.date}</time>
                    <h2>{item.event}</h2>
                    {item.significance ? <p>{item.significance}</p> : null}
                    <SourceButtons
                      citations={item.citations}
                      onOpenSource={onOpenSource}
                    />
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <div className={styles.emptyTimeline}>
              The indexed judgment did not contain enough explicit dated events
              to build a reliable chronology.
            </div>
          )}
        </main>
      )}

      <footer className={styles.footer}>
        AI-generated aid, not an editorial headnote. Open each page citation and
        verify important propositions against the original judgment.
      </footer>
    </div>
  )
}
