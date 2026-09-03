"use client"

import {
  ArrowLeft,
  Download,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react"
import Link from "next/link"
import { useMemo, useState } from "react"

import { LANGUAGE_LABELS, type JudgmentSummary } from "@/lib/browse/types"

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
}: {
  judgment: JudgmentSummary
  initialPdfPage?: number | null
}) {
  const [panelOpen, setPanelOpen] = useState(true)

  const pdfSrc = useMemo(() => {
    if (!judgment.pdf_url) return ""
    const base = judgment.pdf_url.split("#")[0]
    const page = initialPdfPage && initialPdfPage > 0 ? initialPdfPage : null
    return page
      ? `${base}#page=${page}&view=FitH&toolbar=1`
      : `${base}#view=FitH&toolbar=1`
  }, [initialPdfPage, judgment.pdf_url])

  const date = formatDate(judgment.decision_date)
  const strength = benchStrength(judgment.bench_size)

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <Link href="/browse" className={styles.backLink}>
          <ArrowLeft size={13} /> RESULTS
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
        <div className={styles.toolbarActions}>
          {judgment.pdf_url ? (
            <a
              href={judgment.pdf_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Download size={13} /> PDF
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
          {pdfSrc ? (
            <iframe src={pdfSrc} title={`${judgment.title} — judgment PDF`} />
          ) : (
            <div className={styles.viewerFallback}>
              No PDF is available for this judgment.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
