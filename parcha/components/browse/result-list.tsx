"use client"

import type { BrowseSort } from "@/lib/browse/types"

import { ActiveFilters } from "./active-filters"
import styles from "./browse.module.css"
import { Pagination } from "./pagination"
import { ResultCard } from "./result-card"
import { useBrowseStore } from "./store/browse-store"

const SORT_OPTIONS: Array<{ value: BrowseSort; label: string }> = [
  { value: "recent", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "relevance", label: "Best match" },
  { value: "title", label: "Title A–Z" },
]

export function ResultList() {
  const results = useBrowseStore((state) => state.results)
  const total = useBrowseStore((state) => state.total)
  const page = useBrowseStore((state) => state.page)
  const pageSize = useBrowseStore((state) => state.pageSize)
  const loading = useBrowseStore((state) => state.loading)
  const error = useBrowseStore((state) => state.error)
  const sort = useBrowseStore((state) => state.filters.sort)
  const setSort = useBrowseStore((state) => state.setSort)

  const firstOnPage = total === 0 ? 0 : (page - 1) * pageSize + 1
  const lastOnPage = Math.min(total, (page - 1) * pageSize + results.length)

  return (
    <section className={styles.results}>
      <div className={styles.resultsBar}>
        <span className={styles.resultsCount}>
          {total > 0 ? (
            <>
              <strong>{firstOnPage.toLocaleString("en-IN")}</strong>–
              <strong>{lastOnPage.toLocaleString("en-IN")}</strong> of{" "}
              <strong>{total.toLocaleString("en-IN")}</strong> judgments
            </>
          ) : loading ? (
            "Searching…"
          ) : (
            "No judgments"
          )}
        </span>
        <label className={styles.sortControl}>
          SORT
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as BrowseSort)}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading ? <div className={styles.loadingBar} /> : null}

      <ActiveFilters />

      {error ? <div className={styles.errorBox}>{error}</div> : null}

      {!error && results.length === 0 && !loading ? (
        <div className={styles.stateBox}>
          No judgments match these filters. Try widening the date range or
          removing a facet.
        </div>
      ) : null}

      <div className={styles.resultList}>
        {results.map((judgment, offset) => (
          <ResultCard
            key={judgment.judgment_id}
            judgment={judgment}
            index={firstOnPage + offset}
          />
        ))}
      </div>

      <Pagination />
    </section>
  )
}
