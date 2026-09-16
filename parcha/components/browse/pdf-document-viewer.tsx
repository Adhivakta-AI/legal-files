"use client"

import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Expand,
  Highlighter,
  LoaderCircle,
  RotateCw,
  Search,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  RenderTask,
  TextLayer,
} from "pdfjs-dist"

import styles from "./pdf-document-viewer.module.css"

type PdfJs = typeof import("pdfjs-dist/webpack.mjs")

interface Token {
  value: string
  item: number
}

function tokens(strings: string[]): Token[] {
  return strings.flatMap((text, item) =>
    Array.from(text.toLocaleLowerCase("en-IN").matchAll(/[\p{L}\p{N}]+/gu)).map(
      (match) => ({ value: match[0], item })
    )
  )
}

function findSequence(haystack: Token[], needle: string[], from = 0): number {
  if (!needle.length) return -1
  outer: for (
    let index = from;
    index <= haystack.length - needle.length;
    index += 1
  ) {
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[index + offset].value !== needle[offset]) continue outer
    }
    return index
  }
  return -1
}

function matchingItems(strings: string[], query: string): Set<number> {
  const pageTokens = tokens(strings)
  const queryTokens = tokens([query]).map(({ value }) => value)
  const matched = new Set<number>()
  if (!pageTokens.length || queryTokens.length < 2) return matched

  const windowSize = Math.min(8, queryTokens.length)
  let firstPageToken = -1
  let firstQueryToken = 0
  for (
    let queryStart = 0;
    queryStart <= Math.min(32, queryTokens.length - windowSize);
    queryStart += 1
  ) {
    const found = findSequence(
      pageTokens,
      queryTokens.slice(queryStart, queryStart + windowSize)
    )
    if (found >= 0) {
      firstPageToken = found
      firstQueryToken = queryStart
      break
    }
  }
  if (firstPageToken < 0) return matched

  let lastPageToken = firstPageToken + windowSize - 1
  const expectedEnd = Math.min(
    pageTokens.length,
    firstPageToken + (queryTokens.length - firstQueryToken) + 80
  )
  for (
    let queryStart = queryTokens.length - windowSize;
    queryStart >= firstQueryToken;
    queryStart -= 1
  ) {
    const found = findSequence(
      pageTokens.slice(firstPageToken, expectedEnd),
      queryTokens.slice(queryStart, queryStart + windowSize)
    )
    if (found >= 0) {
      lastPageToken = firstPageToken + found + windowSize - 1
      break
    }
  }

  for (let index = firstPageToken; index <= lastPageToken; index += 1) {
    matched.add(pageTokens[index].item)
  }
  return matched
}

function clampPage(value: number, total: number): number {
  return Math.min(Math.max(Math.round(value), 1), Math.max(total, 1))
}

function plainText(value: string): string {
  return tokens([value])
    .map(({ value: token }) => token)
    .join(" ")
}

export function PdfDocumentViewer({
  src,
  title,
  initialPage = 1,
  citedText,
  citedLabel = "Cited passage",
}: {
  src: string
  title: string
  initialPage?: number
  citedText?: string | null
  citedLabel?: string
}) {
  const [pdfJs, setPdfJs] = useState<PdfJs | null>(null)
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null)
  const [page, setPage] = useState(Math.max(initialPage, 1))
  const [pageCount, setPageCount] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [viewportWidth, setViewportWidth] = useState(900)
  const [loadingProgress, setLoadingProgress] = useState<number | null>(null)
  const [rendering, setRendering] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchText, setSearchText] = useState("")
  const [searchPages, setSearchPages] = useState<number[]>([])
  const [searching, setSearching] = useState(false)
  const [searchIndex, setSearchIndex] = useState(0)
  const [citationLocated, setCitationLocated] = useState<boolean | null>(null)
  const shellRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  const renderTaskRef = useRef<RenderTask | null>(null)
  const textTaskRef = useRef<TextLayer | null>(null)

  useEffect(() => {
    let active = true
    let loadingTask: PDFDocumentLoadingTask | null = null
    queueMicrotask(() => {
      if (!active) return
      setError(null)
      setDocument(null)
      setRendering(true)
    })
    void import("pdfjs-dist/webpack.mjs")
      .then((library) => {
        if (!active) return
        setPdfJs(library)
        loadingTask = library.getDocument({ url: src, withCredentials: true })
        loadingTask.onProgress = ({
          loaded,
          total,
        }: {
          loaded: number
          total: number
        }) => {
          if (active && total > 0) setLoadingProgress(loaded / total)
        }
        return loadingTask.promise
      })
      .then((loaded) => {
        if (!active || !loaded) return
        setDocument(loaded)
        setPageCount(loaded.numPages)
        setPage(clampPage(initialPage, loaded.numPages))
        setLoadingProgress(1)
      })
      .catch((reason: unknown) => {
        if (!active) return
        console.error("Unable to load PDF", reason)
        setError(
          "This PDF could not be loaded. Please retry or download the original."
        )
        setRendering(false)
      })
    return () => {
      active = false
      void loadingTask?.destroy()
    }
  }, [initialPage, src])

  useEffect(() => {
    if (!scrollRef.current) return
    const node = scrollRef.current
    const observer = new ResizeObserver(() =>
      setViewportWidth(node.clientWidth)
    )
    observer.observe(node)
    queueMicrotask(() => setViewportWidth(node.clientWidth))
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!document || !pdfJs || !canvasRef.current || !textLayerRef.current)
      return
    let active = true
    renderTaskRef.current?.cancel()
    textTaskRef.current?.cancel()
    queueMicrotask(() => {
      if (!active) return
      setRendering(true)
      setCitationLocated(null)
    })

    void document
      .getPage(page)
      .then(async (pdfPage) => {
        if (!active || !canvasRef.current || !textLayerRef.current) return
        const natural = pdfPage.getViewport({ scale: 1, rotation })
        const fitScale = Math.max((viewportWidth - 64) / natural.width, 0.25)
        const scale = fitScale * zoom
        const viewport = pdfPage.getViewport({ scale, rotation })
        const canvas = canvasRef.current
        const outputScale = Math.min(window.devicePixelRatio || 1, 2)
        canvas.width = Math.floor(viewport.width * outputScale)
        canvas.height = Math.floor(viewport.height * outputScale)
        canvas.style.width = `${Math.floor(viewport.width)}px`
        canvas.style.height = `${Math.floor(viewport.height)}px`
        const context = canvas.getContext("2d")
        if (!context) throw new Error("Canvas is unavailable")
        const renderTask = pdfPage.render({
          canvas,
          viewport,
          transform:
            outputScale === 1
              ? undefined
              : [outputScale, 0, 0, outputScale, 0, 0],
        })
        renderTaskRef.current = renderTask

        const textContent = await pdfPage.getTextContent()
        if (!active) return
        const layerNode = textLayerRef.current
        layerNode.replaceChildren()
        layerNode.style.width = `${Math.floor(viewport.width)}px`
        layerNode.style.height = `${Math.floor(viewport.height)}px`
        layerNode.style.setProperty("--total-scale-factor", String(scale))
        const textTask = new pdfJs.TextLayer({
          textContentSource: textContent,
          container: layerNode,
          viewport,
        })
        textTaskRef.current = textTask
        await Promise.all([renderTask.promise, textTask.render()])
        if (!active) return

        const citationItems = citedText
          ? matchingItems(textTask.textContentItemsStr, citedText)
          : new Set<number>()
        const searchItems = searchText.trim()
          ? matchingItems(textTask.textContentItemsStr, searchText)
          : new Set<number>()
        textTask.textDivs.forEach((span, index) => {
          if (citationItems.has(index))
            span.classList.add(styles.citationHighlight)
          if (searchItems.has(index)) span.classList.add(styles.searchHighlight)
        })
        setCitationLocated(citedText ? citationItems.size > 0 : null)
        setRendering(false)
      })
      .catch((reason: unknown) => {
        if (
          !active ||
          (reason as { name?: string }).name === "RenderingCancelledException"
        ) {
          return
        }
        console.error("Unable to render PDF page", reason)
        setError("This page could not be rendered.")
        setRendering(false)
      })

    return () => {
      active = false
      renderTaskRef.current?.cancel()
      textTaskRef.current?.cancel()
    }
  }, [
    citedText,
    document,
    page,
    pdfJs,
    rotation,
    searchText,
    viewportWidth,
    zoom,
  ])

  const goToPage = useCallback(
    (nextPage: number) => {
      if (!pageCount) return
      setPage(clampPage(nextPage, pageCount))
      scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })
    },
    [pageCount]
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.matches("input, textarea, [contenteditable='true']")) return
      if (event.key === "ArrowLeft" || event.key === "PageUp")
        goToPage(page - 1)
      if (event.key === "ArrowRight" || event.key === "PageDown")
        goToPage(page + 1)
      if (event.key === "+" || event.key === "=")
        setZoom((value) => Math.min(value + 0.15, 2.5))
      if (event.key === "-") setZoom((value) => Math.max(value - 0.15, 0.5))
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [goToPage, page])

  const runSearch = useCallback(async () => {
    const query = plainText(searchText)
    if (!document || query.length < 2) {
      setSearchPages([])
      return
    }
    setSearching(true)
    const found: number[] = []
    try {
      for (
        let pageNumber = 1;
        pageNumber <= document.numPages;
        pageNumber += 1
      ) {
        const pdfPage = await document.getPage(pageNumber)
        const content = await pdfPage.getTextContent()
        const pageText = content.items
          .flatMap((item) => ("str" in item ? [item.str] : []))
          .join(" ")
        if (plainText(pageText).includes(query)) found.push(pageNumber)
      }
      setSearchPages(found)
      setSearchIndex(0)
      if (found.length) goToPage(found[0])
    } finally {
      setSearching(false)
    }
  }, [document, goToPage, searchText])

  const moveSearch = (direction: number) => {
    if (!searchPages.length) return
    const index =
      (searchIndex + direction + searchPages.length) % searchPages.length
    setSearchIndex(index)
    goToPage(searchPages[index])
  }

  const progressLabel = useMemo(() => {
    if (loadingProgress === null) return "Opening document…"
    return `Opening document · ${Math.round(loadingProgress * 100)}%`
  }, [loadingProgress])

  return (
    <div className={styles.root} ref={shellRef}>
      <div className={styles.controls} aria-label="PDF controls">
        <div className={styles.controlGroup}>
          <button
            onClick={() => goToPage(page - 1)}
            disabled={page <= 1}
            aria-label="Previous page"
          >
            <ChevronLeft size={16} />
          </button>
          <label className={styles.pageControl}>
            <span>PAGE</span>
            <input
              type="number"
              min={1}
              max={pageCount || 1}
              value={page}
              onChange={(event) => goToPage(Number(event.target.value))}
              aria-label="Current page"
            />
            <b>/ {pageCount || "—"}</b>
          </label>
          <button
            onClick={() => goToPage(page + 1)}
            disabled={!pageCount || page >= pageCount}
            aria-label="Next page"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        <div className={styles.controlGroup}>
          <button
            onClick={() => setZoom((value) => Math.max(value - 0.15, 0.5))}
            aria-label="Zoom out"
          >
            <ZoomOut size={16} />
          </button>
          <button
            className={styles.zoomValue}
            onClick={() => setZoom(1)}
            title="Fit width"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            onClick={() => setZoom((value) => Math.min(value + 0.15, 2.5))}
            aria-label="Zoom in"
          >
            <ZoomIn size={16} />
          </button>
          <button
            onClick={() => setRotation((value) => (value + 90) % 360)}
            aria-label="Rotate clockwise"
          >
            <RotateCw size={16} />
          </button>
        </div>

        <div className={styles.controlGroup}>
          <button
            data-active={searchOpen}
            onClick={() => setSearchOpen((value) => !value)}
            aria-label="Search document"
          >
            <Search size={16} />
          </button>
          <button
            onClick={() => void shellRef.current?.requestFullscreen()}
            aria-label="Enter fullscreen"
          >
            <Expand size={16} />
          </button>
        </div>
      </div>

      {searchOpen ? (
        <form
          className={styles.searchBar}
          onSubmit={(event) => {
            event.preventDefault()
            void runSearch()
          }}
        >
          <Search size={15} />
          <input
            autoFocus
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="Search within this judgment…"
            aria-label="Search within document"
          />
          <span className={styles.searchStatus}>
            {searching
              ? "SCANNING…"
              : searchPages.length
                ? `${searchIndex + 1} / ${searchPages.length}`
                : searchText
                  ? "NO MATCHES"
                  : ""}
          </span>
          <button
            type="button"
            onClick={() => moveSearch(-1)}
            disabled={!searchPages.length}
            aria-label="Previous match"
          >
            <ChevronUp size={15} />
          </button>
          <button
            type="button"
            onClick={() => moveSearch(1)}
            disabled={!searchPages.length}
            aria-label="Next match"
          >
            <ChevronDown size={15} />
          </button>
          <button
            type="button"
            onClick={() => {
              setSearchOpen(false)
              setSearchText("")
              setSearchPages([])
            }}
            aria-label="Close search"
          >
            <X size={15} />
          </button>
        </form>
      ) : null}

      {citedText ? (
        <div
          className={styles.citationNotice}
          data-located={citationLocated === true}
        >
          <Highlighter size={14} />
          <span>
            <b>{citedLabel}</b>
            {citationLocated === false
              ? " · page located; exact text overlay unavailable"
              : citationLocated
                ? " · highlighted on this page"
                : " · locating…"}
          </span>
        </div>
      ) : null}

      <div className={styles.scroller} ref={scrollRef}>
        {error ? (
          <div className={styles.stateCard} role="alert">
            <AlertTriangle size={24} />
            <strong>Unable to display this page</strong>
            <span>{error}</span>
          </div>
        ) : !document ? (
          <div className={styles.stateCard}>
            <LoaderCircle className={styles.spinner} size={25} />
            <strong>{progressLabel}</strong>
          </div>
        ) : (
          <div
            className={styles.pageStage}
            aria-label={`${title}, page ${page}`}
          >
            <div className={styles.paper}>
              <canvas ref={canvasRef} />
              <div className={styles.textLayer} ref={textLayerRef} />
              {rendering ? (
                <div className={styles.rendering}>
                  <LoaderCircle className={styles.spinner} size={20} />
                </div>
              ) : null}
            </div>
            <div className={styles.pageCaption}>PAGE {page}</div>
          </div>
        )}
      </div>
    </div>
  )
}
