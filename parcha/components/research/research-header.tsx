"use client"

import { Menu } from "lucide-react"
import Link from "next/link"

import { ResearchAccountMenu, type ResearchUser } from "./research-account-menu"
import styles from "./research.module.css"
import { useHistoryStore } from "./store/history-store"

export function ResearchHeader({ user }: { user: ResearchUser }) {
  const openHistory = useHistoryStore((state) => state.setOpen)

  return (
    <header className={styles.appHeader}>
      <div className={styles.brand}>
        <Link
          href="/"
          aria-label="Lex Archives home"
          className={styles.brandMark}
        >
          LA
        </Link>
        <div>
          <strong>LEX ARCHIVES</strong>
          <span>INDIAN CASE-LAW INTELLIGENCE</span>
        </div>
      </div>
      <div className={styles.headerStatus}>
        <span className={styles.indexBadge}>INDEXED</span>
        <span className={styles.headerMetric}>2.48M PASSAGES</span>
        <span className={styles.headerMetric}>SUPREME COURT</span>
      </div>
      <ResearchAccountMenu user={user} />
      <button
        type="button"
        className={styles.mobileHistoryButton}
        onClick={() => openHistory(true)}
        aria-label="Open research history"
      >
        <Menu size={18} />
      </button>
    </header>
  )
}
