"use client"

import Link from "next/link"
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  Clock3,
  FileText,
  History,
  LibraryBig,
  Menu,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
} from "lucide-react"
import {
  FormEvent,
  Fragment,
  KeyboardEvent,
  ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import type {
  Citation,
  PipelineStage,
  QueryAnalysis,
  ResearchMode,
  ResearchResult,
  ResearchStreamEvent,
  SearchChunk,
  StageStatus,
} from "@/lib/research/types"

import { PdfViewer } from "./pdf-viewer"
import { ResearchAccountMenu, type ResearchUser } from "./research-account-menu"
import styles from "./research.module.css"

const HISTORY_KEY = "lex-archives:research-history:v1"

const EXAMPLES = [
  "POSCO act cases on consent and age determination",
  "When can a court grant a temporary injunction under CPC?",
  "Leading Supreme Court cases on unlawful eviction without notice",
]

const STAGE_META: Array<{
  id: PipelineStage
  index: string
  label: string
  idle: string
}> = [
  { id: "spelling", index: "01", label: "SPELLING", idle: "Awaiting query" },
  { id: "acronyms", index: "02", label: "ACRONYMS", idle: "Awaiting normalization" },
  { id: "context", index: "03", label: "LEGAL CONTEXT", idle: "Awaiting classification" },
  { id: "retrieval", index: "04", label: "RETRIEVAL", idle: "Index standing by" },
  { id: "generation", index: "05", label: "GENERATION", idle: "Source lock enabled" },
]

interface StageState {
  status: StageStatus
  message: string
  detail?: string
  elapsed_ms?: number
}

type StageMap = Record<PipelineStage, StageState>

interface HistoryItem {
  id: string
  query: string
  mode: ResearchMode
  created_at: string
  result: ResearchResult
}

function initialStages(): StageMap {
  return Object.fromEntries(
    STAGE_META.map((stage) => [stage.id, { status: "queued", message: stage.idle }])
  ) as StageMap
}

function safeHistory(value: string | null): HistoryItem[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? (parsed as HistoryItem[]).slice(0, 20) : []
  } catch {
    return []
  }
}

function statusIcon(status: StageStatus) {
  if (status === "complete") return <Check size={13} />
  if (status === "running") return <span className={styles.liveGlyph}>›</span>
  if (status === "error") return <X size={13} />
  return <span className={styles.queuedGlyph}>·</span>
}

function sourceToken(id: string): string {
  return id.length > 13 ? `${id.slice(0, 7)}…${id.slice(-4)}` : id
}

function AnswerText({
  answer,
  citations,
  streaming,
  onCitation,
}: {
  answer: string
  citations: Citation[]
  streaming: boolean
  onCitation: (citation: Citation) => void
}) {
  const citationMap = new Map(citations.map((citation, index) => [citation.judgment_id, { citation, index }]))

  const inline = (text: string): ReactNode[] =>
    text.split(/(\[\[[^\]]+\]\]|\*\*[^*]+\*\*)/g).map((part, index) => {
      const match = part.match(/^\[\[([^\]]+)\]\]$/)
      const strongMatch = part.match(/^\*\*([^*]+)\*\*$/)
      if (strongMatch) return <strong key={`${strongMatch[1]}-${index}`}>{strongMatch[1]}</strong>
      if (!match) return <Fragment key={`${part}-${index}`}>{part.replace(/^#{1,4}\s*/, "")}</Fragment>
      const item = citationMap.get(match[1])
      if (!item) {
        return (
          <span className={styles.pendingCitation} key={`${part}-${index}`}>
            SRC
          </span>
        )
      }
      return (
        <button
          type="button"
          className={styles.inlineCitation}
          onClick={() => onCitation(item.citation)}
          title={item.citation.case_name}
          key={`${part}-${index}`}
        >
          {item.index + 1}
        </button>
      )
    })

  const blocks = answer.split(/\n{2,}/).filter(Boolean)
  return (
    <div className={styles.answerProse} aria-live="polite">
      {blocks.map((block, index) => {
        const lines = block.split("\n").filter(Boolean)
        if (lines.length > 1 && lines.every((line) => /^[-*•]\s/.test(line.trim()))) {
          return (
            <ul key={index}>
              {lines.map((line, lineIndex) => (
                <li key={lineIndex}>{inline(line.replace(/^[-*•]\s*/, ""))}</li>
              ))}
            </ul>
          )
        }
        const heading = /^#{1,4}\s/.test(block)
        return heading ? (
          <h3 key={index}>{inline(block)}</h3>
        ) : (
          <p key={index}>{inline(block)}</p>
        )
      })}
      {streaming ? <span className={styles.streamCursor} aria-label="Streaming" /> : null}
    </div>
  )
}

function CitationCard({
  citation,
  index,
  expanded,
  onToggle,
  onOpen,
}: {
  citation: Citation
  index: number
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
      <button type="button" className={styles.citationSummary} onClick={onToggle}>
        <span className={styles.citationNumber}>{String(index + 1).padStart(2, "0")}</span>
        <span className={styles.citationTitleBlock}>
          <strong>{citation.case_name}</strong>
          <span className={styles.citationMeta}>
            {citation.citation} · {citation.court}
          </span>
          {citation.excerpt ? (
            <span className={styles.citationExcerptPreview}>{citation.excerpt}</span>
          ) : null}
        </span>
        <span className={styles.verifiedBadge}>
          <ShieldCheck size={12} /> VERIFIED CITATION
        </span>
        <ChevronDown size={16} className={styles.citationChevron} />
      </button>
      {expanded ? (
        <div className={styles.citationDetails}>
          <div className={styles.citationCoordinates}>
            <span>JUDGMENT {sourceToken(citation.judgment_id)}</span>
            {citation.chunk_id ? <span>CHUNK {sourceToken(citation.chunk_id)}</span> : null}
            <span>PARA {citation.paragraph_number ?? "—"}</span>
            <span>PDF PAGE {citation.pdf_page}</span>
          </div>
          {citation.excerpt ? (
            <div className={styles.retrievedPassage}>
              <span>RETRIEVED PASSAGE</span>
              <blockquote>{citation.excerpt}</blockquote>
            </div>
          ) : null}
          <div className={styles.relevanceReason}>
            <span>WHY THIS CASE MATTERS</span>
            <p>{citation.relevance_note}</p>
          </div>
          <button type="button" className={styles.openPdfButton} onClick={onOpen}>
            <FileText size={15} /> Open source PDF <ArrowRight size={15} />
          </button>
        </div>
      ) : null}
    </article>
  )
}

export function ResearchWorkspace({ user }: { user: ResearchUser }) {
  const [query, setQuery] = useState("")
  const [mode, setMode] = useState<ResearchMode>("research")
  const [stages, setStages] = useState<StageMap>(initialStages)
  const [analysis, setAnalysis] = useState<QueryAnalysis | null>(null)
  const [sources, setSources] = useState<SearchChunk[]>([])
  const [streamedAnswer, setStreamedAnswer] = useState("")
  const [result, setResult] = useState<ResearchResult | null>(null)
  const [error, setError] = useState("")
  const [running, setRunning] = useState(false)
  const [hasSubmitted, setHasSubmitted] = useState(false)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [pdfCitation, setPdfCitation] = useState<Citation | null>(null)
  const [expandedCitationId, setExpandedCitationId] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const loadHistory = window.setTimeout(
      () => setHistory(safeHistory(window.localStorage.getItem(HISTORY_KEY))),
      0
    )
    return () => {
      window.clearTimeout(loadHistory)
      abortRef.current?.abort()
    }
  }, [])

  const citations = result?.citations ?? []
  const visibleAnswer = result?.answer ?? streamedAnswer

  const completeCount = useMemo(
    () => Object.values(stages).filter((stage) => stage.status === "complete").length,
    [stages]
  )

  const clearWorkspace = () => {
    abortRef.current?.abort()
    setQuery("")
    setStages(initialStages())
    setAnalysis(null)
    setSources([])
    setStreamedAnswer("")
    setResult(null)
    setError("")
    setRunning(false)
    setHasSubmitted(false)
    setHistoryOpen(false)
    setExpandedCitationId(null)
  }

  const persistResult = (nextResult: ResearchResult, submittedQuery: string, submittedMode: ResearchMode) => {
    const item: HistoryItem = {
      id: crypto.randomUUID(),
      query: submittedQuery,
      mode: submittedMode,
      created_at: new Date().toISOString(),
      result: nextResult,
    }
    setHistory((current) => {
      const next = [item, ...current.filter((entry) => entry.query !== submittedQuery)].slice(0, 20)
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
      return next
    })
  }

  const handleEvent = (
    event: ResearchStreamEvent,
    submittedQuery: string,
    submittedMode: ResearchMode
  ) => {
    if (event.type === "stage") {
      setStages((current) => ({
        ...current,
        [event.stage]: {
          status: event.status,
          message: event.message,
          detail: event.detail,
          elapsed_ms: event.elapsed_ms,
        },
      }))
      return
    }
    if (event.type === "analysis") {
      setAnalysis(event.analysis)
      return
    }
    if (event.type === "sources") {
      setSources(event.chunks)
      return
    }
    if (event.type === "answer_delta") {
      setStreamedAnswer((current) => current + event.delta)
      return
    }
    if (event.type === "result") {
      setResult(event.result)
      setStreamedAnswer(event.result.answer)
      setQuery("")
      persistResult(event.result, submittedQuery, submittedMode)
      return
    }
    if (event.type === "error") setError(event.message)
  }

  const submit = async (event?: FormEvent) => {
    event?.preventDefault()
    const submittedQuery = query.trim()
    if (submittedQuery.length < 3 || running) return
    const conversation = result
      ? {
          previous_query: result.analysis.original_query,
          previous_resolved_query: result.analysis.corrected_query,
          previous_legal_context: result.analysis.legal_context,
          previous_citations: result.citations.slice(0, 8).map((citation) => ({
            judgment_id: citation.judgment_id,
            case_name: citation.case_name,
            citation: citation.citation,
          })),
        }
      : undefined

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setRunning(true)
    setHasSubmitted(true)
    setStages(initialStages())
    setAnalysis(null)
    setSources([])
    setStreamedAnswer("")
    setResult(null)
    setError("")

    try {
      const response = await fetch("/api/research", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: submittedQuery, mode, conversation }),
        signal: controller.signal,
      })
      if (!response.ok || !response.body) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(payload.error ?? `Research request failed (${response.status})`)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      while (true) {
        const { value, done } = await reader.read()
        buffer += decoder.decode(value, { stream: !done })
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""
        lines.filter(Boolean).forEach((line) => {
          handleEvent(JSON.parse(line) as ResearchStreamEvent, submittedQuery, mode)
        })
        if (done) break
      }
      if (buffer.trim()) {
        handleEvent(JSON.parse(buffer) as ResearchStreamEvent, submittedQuery, mode)
      }
    } catch (caught) {
      if ((caught as Error).name !== "AbortError") {
        setError(caught instanceof Error ? caught.message : "The research request failed")
      }
    } finally {
      if (abortRef.current === controller) setRunning(false)
    }
  }

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault()
      void submit()
    }
  }

  const restoreHistory = (item: HistoryItem) => {
    abortRef.current?.abort()
    setQuery("")
    setMode(item.mode)
    setResult(item.result)
    setAnalysis(item.result.analysis)
    setStreamedAnswer(item.result.answer)
    setSources([])
    setError("")
    setRunning(false)
    setHasSubmitted(true)
    setExpandedCitationId(null)
    setStages(
      Object.fromEntries(
        STAGE_META.map((stage) => [
          stage.id,
          { status: "complete", message: "Restored from research history" },
        ])
      ) as StageMap
    )
    setHistoryOpen(false)
  }

  const focusCitation = (citation: Citation) => {
    setExpandedCitationId(citation.judgment_id)
    window.requestAnimationFrame(() => {
      document
        .getElementById(`citation-${citation.judgment_id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" })
    })
  }

  return (
    <div className={styles.root}>
      <header className={styles.appHeader}>
        <div className={styles.brand}>
          <Link href="/" aria-label="Lex Archives home" className={styles.brandMark}>
            LA
          </Link>
          <div>
            <strong>LEX ARCHIVES</strong>
            <span>INDIAN CASE-LAW INTELLIGENCE</span>
          </div>
        </div>
        <div className={styles.headerStatus}>
          <span className={styles.indexBadge}>INDEXED</span>
          <span className={styles.headerMetric}>2.48M PASSAGES</span>
          <span className={styles.headerMetric}>SUPREME COURT</span>
        </div>
        <ResearchAccountMenu user={user} />
        <button
          type="button"
          className={styles.mobileHistoryButton}
          onClick={() => setHistoryOpen(true)}
          aria-label="Open research history"
        >
          <Menu size={18} />
        </button>
      </header>

      <div className={styles.shell}>
        <aside className={styles.historySidebar} data-open={historyOpen}>
          <div className={styles.mobileSidebarHeader}>
            <span>RESEARCH HISTORY</span>
            <button type="button" onClick={() => setHistoryOpen(false)} aria-label="Close history">
              <X size={17} />
            </button>
          </div>
          <button type="button" className={styles.newResearchButton} onClick={clearWorkspace}>
            <Plus size={15} /> New research
          </button>
          <div className={styles.sidebarLabel}>
            <History size={12} /> RECENT QUERIES
          </div>
          <div className={styles.historyList}>
            {history.length ? (
              history.map((item) => (
                <button type="button" key={item.id} onClick={() => restoreHistory(item)}>
                  <Search size={13} />
                  <span>{item.query}</span>
                  <time>{new Date(item.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</time>
                </button>
              ))
            ) : (
              <div className={styles.historyEmpty}>
                Your completed research sessions will remain on this device.
              </div>
            )}
          </div>
          <div className={styles.sidebarFooter}>
            <div>
              <span className={styles.statusDot} /> SEARCH API ONLINE
            </div>
            <span>384D BGE · HYBRID RRF</span>
          </div>
        </aside>
        {historyOpen ? (
          <button
            type="button"
            className={styles.sidebarScrim}
            onClick={() => setHistoryOpen(false)}
            aria-label="Close history"
          />
        ) : null}

        <main className={styles.main}>
          <section className={styles.composerSection} data-compact={hasSubmitted}>
            {!hasSubmitted ? (
              <div className={styles.intro}>
                <span className={styles.eyebrow}>LEX / RESEARCH TERMINAL</span>
                <h1>What would you like to research?</h1>
                <p>
                  Ask about an issue, doctrine, statute, or judgment.
                </p>
              </div>
            ) : null}
            <form className={styles.composer} onSubmit={submit}>
              <textarea
                value={query}
                onChange={(event) => setQuery(event.target.value.slice(0, 3000))}
                onKeyDown={onComposerKeyDown}
                placeholder={
                  hasSubmitted
                    ? "Refine this research or ask a new legal question…"
                    : "Describe the legal issue, doctrine, statute, or factual pattern…"
                }
                aria-label="Legal research query"
                rows={hasSubmitted ? 3 : 6}
                disabled={running}
              />
              <div className={styles.composerToolbar}>
                <label className={styles.modeSelector}>
                  {mode === "research" ? <Zap size={15} /> : mode === "explain" ? <BookOpen size={15} /> : <FileText size={15} />}
                  <select value={mode} onChange={(event) => setMode(event.target.value as ResearchMode)} disabled={running}>
                    <option value="research">Research</option>
                    <option value="explain">Explain doctrine</option>
                    <option value="draft">Drafting support</option>
                  </select>
                  <ChevronDown size={14} />
                </label>
                <span className={styles.shortcut}>⌘ ENTER</span>
                <span className={styles.charCount}>{query.length}/3000</span>
                <button type="submit" className={styles.submitButton} disabled={query.trim().length < 3 || running}>
                  {running ? "Researching" : "Find authority"}
                  <ArrowRight size={17} />
                </button>
              </div>
            </form>
            {!hasSubmitted ? (
              <div className={styles.examples}>
                <span>TRY A QUERY</span>
                {EXAMPLES.map((example) => (
                  <button type="button" key={example} onClick={() => setQuery(example)}>
                    {example} <ArrowRight size={13} />
                  </button>
                ))}
              </div>
            ) : null}
          </section>

          {hasSubmitted ? (
            <section className={styles.answerSection}>
              <div className={styles.answerHeader}>
                <div>
                  <span className={styles.eyebrow}>GROUNDED RESPONSE</span>
                  <h2>Research memorandum</h2>
                </div>
                {result ? (
                  <span className={styles.confidenceBadge} data-confidence={result.confidence}>
                    {result.confidence.toUpperCase()} CONFIDENCE
                  </span>
                ) : running ? (
                  <span className={styles.streamingBadge}>
                    <span /> STREAMING
                  </span>
                ) : null}
              </div>

              {error ? (
                <div className={styles.errorPanel}>
                  <span>PIPELINE ERROR</span>
                  <strong>The archive could not complete this request.</strong>
                  <p>{error}</p>
                  <button type="button" onClick={() => void submit()} disabled={running}>
                    Retry query <ArrowRight size={14} />
                  </button>
                </div>
              ) : visibleAnswer ? (
                <AnswerText
                  answer={visibleAnswer}
                  citations={citations}
                  streaming={running && !result}
                  onCitation={focusCitation}
                />
              ) : (
                <div className={styles.answerWaiting}>
                  <span className={styles.streamCursor} />
                  {sources.length
                    ? "Sources locked. Awaiting the first grounded token."
                    : "The analyzer is preparing a retrieval query."}
                </div>
              )}

              {result?.statutes_referenced.length ? (
                <div className={styles.statutesRow}>
                  <span>STATUTES REFERENCED</span>
                  <div>
                    {result.statutes_referenced.map((statute) => (
                      <span key={statute}>{statute}</span>
                    ))}
                  </div>
                </div>
              ) : null}

              {citations.length ? (
                <div className={styles.citationsSection}>
                  <div className={styles.citationsHeading}>
                    <div>
                      <span className={styles.eyebrow}>SOURCE RECORD</span>
                      <h3>Citations</h3>
                    </div>
                    <span>{citations.length} VERIFIED</span>
                  </div>
                  <div className={styles.citationList}>
                    {citations.map((citation, index) => (
                      <CitationCard
                        key={citation.judgment_id}
                        citation={citation}
                        index={index}
                        expanded={expandedCitationId === citation.judgment_id}
                        onToggle={() =>
                          setExpandedCitationId((current) =>
                            current === citation.judgment_id ? null : citation.judgment_id
                          )
                        }
                        onOpen={() => setPdfCitation(citation)}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
              {result ? (
                <p className={styles.disclaimer}>
                  Lex Archives provides research assistance, not legal advice. Verify propositions against the linked judgment PDFs.
                </p>
              ) : null}
            </section>
          ) : null}
        </main>

        <aside className={styles.pipelinePanel} data-visible={hasSubmitted}>
          <div className={styles.pipelineHeader}>
            <div>
              <span className={styles.eyebrow}>QUERY PIPELINE</span>
              <strong>lex://analysis</strong>
            </div>
            <span>{String(completeCount).padStart(2, "0")}/05</span>
          </div>
          <div className={styles.pipelineStages}>
            {STAGE_META.map((meta) => {
              const current = stages[meta.id]
              return (
                <div className={styles.pipelineStage} data-status={current.status} key={meta.id}>
                  <span className={styles.stageIndex}>{meta.index}</span>
                  <div>
                    <span className={styles.stageLabel}>{meta.label}</span>
                    <strong>{current.message}</strong>
                    {current.detail ? <small>{current.detail}</small> : null}
                  </div>
                  <span className={styles.stageStatus}>{statusIcon(current.status)}</span>
                  {current.elapsed_ms !== undefined ? <time>{current.elapsed_ms}ms</time> : null}
                </div>
              )
            })}
          </div>

          {analysis ? (
            <div className={styles.analysisPanel}>
              <div className={styles.panelLabel}>
                <Sparkles size={12} /> NORMALIZED QUERY
              </div>
              <span className={styles.contextBadge} data-follow-up={analysis.relationship === "follow_up"}>
                {analysis.relationship === "follow_up"
                  ? "FOLLOW-UP · PRIOR ISSUE APPLIED"
                  : "NEW RESEARCH TOPIC"}
              </span>
              <p>{analysis.corrected_query}</p>
              {analysis.case_name_query ? (
                <div className={styles.titleLookup}>
                  <span>TITLE LOOKUP</span>
                  <strong>{analysis.case_name_query}</strong>
                </div>
              ) : null}
              {analysis.corrections.length ? (
                <div className={styles.analysisChips}>
                  {analysis.corrections.map((item) => (
                    <span key={`${item.from}-${item.to}`}>{item.from} → {item.to}</span>
                  ))}
                </div>
              ) : null}
              {analysis.acronym_expansions.map((item) => (
                <div className={styles.expansion} key={item.acronym}>
                  <span>{item.acronym}</span>
                  <p>{item.expansion}</p>
                </div>
              ))}
              <div className={styles.intentRow}>
                <span>INTENT</span>
                <strong>{analysis.intent.replaceAll("_", " ")}</strong>
              </div>
            </div>
          ) : null}

          {sources.length ? (
            <div className={styles.sourcesPanel}>
              <div className={styles.panelLabel}>
                <LibraryBig size={12} /> RETRIEVED PASSAGES
              </div>
              {sources.slice(0, 5).map((source) => (
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
              {sources.length > 5 ? <div className={styles.moreSources}>+ {sources.length - 5} MORE PASSAGES</div> : null}
            </div>
          ) : (
            <div className={styles.pipelineEmpty}>
              <Clock3 size={16} />
              <span>{hasSubmitted ? "Live stage output appears here." : "Submit a query to inspect every retrieval stage."}</span>
            </div>
          )}
        </aside>
      </div>

      {pdfCitation ? <PdfViewer citation={pdfCitation} onClose={() => setPdfCitation(null)} /> : null}
    </div>
  )
}
