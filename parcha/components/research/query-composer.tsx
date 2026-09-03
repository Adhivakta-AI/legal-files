"use client"

import { ArrowRight } from "lucide-react"
import type { FormEvent, KeyboardEvent } from "react"

import type { ResearchMode } from "@/lib/research/types"

import { EXAMPLES } from "./lib/research-modes"
import { ResearchModeIcon } from "./mode-select"
import styles from "./research.module.css"
import { useResearchStore } from "./store/research-store"

export function QueryComposer({ mode }: { mode: ResearchMode }) {
  const query = useResearchStore((state) => state.query)
  const running = useResearchStore((state) => state.running)
  const setQuery = useResearchStore((state) => state.setQuery)
  const submit = useResearchStore((state) => state.submit)

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    void submit()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault()
      void submit()
    }
  }

  return (
    <section className={styles.composerSection}>
      <div className={styles.intro}>
        <span className={styles.eyebrow}>LEX / RESEARCH TERMINAL</span>
        <h1>What would you like to research?</h1>
        <p>Ask about an issue, doctrine, statute, or judgment.</p>
      </div>
      <form className={styles.composer} onSubmit={onSubmit}>
        <textarea
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Describe the legal issue, doctrine, statute, or factual pattern…"
          aria-label="Legal research query"
          rows={6}
          disabled={running}
        />
        <div className={styles.composerToolbar}>
          <div
            className={styles.modeBadge}
            aria-label={mode === "search" ? "Search mode" : "AI Pro mode"}
          >
            <span className={styles.modeSelectTriggerIcon}>
              <ResearchModeIcon mode={mode} />
            </span>
            {mode === "search" ? "Search" : "AI Pro"}
          </div>
          <span className={styles.shortcut}>⌘ ENTER</span>
          <span className={styles.charCount}>{query.length}/3000</span>
          <button
            type="submit"
            className={styles.submitButton}
            disabled={query.trim().length < 3 || running}
          >
            {running
              ? mode === "search"
                ? "Searching"
                : "Synthesizing"
              : mode === "search"
                ? "Search cases"
                : "Ask AI Pro"}
            <ArrowRight size={17} />
          </button>
        </div>
      </form>
      <div className={styles.examples}>
        <span>TRY A QUERY</span>
        {EXAMPLES.map((example) => (
          <button type="button" key={example} onClick={() => setQuery(example)}>
            {example} <ArrowRight size={13} />
          </button>
        ))}
      </div>
    </section>
  )
}
