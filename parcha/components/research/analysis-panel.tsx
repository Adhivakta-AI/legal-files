import { Search, Sparkles } from "lucide-react"

import type { QueryAnalysis, ResearchMode } from "@/lib/research/types"

import styles from "./research.module.css"

export function AnalysisPanel({
  analysis,
  mode,
}: {
  analysis: QueryAnalysis
  mode: ResearchMode
}) {
  return (
    <div className={styles.analysisPanel}>
      <div className={styles.panelLabel}>
        {mode === "search" ? <Search size={12} /> : <Sparkles size={12} />}
        {mode === "search" ? "CORRECTED QUERY" : "NORMALIZED QUERY"}
      </div>
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
            <span key={`${item.from}-${item.to}`}>
              {item.from} → {item.to}
            </span>
          ))}
        </div>
      ) : null}
      {mode === "ai_pro" ? (
        <>
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
        </>
      ) : null}
    </div>
  )
}
