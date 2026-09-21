"use client"

import {
  Check,
  ChevronDown,
  ChevronUp,
  Link2,
  Minus,
  Plus,
  Printer,
  Search,
  X,
} from "lucide-react"
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react"

import type { JudgmentSummary } from "@/lib/browse/types"
import type { JudgmentReadingCopy, ReadingCopyBlock } from "@/lib/reading-copy"

import styles from "./judgment-reading-copy.module.css"

const MIN_FONT_SIZE = 15
const MAX_FONT_SIZE = 22
const DEFAULT_FONT_SIZE = 18

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

function blockElementId(blockId: string): string {
  return `reading-copy-${blockId.replace(/[^A-Za-z0-9_-]/g, "-")}`
}

function reporterPage(
  citation: string | null,
  sourcePage: number
): number | null {
  if (!citation) return null
  const match = citation.match(/(\d+)\s*$/)
  if (!match) return null
  const firstReporterPage = Number.parseInt(match[1], 10)
  return Number.isFinite(firstReporterPage)
    ? firstReporterPage + sourcePage - 1
    : null
}

function highlightMatches(text: string, query: string): ReactNode {
  const needle = query.trim()
  if (!needle) return text

  const haystack = text.toLocaleLowerCase()
  const normalizedNeedle = needle.toLocaleLowerCase()
  const pieces: ReactNode[] = []
  let cursor = 0
  let match = haystack.indexOf(normalizedNeedle)

  while (match >= 0) {
    if (match > cursor) pieces.push(text.slice(cursor, match))
    pieces.push(
      <mark key={`${match}-${pieces.length}`} className={styles.searchMark}>
        {text.slice(match, match + needle.length)}
      </mark>
    )
    cursor = match + needle.length
    match = haystack.indexOf(normalizedNeedle, cursor)
  }

  if (cursor < text.length) pieces.push(text.slice(cursor))
  return pieces.length ? pieces : text
}

interface SearchResult {
  blockId: string
  page: number
}

export function JudgmentReadingCopyView({
  judgment,
  readingCopy,
  citedChunkId,
  initialPage,
}: {
  judgment: JudgmentSummary
  readingCopy: JudgmentReadingCopy
  citedChunkId?: string | null
  initialPage?: number | null
}) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState("")
  const [activeResult, setActiveResult] = useState(0)
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE)
  const [copiedBlockId, setCopiedBlockId] = useState<string | null>(null)

  const citedBlock = useMemo(() => {
    if (!citedChunkId) return null
    for (const page of readingCopy.pages) {
      const block = page.blocks.find((candidate) =>
        candidate.sourceChunkIds.includes(citedChunkId)
      )
      if (block) return block
    }
    return null
  }, [citedChunkId, readingCopy.pages])

  const results = useMemo<SearchResult[]>(() => {
    const needle = query.trim().toLocaleLowerCase()
    if (!needle) return []
    return readingCopy.pages.flatMap((page) =>
      page.blocks
        .filter((block) => block.text.toLocaleLowerCase().includes(needle))
        .map((block) => ({ blockId: block.id, page: page.sourcePage }))
    )
  }, [query, readingCopy.pages])

  function scrollToBlock(blockId: string) {
    document
      .getElementById(blockElementId(blockId))
      ?.scrollIntoView({ behavior: "smooth", block: "center" })
  }

  function scrollToPage(page: number) {
    document
      .getElementById(`reading-copy-page-${page}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  function moveSearch(direction: 1 | -1) {
    if (!results.length) return
    const next = (activeResult + direction + results.length) % results.length
    setActiveResult(next)
  }

  async function copyBlockLink(block: ReadingCopyBlock) {
    const url = new URL(window.location.href)
    url.searchParams.set("page", String(block.sourcePage))
    const sourceChunkId = block.sourceChunkIds[0]
    if (sourceChunkId) url.searchParams.set("chunk", sourceChunkId)
    await navigator.clipboard.writeText(url.toString())
    setCopiedBlockId(block.id)
    window.setTimeout(() => setCopiedBlockId(null), 1600)
  }

  useEffect(() => {
    const target = citedBlock?.id
    const timer = window.setTimeout(() => {
      if (target) scrollToBlock(target)
      else if (initialPage) scrollToPage(initialPage)
    }, 120)
    return () => window.clearTimeout(timer)
  }, [citedBlock?.id, initialPage])

  useEffect(() => {
    if (!results.length) return
    scrollToBlock(results[Math.min(activeResult, results.length - 1)].blockId)
  }, [activeResult, results])

  const date = formatDate(judgment.decision_date)

  return (
    <section className={styles.root} aria-label="Judgment reading copy">
      <div className={styles.controls} data-print-hide>
        <div className={styles.searchBox}>
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setActiveResult(0)
            }}
            placeholder="Search judgment text"
            aria-label="Search judgment text"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          ) : null}
        </div>
        <span className={styles.resultCount} aria-live="polite">
          {query.trim()
            ? results.length
              ? `${activeResult + 1} / ${results.length}`
              : "NO MATCHES"
            : `${readingCopy.blockCount} PASSAGES`}
        </span>
        <button
          type="button"
          className={styles.iconButton}
          onClick={() => moveSearch(-1)}
          disabled={!results.length}
          aria-label="Previous search result"
        >
          <ChevronUp size={15} />
        </button>
        <button
          type="button"
          className={styles.iconButton}
          onClick={() => moveSearch(1)}
          disabled={!results.length}
          aria-label="Next search result"
        >
          <ChevronDown size={15} />
        </button>
        <div className={styles.divider} />
        <span className={styles.typeLabel}>Aa</span>
        <button
          type="button"
          className={styles.iconButton}
          onClick={() =>
            setFontSize((size) => Math.max(MIN_FONT_SIZE, size - 1))
          }
          disabled={fontSize <= MIN_FONT_SIZE}
          aria-label="Decrease text size"
        >
          <Minus size={15} />
        </button>
        <button
          type="button"
          className={styles.iconButton}
          onClick={() =>
            setFontSize((size) => Math.min(MAX_FONT_SIZE, size + 1))
          }
          disabled={fontSize >= MAX_FONT_SIZE}
          aria-label="Increase text size"
        >
          <Plus size={15} />
        </button>
        <div className={styles.divider} />
        <button
          type="button"
          className={styles.printButton}
          onClick={() => window.print()}
        >
          <Printer size={14} /> PRINT / SAVE PDF
        </button>
      </div>

      <div
        ref={scrollerRef}
        className={styles.scroller}
        style={{ "--reading-font-size": `${fontSize}px` } as CSSProperties}
      >
        <div className={styles.provenance} data-print-hide>
          <div>
            <span className={styles.provenanceEyebrow}>
              VIDHI KOSH · READING COPY
            </span>
            <strong>Clean judgment text, mapped back to the source PDF.</strong>
          </div>
          <p>
            This is an unofficial reader-generated copy. Supreme Court Reports
            editorial headnotes are omitted. Verify quotations, pagination and
            filing references against the original source.
          </p>
          <span className={styles.version}>VERSION {readingCopy.version}</span>
        </div>

        <div className={styles.pageStack}>
          {readingCopy.pages.map((page, pageIndex) => {
            const scrPage = reporterPage(judgment.citation, page.sourcePage)
            return (
              <article
                key={page.sourcePage}
                id={`reading-copy-page-${page.sourcePage}`}
                className={styles.page}
              >
                <header className={styles.pageHeader}>
                  <span>SUPREME COURT OF INDIA</span>
                  <span>
                    {scrPage
                      ? `S.C.R. ${scrPage}`
                      : `SOURCE PAGE ${page.sourcePage}`}
                  </span>
                </header>

                {pageIndex === 0 ? (
                  <div className={styles.coverBlock}>
                    <div className={styles.copyBadge}>
                      UNOFFICIAL READING COPY
                    </div>
                    <h1>{judgment.title}</h1>
                    <div className={styles.caseMeta}>
                      {judgment.citation ? (
                        <span>{judgment.citation}</span>
                      ) : null}
                      {judgment.neutral_citation ? (
                        <span>{judgment.neutral_citation}</span>
                      ) : null}
                      {date ? <span>{date}</span> : null}
                    </div>
                    {judgment.judges.length ? (
                      <p className={styles.coram}>
                        <span>CORAM</span>
                        {judgment.judges.join(" · ")}
                      </p>
                    ) : null}
                    <div className={styles.judgmentRule}>
                      <span>JUDGMENT TEXT</span>
                    </div>
                  </div>
                ) : null}

                <div className={styles.pageBody}>
                  {page.blocks.map((block) => {
                    const cited = citedBlock?.id === block.id
                    const activeSearch =
                      results[activeResult]?.blockId === block.id &&
                      Boolean(query.trim())
                    return (
                      <Fragment key={block.id}>
                        <div
                          id={blockElementId(block.id)}
                          className={styles.block}
                          data-kind={block.kind}
                          data-cited={cited ? "true" : undefined}
                          data-search-active={activeSearch ? "true" : undefined}
                        >
                          {cited ? (
                            <span className={styles.citedLabel} data-print-hide>
                              CITED BY AI PRO
                            </span>
                          ) : null}
                          <p>{highlightMatches(block.text, query)}</p>
                          <button
                            type="button"
                            className={styles.blockLink}
                            onClick={() => void copyBlockLink(block)}
                            aria-label="Copy link to this source passage"
                            title="Copy link to this source passage"
                            data-print-hide
                          >
                            {copiedBlockId === block.id ? (
                              <Check size={13} />
                            ) : (
                              <Link2 size={13} />
                            )}
                          </button>
                        </div>
                      </Fragment>
                    )
                  })}
                </div>

                <footer className={styles.pageFooter}>
                  <strong>VIDHI KOSH READING COPY</strong>
                  <span>
                    Reconstructed from Supreme Court Reports text · Unofficial
                    and not certified by the Supreme Court of India
                  </span>
                  <span>SOURCE PDF {page.sourcePage}</span>
                </footer>
              </article>
            )
          })}
        </div>
      </div>
    </section>
  )
}
