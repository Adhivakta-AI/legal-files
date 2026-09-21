"use client"

import {
  ArrowLeft,
  Download,
  ExternalLink,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
} from "lucide-react"
import Link from "next/link"
import { useTheme } from "next-themes"
import { useState } from "react"

import type {
  LegalCitedPassage,
  LegalDocumentRecord,
} from "@/lib/legal-documents"

import styles from "./reader.module.css"

function displayDate(value: string | null): string | null {
  if (!value) return null
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })
}

export function LegalDocumentReader({
  document,
  initialPdfPage,
  returnHref,
  returnLabel,
  highlightChunkId,
  unitLabel,
  citedPassage,
  pdfAccessToken,
}: {
  document: LegalDocumentRecord
  initialPdfPage?: number | null
  returnHref: string
  returnLabel: string
  highlightChunkId?: string | null
  unitLabel?: string | null
  citedPassage?: LegalCitedPassage | null
  pdfAccessToken: string
}) {
  const [panelOpen, setPanelOpen] = useState(true)
  const { resolvedTheme, setTheme } = useTheme()
  const dark = resolvedTheme !== "light"
  const pdfPath = `/api/legal-documents/${encodeURIComponent(document.id)}/pdf?access=${encodeURIComponent(pdfAccessToken)}`
  const viewerPage = citedPassage?.pdf_page_start ?? initialPdfPage ?? 1

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
        <span className={styles.toolbarTitle}>{document.title}</span>
        {highlightChunkId ? (
          <span className={styles.citationContext} title={highlightChunkId}>
            {unitLabel ? `${unitLabel} · ` : "CITED PASSAGE · "}
            {highlightChunkId.slice(-10).toUpperCase()}
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
          <a href={pdfPath} target="_blank" rel="noopener noreferrer">
            <Download size={13} /> PDF
          </a>
        </div>
      </div>

      <div className={styles.body} data-panel={panelOpen ? "open" : "closed"}>
        <aside className={styles.panel}>
          <div className={styles.panelSection}>
            <div className={styles.panelLabel}>PRIMARY LAW</div>
            <div className={styles.caseName}>{document.title}</div>
            <div className={styles.parties}>
              <span>AUTHORITATIVE COPY</span>
              Original government PDF preserved by Vidhi Kosh
            </div>
          </div>

          <div className={styles.panelSection}>
            <div className={styles.panelLabel}>DOCUMENT</div>
            <dl className={styles.metaGrid}>
              <div className={styles.metaRow}>
                <dt>AUTHORITY</dt>
                <dd>{document.authority}</dd>
              </div>
              {document.act_number ? (
                <div className={styles.metaRow}>
                  <dt>ACT NUMBER</dt>
                  <dd>{document.act_number}</dd>
                </div>
              ) : null}
              {document.effective_from ? (
                <div className={styles.metaRow}>
                  <dt>EFFECTIVE FROM</dt>
                  <dd>{displayDate(document.effective_from)}</dd>
                </div>
              ) : null}
              {document.current_through ? (
                <div className={styles.metaRow}>
                  <dt>CURRENT THROUGH</dt>
                  <dd>{displayDate(document.current_through)}</dd>
                </div>
              ) : null}
              <div className={styles.metaRow}>
                <dt>CORPUS VERSION</dt>
                <dd>{document.corpus_version}</dd>
              </div>
            </dl>
          </div>

          <div className={styles.panelSection}>
            <div className={styles.panelLabel}>PROVENANCE</div>
            <dl className={styles.metaGrid}>
              <div className={styles.metaRow}>
                <dt>SHA-256</dt>
                <dd className={styles.checksum}>{document.source_sha256}</dd>
              </div>
            </dl>
            <a
              className={styles.sourceLink}
              href={document.canonical_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Government source record <ExternalLink size={12} />
            </a>
          </div>
        </aside>

        <div className={styles.viewer}>
          <iframe
            src={`${pdfPath}#page=${Math.max(1, viewerPage)}&view=FitH&toolbar=1`}
            title={`${document.title} — original government PDF`}
          />
        </div>
      </div>
    </div>
  )
}
