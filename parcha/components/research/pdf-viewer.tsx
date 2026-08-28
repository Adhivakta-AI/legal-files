"use client"

import { useEffect, useMemo } from "react"
import { X } from "lucide-react"

import type { Citation } from "@/lib/research/types"

import styles from "./research.module.css"

export function PdfViewer({
  citation,
  onClose,
}: {
  citation: Citation
  onClose: () => void
}) {
  const documentUrl = useMemo(() => {
    const base = citation.pdf_url.split("#")[0]
    return `${base}#page=${Math.max(1, citation.pdf_page)}`
  }, [citation.pdf_page, citation.pdf_url])

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
