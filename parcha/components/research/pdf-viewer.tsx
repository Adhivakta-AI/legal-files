"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Download,
  ExternalLink,
  Minus,
  Plus,
  Printer,
  Share2,
  X,
} from "lucide-react"

import type { Citation } from "@/lib/research/types"

import styles from "./research.module.css"

export function PdfViewer({
  citation,
  onClose,
}: {
  citation: Citation
  onClose: () => void
}) {
  const [zoom, setZoom] = useState(100)
  const [shareState, setShareState] = useState("Share")

  const documentUrl = useMemo(() => {
    const base = citation.pdf_url.split("#")[0]
    return `${base}#page=${Math.max(1, citation.pdf_page)}&zoom=${zoom}`
  }, [citation.pdf_page, citation.pdf_url, zoom])

  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [onClose])

  const share = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: citation.case_name, url: documentUrl })
      } else {
        await navigator.clipboard.writeText(documentUrl)
        setShareState("Copied")
        window.setTimeout(() => setShareState("Share"), 1600)
      }
    } catch {
      setShareState("Unable to share")
    }
  }

  return (
    <div className={styles.pdfBackdrop} role="dialog" aria-modal="true" aria-label={citation.case_name}>
      <div className={styles.pdfShell}>
        <header className={styles.pdfToolbar}>
          <div className={styles.pdfIdentity}>
            <span className={styles.eyebrow}>VERIFIED CITATION</span>
            <strong>{citation.case_name}</strong>
            <span className={styles.pdfMeta}>
              {citation.citation} · PAGE {citation.pdf_page}
            </span>
          </div>
          <div className={styles.pdfActions}>
            <button
              type="button"
              className={styles.iconButton}
              onClick={() => setZoom((value) => Math.max(50, value - 25))}
              aria-label="Zoom out"
            >
              <Minus size={17} />
            </button>
            <span className={styles.zoomValue}>{zoom}%</span>
            <button
              type="button"
              className={styles.iconButton}
              onClick={() => setZoom((value) => Math.min(200, value + 25))}
              aria-label="Zoom in"
            >
              <Plus size={17} />
            </button>
            <a
              className={styles.iconButton}
              href={citation.pdf_url}
              target="_blank"
              rel="noreferrer"
              download
              aria-label="Download PDF"
            >
              <Download size={17} />
            </a>
            <button
              type="button"
              className={styles.iconButton}
              onClick={() => window.open(documentUrl, "_blank", "noopener,noreferrer")}
              aria-label="Open printable PDF"
            >
              <Printer size={17} />
            </button>
            <button type="button" className={styles.iconButton} onClick={share} aria-label={shareState}>
              <Share2 size={17} />
            </button>
            <a
              className={styles.iconButton}
              href={documentUrl}
              target="_blank"
              rel="noreferrer"
              aria-label="Open PDF in new tab"
            >
              <ExternalLink size={17} />
            </a>
            <button type="button" className={styles.iconButton} onClick={onClose} aria-label="Close PDF">
              <X size={19} />
            </button>
          </div>
        </header>
        <div className={styles.pdfViewport}>
          <iframe src={documentUrl} title={`${citation.case_name} PDF`} />
        </div>
      </div>
    </div>
  )
}
