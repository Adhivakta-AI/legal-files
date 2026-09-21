"use client"

import {
  ArrowLeft,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Download,
  FileText,
  Highlighter,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Sparkles,
  Sun,
} from "lucide-react"
import Link from "next/link"
import { useTheme } from "next-themes"
import { useMemo, useState } from "react"

import { LANGUAGE_LABELS, type JudgmentSummary } from "@/lib/browse/types"
import type { JudgmentReaderData } from "@/lib/judgment-reader-data"

import {
  JudgmentAiAnalysisView,
  type JudgmentAiView,
} from "./judgment-ai-analysis"
import { JudgmentReadingCopyView } from "./judgment-reading-copy"
import styles from "./reader.module.css"

function formatDate(value: string | null): string | null {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  })
}

function benchStrength(size: number | null): string | null {
  if (!size) return null
  if (size === 1) return "Single judge"
  if (size >= 5) return `Constitution Bench (${size})`
  return `Division Bench (${size})`
}

export function JudgmentReader({
  judgment,
  initialPdfPage,
  returnHref = "/browse",
  returnLabel = "RESULTS",
  highlightChunkId,
  readerData,
  pdfAccessToken,
  aiProMode = false,
}: {
  judgment: JudgmentSummary
  initialPdfPage?: number | null
  returnHref?: string
  returnLabel?: string
  highlightChunkId?: string | null
  readerData: JudgmentReaderData
  pdfAccessToken: string
  aiProMode?: boolean
}) {
  const [panelOpen, setPanelOpen] = useState(true)
  const readingCopySupportsCitation =
    !highlightChunkId ||
    Boolean(readerData.readingCopy?.chunkToBlockId[highlightChunkId])
  // The generated reading copy is the primary view; the preserved source PDF
  // stays one toggle away. The older HTML prototype only covers a couple of
  // judgments, so it is a fallback for when no generated PDF exists.
  const readingCopyAvailable =
    readerData.readingCopyPdf || Boolean(readerData.readingCopy)
  const [viewMode, setViewMode] = useState<"reading" | "original">(() =>
    readerData.readingCopyPdf ||
    (readerData.readingCopy && readingCopySupportsCitation)
      ? "reading"
      : "original"
  )
  const { resolvedTheme, setTheme } = useTheme()
  const dark = resolvedTheme !== "light"
  const [readerTab, setReaderTab] = useState<"document" | JudgmentAiView>(
    "document"
  )
  const [analysisRequested, setAnalysisRequested] = useState(false)

  const pdfPath = `/api/judgments/${encodeURIComponent(judgment.judgment_id)}/pdf?access=${encodeURIComponent(pdfAccessToken)}`
  const citedPage = readerData.citedPassage?.pdf_page
  const viewerPage = citedPage ?? initialPdfPage ?? 1
  const [selectedPdfPage, setSelectedPdfPage] = useState(viewerPage)
  const pdfSrc = useMemo(() => {
    if (!judgment.pdf_url) return ""
    return `${pdfPath}#page=${Math.max(1, selectedPdfPage)}&view=FitH&toolbar=1`
  }, [judgment.pdf_url, pdfPath, selectedPdfPage])
  const readingCopySrc = useMemo(() => {
    if (!readerData.readingCopyPdf) return ""
    return `${pdfPath}&variant=reading-copy#page=${Math.max(1, selectedPdfPage)}&view=FitH&toolbar=1`
  }, [readerData.readingCopyPdf, pdfPath, selectedPdfPage])

  const date = formatDate(judgment.decision_date)
  const strength = benchStrength(judgment.bench_size)

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <Link href={returnHref} className={styles.backLink}>
          <ArrowLeft size={13} /> {returnLabel}
        </Link>
        <button
          type="button"
          className={styles.panelToggle}
          onClick={() => setPanelOpen((value) => !value)}
          aria-label={panelOpen ? "Hide details" : "Show details"}
        >
          {panelOpen ? (
            <PanelLeftClose size={13} />
          ) : (
            <PanelLeftOpen size={13} />
          )}
          DETAILS
        </button>
        <span className={styles.toolbarTitle}>{judgment.title}</span>
        {aiProMode ? (
          <div className={styles.aiTabs} aria-label="AI Pro judgment tools">
            <button
              type="button"
              data-active={readerTab === "document" ? "true" : undefined}
              onClick={() => setReaderTab("document")}
            >
              <FileText size={13} /> JUDGMENT
            </button>
            <button
              type="button"
              data-active={readerTab === "summary" ? "true" : undefined}
              onClick={() => {
                setAnalysisRequested(true)
                setReaderTab("summary")
              }}
            >
              <Sparkles size={13} /> SUMMARY
            </button>
            <button
              type="button"
              data-active={readerTab === "timeline" ? "true" : undefined}
              onClick={() => {
                setAnalysisRequested(true)
                setReaderTab("timeline")
              }}
            >
              <CalendarDays size={13} /> DATES &amp; EVENTS
            </button>
          </div>
        ) : null}
        {readingCopyAvailable ? (
          <div className={styles.viewSwitch} aria-label="Document view">
            <button
              type="button"
              data-active={viewMode === "reading" ? "true" : undefined}
              onClick={() => setViewMode("reading")}
            >
              <BookOpen size={13} /> READING COPY
            </button>
            <button
              type="button"
              data-active={viewMode === "original" ? "true" : undefined}
              onClick={() => setViewMode("original")}
            >
              <FileText size={13} /> ORIGINAL SOURCE
            </button>
          </div>
        ) : null}
        {highlightChunkId ? (
          <span className={styles.citationContext} title={highlightChunkId}>
            CITED PASSAGE · {highlightChunkId.slice(-10).toUpperCase()}
          </span>
        ) : null}
        <div className={styles.toolbarActions}>
          <button
            type="button"
            className={styles.panelToggle}
            onClick={() => setTheme(dark ? "light" : "dark")}
            aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
            title={dark ? "Light mode" : "Dark mode"}
          >
            {dark ? <Sun size={13} /> : <Moon size={13} />}
            THEME
          </button>
          {judgment.pdf_url ? (
            <a href={pdfPath} target="_blank" rel="noopener noreferrer">
              <Download size={13} /> ORIGINAL PDF
            </a>
          ) : null}
        </div>
      </div>

      <div className={styles.body} data-panel={panelOpen ? "open" : "closed"}>
        <aside className={styles.panel}>
          <div className={styles.panelSection}>
            <div className={styles.panelLabel}>CASE</div>
            <div className={styles.caseName}>{judgment.title}</div>
            {(judgment.petitioner || judgment.respondent) && (
              <div className={styles.parties}>
                {judgment.petitioner ? (
                  <>
                    <span>PETITIONER</span>
                    {judgment.petitioner}
                  </>
                ) : null}
                {judgment.respondent ? (
                  <>
                    <span style={{ marginTop: "0.4rem" }}>RESPONDENT</span>
                    {judgment.respondent}
                  </>
                ) : null}
              </div>
            )}
          </div>

          <div className={styles.panelSection}>
            <div className={styles.panelLabel}>CITATIONS</div>
            <dl className={styles.metaGrid}>
              {judgment.citation ? (
                <div className={styles.metaRow}>
                  <dt>REPORTER</dt>
                  <dd>{judgment.citation}</dd>
                </div>
              ) : null}
              {judgment.neutral_citation ? (
                <div className={styles.metaRow}>
                  <dt>NEUTRAL</dt>
                  <dd>{judgment.neutral_citation}</dd>
                </div>
              ) : null}
              {judgment.cnr ? (
                <div className={styles.metaRow}>
                  <dt>CNR</dt>
                  <dd>{judgment.cnr}</dd>
                </div>
              ) : null}
              {judgment.case_number ? (
                <div className={styles.metaRow}>
                  <dt>CASE NUMBER</dt>
                  <dd>{judgment.case_number}</dd>
                </div>
              ) : null}
            </dl>
          </div>

          <div className={styles.panelSection}>
            <div className={styles.panelLabel}>DECISION</div>
            <dl className={styles.metaGrid}>
              <div className={styles.metaRow}>
                <dt>COURT</dt>
                <dd>{judgment.court}</dd>
              </div>
              {date ? (
                <div className={styles.metaRow}>
                  <dt>DATE</dt>
                  <dd>{date}</dd>
                </div>
              ) : null}
              {judgment.disposal_nature ? (
                <div className={styles.metaRow}>
                  <dt>DISPOSAL</dt>
                  <dd>{judgment.disposal_nature}</dd>
                </div>
              ) : null}
              {strength ? (
                <div className={styles.metaRow}>
                  <dt>BENCH</dt>
                  <dd>{strength}</dd>
                </div>
              ) : null}
            </dl>
          </div>

          {judgment.judges.length ? (
            <div className={styles.panelSection}>
              <div className={styles.panelLabel}>CORAM</div>
              <ul className={styles.coramList}>
                {judgment.judges.map((judge) => (
                  <li key={judge}>{judge}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {readerData.topics.length ? (
            <div className={styles.panelSection}>
              <div className={styles.panelHeadingRow}>
                <div className={styles.panelLabel}>SUBJECT MATTER</div>
                <span
                  className={styles.verifiedBadge}
                  title="Each topic is linked to a supporting source passage"
                >
                  <CheckCircle2 size={11} /> SOURCE VERIFIED
                </span>
              </div>
              <ul className={styles.topicList}>
                {readerData.topics.map((topic) => (
                  <li key={topic.topic}>{topic.topic}</li>
                ))}
              </ul>
              <p className={styles.provenanceNote}>
                {readerData.topics.every(
                  (topic) => topic.provenance === "headnote"
                )
                  ? "Derived from the published headnote."
                  : "Derived from passages in the judgment text."}{" "}
                These are source-linked legal topics, not generated case facts.
              </p>
            </div>
          ) : null}

          {readerData.citedPassage ? (
            <div className={styles.panelSection}>
              <div className={styles.panelHeadingRow}>
                <div className={styles.panelLabel}>AI PRO EVIDENCE</div>
                <span className={styles.pageBadge}>
                  PAGE {readerData.citedPassage.pdf_page}
                </span>
              </div>
              <div className={styles.evidenceExcerpt}>
                <Highlighter size={14} />
                <p>{readerData.citedPassage.text}</p>
              </div>
              <p className={styles.provenanceNote}>
                Indexed from {readerData.citedPassage.text_source} · paragraph{" "}
                {readerData.citedPassage.paragraph_number ?? "unlabelled"}
              </p>
            </div>
          ) : null}

          {judgment.available_languages.length ? (
            <div className={styles.panelSection}>
              <div className={styles.panelLabel}>LANGUAGES</div>
              <div className={styles.tagRow}>
                {judgment.available_languages.map((code) => (
                  <span className={styles.tag} key={code}>
                    {LANGUAGE_LABELS[code] ?? code}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </aside>

        <div className={styles.viewer}>
          {readerTab === "document" ? (
            viewMode === "reading" && readingCopySrc ? (
              <iframe
                src={readingCopySrc}
                title={`${judgment.title} — Vidhi Kosh reading copy`}
              />
            ) : viewMode === "reading" && readerData.readingCopy ? (
              <JudgmentReadingCopyView
                judgment={judgment}
                readingCopy={readerData.readingCopy}
                citedChunkId={highlightChunkId}
                initialPage={selectedPdfPage}
              />
            ) : pdfSrc ? (
              <iframe
                src={pdfSrc}
                title={`${judgment.title} — original judgment PDF`}
              />
            ) : (
              <div className={styles.viewerFallback}>
                No PDF is available for this judgment.
              </div>
            )
          ) : null}
          {aiProMode && analysisRequested ? (
            <JudgmentAiAnalysisView
              judgmentId={judgment.judgment_id}
              activeView={readerTab === "document" ? null : readerTab}
              onOpenSource={(page) => {
                setSelectedPdfPage(page)
                setViewMode("original")
                setReaderTab("document")
              }}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}
