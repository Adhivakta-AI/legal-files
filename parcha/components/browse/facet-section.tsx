"use client"

import { ChevronDown } from "lucide-react"
import { useMemo, useState } from "react"

import type { FacetBucket } from "@/lib/browse/types"

import styles from "./browse.module.css"

export function FacetSection({
  label,
  buckets,
  selected,
  onToggle,
  formatValue,
  searchable = false,
  defaultOpen = false,
  hideCounts = false,
}: {
  label: string
  buckets: FacetBucket[]
  selected: string[]
  onToggle: (value: string) => void
  formatValue?: (value: string) => string
  searchable?: boolean
  defaultOpen?: boolean
  hideCounts?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen || selected.length > 0)
  const [query, setQuery] = useState("")

  const rows = useMemo(() => {
    const known = new Set(buckets.map((bucket) => String(bucket.value)))
    // keep selected values visible even when they drop out of the facet counts
    const merged: FacetBucket[] = [
      ...buckets,
      ...selected
        .filter((value) => !known.has(value))
        .map((value) => ({ value, count: 0 })),
    ]
    const needle = query.trim().toLowerCase()
    if (!needle) return merged
    return merged.filter((bucket) =>
      String(bucket.value).toLowerCase().includes(needle)
    )
  }, [buckets, selected, query])

  return (
    <div className={styles.facet}>
      <button
        type="button"
        className={styles.facetHead}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span>
          {label}
          {selected.length ? (
            <span data-badge> · {selected.length}</span>
          ) : null}
        </span>
        <ChevronDown
          size={13}
          style={{ transform: open ? "rotate(180deg)" : "none" }}
        />
      </button>
      {open ? (
        <div className={styles.facetBody}>
          {searchable ? (
            <input
              className={styles.facetSearch}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Filter ${label.toLowerCase()}…`}
              aria-label={`Filter ${label}`}
            />
          ) : null}
          {rows.length ? (
            rows.map((bucket) => {
              const value = String(bucket.value)
              const checked = selected.includes(value)
              return (
                <label
                  key={value}
                  className={styles.checkRow}
                  data-checked={checked}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggle(value)}
                  />
                  <span data-label title={value}>
                    {formatValue ? formatValue(value) : value}
                  </span>
                  {hideCounts ? null : (
                    <span data-count>
                      {bucket.count.toLocaleString("en-IN")}
                    </span>
                  )}
                </label>
              )
            })
          ) : (
            <div className={styles.facetEmpty}>No matches</div>
          )}
        </div>
      ) : null}
    </div>
  )
}
