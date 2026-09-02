import Link from "next/link"

import type { JudgmentSummary } from "@/lib/browse/types"

import styles from "./browse.module.css"

function formatDate(value: string | null): string | null {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

function benchText(size: number | null, judges: string[]): string | null {
  if (judges.length) {
    const shown = judges.slice(0, 3).join(", ")
    return judges.length > 3 ? `${shown} +${judges.length - 3}` : shown
  }
  if (size) return `${size}-judge bench`
  return null
}

export function ResultCard({
  judgment,
  index,
}: {
  judgment: JudgmentSummary
  index: number
}) {
  const date = formatDate(judgment.decision_date)
  const bench = benchText(judgment.bench_size, judgment.judges)

  return (
    <Link
      href={`/browse/${encodeURIComponent(judgment.judgment_id)}`}
      className={styles.card}
    >
      <div className={styles.cardTop}>
        <span className={styles.cardNumber}>
          {String(index).padStart(2, "0")}
        </span>
        <span className={styles.cardTitle}>{judgment.title}</span>
      </div>

      <div className={styles.cardMeta}>
        {judgment.citation ? <strong>{judgment.citation}</strong> : null}
        {judgment.neutral_citation ? (
          <span>{judgment.neutral_citation}</span>
        ) : null}
        {date ? <span>{date}</span> : null}
        <span>{judgment.court}</span>
      </div>

      <div className={styles.cardBadges}>
        {judgment.disposal_nature ? (
          <span className={`${styles.badge} ${styles.badgeAccent}`}>
            {judgment.disposal_nature}
          </span>
        ) : null}
        {judgment.bench_size && judgment.bench_size >= 5 ? (
          <span className={styles.badge}>CONSTITUTION BENCH</span>
        ) : null}
        {judgment.era ? (
          <span className={styles.badge}>{judgment.era}</span>
        ) : null}
      </div>

      {bench ? (
        <div className={styles.cardBench}>
          CORAM <span>{bench}</span>
        </div>
      ) : null}
    </Link>
  )
}
