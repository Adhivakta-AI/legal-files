"use client"

import { ChevronLeft, ChevronRight } from "lucide-react"

import styles from "./browse.module.css"
import { useBrowseStore } from "./store/browse-store"

function pageWindow(current: number, last: number): number[] {
  const span = 2
  const start = Math.max(1, Math.min(current - span, last - span * 2))
  const end = Math.min(last, start + span * 2)
  const pages: number[] = []
  for (let page = start; page <= end; page += 1) pages.push(page)
  return pages
}

export function Pagination() {
  const page = useBrowseStore((state) => state.page)
  const pageSize = useBrowseStore((state) => state.pageSize)
  const total = useBrowseStore((state) => state.total)
  const setPage = useBrowseStore((state) => state.setPage)

  const lastPage = Math.max(1, Math.ceil(total / pageSize))
  if (lastPage <= 1) return null

  const go = (next: number) => {
    setPage(next)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  return (
    <nav className={styles.pagination} aria-label="Pagination">
      <button
        type="button"
        onClick={() => go(page - 1)}
        disabled={page <= 1}
        aria-label="Previous page"
      >
        <ChevronLeft size={14} />
      </button>

      {pageWindow(page, lastPage).map((candidate) => (
        <button
          type="button"
          key={candidate}
          data-active={candidate === page}
          onClick={() => go(candidate)}
        >
          {candidate}
        </button>
      ))}

      <span className={styles.pageInfo}>
        of {lastPage.toLocaleString("en-IN")}
      </span>

      <button
        type="button"
        onClick={() => go(page + 1)}
        disabled={page >= lastPage}
        aria-label="Next page"
      >
        <ChevronRight size={14} />
      </button>
    </nav>
  )
}
