import { Fragment, type ReactNode } from "react"

import type { Citation } from "@/lib/research/types"

import styles from "./research.module.css"

export function AnswerText({
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
  const citationMap = new Map(
    citations.map((citation, index) => [
      citation.judgment_id,
      { citation, index },
    ])
  )

  const inline = (text: string): ReactNode[] =>
    text.split(/(\[\[[^\]]+\]\]|\*\*[^*]+\*\*)/g).map((part, index) => {
      const match = part.match(/^\[\[([^\]]+)\]\]$/)
      const strongMatch = part.match(/^\*\*([^*]+)\*\*$/)
      if (strongMatch)
        return (
          <strong key={`${strongMatch[1]}-${index}`}>{strongMatch[1]}</strong>
        )
      if (!match)
        return (
          <Fragment key={`${part}-${index}`}>
            {part.replace(/^#{1,4}\s*/, "")}
          </Fragment>
        )
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
        if (
          lines.length > 1 &&
          lines.every((line) => /^[-*•]\s/.test(line.trim()))
        ) {
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
      {streaming ? (
        <span className={styles.streamCursor} aria-label="Streaming" />
      ) : null}
    </div>
  )
}
