"use client"

import { X } from "lucide-react"

import { LANGUAGE_LABELS } from "@/lib/browse/types"
import { countActiveFilters } from "@/lib/browse/url"

import styles from "./browse.module.css"
import { FacetSection } from "./facet-section"
import { useBrowseStore } from "./store/browse-store"

const MIN_YEAR = 1950
const MAX_YEAR = 2026

function benchLabel(size: string): string {
  const n = Number(size)
  if (n === 1) return "1 · Single judge"
  if (n >= 5) return `${n} · Constitution Bench`
  return `${n} · Division Bench`
}

const LANGUAGE_BUCKETS = Object.keys(LANGUAGE_LABELS).map((value) => ({
  value,
  count: 0,
}))

function numberOrNull(raw: string): number | null {
  if (!raw.trim()) return null
  const parsed = Number.parseInt(raw, 10)
  return Number.isInteger(parsed) ? parsed : null
}

export function FilterRail() {
  const filters = useBrowseStore((state) => state.filters)
  const facets = useBrowseStore((state) => state.facets)
  const patchFilters = useBrowseStore((state) => state.patchFilters)
  const toggleValue = useBrowseStore((state) => state.toggleValue)
  const toggleBench = useBrowseStore((state) => state.toggleBench)
  const clearAll = useBrowseStore((state) => state.clearAll)
  const open = useBrowseStore((state) => state.mobileFiltersOpen)
  const setOpen = useBrowseStore((state) => state.setMobileFiltersOpen)

  const activeCount = countActiveFilters(filters)

  return (
    <>
      {open ? (
        <button
          type="button"
          className={styles.scrim}
          aria-label="Close filters"
          onClick={() => setOpen(false)}
        />
      ) : null}
      <aside className={styles.rail} data-open={open}>
        <div className={styles.railHeader}>
          <span>FILTERS{activeCount ? ` · ${activeCount}` : ""}</span>
          <button
            type="button"
            className={styles.clearButton}
            onClick={clearAll}
            disabled={activeCount === 0}
          >
            CLEAR ALL
          </button>
        </div>

        <div className={styles.railScroll}>
          <div className={styles.field}>
            <label htmlFor="f-q">KEYWORD</label>
            <input
              id="f-q"
              className={styles.textInput}
              value={filters.q}
              onChange={(event) => patchFilters({ q: event.target.value })}
              placeholder="Words in title / citation…"
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="f-party">PARTY NAME</label>
            <input
              id="f-party"
              className={styles.textInput}
              value={filters.party}
              onChange={(event) => patchFilters({ party: event.target.value })}
              placeholder="Petitioner or respondent…"
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="f-reporter">REPORTER / CITATION</label>
            <input
              id="f-reporter"
              className={styles.textInput}
              value={filters.reporter}
              onChange={(event) =>
                patchFilters({ reporter: event.target.value })
              }
              placeholder="e.g. S.C.R."
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="f-nc">NEUTRAL CITATION</label>
            <input
              id="f-nc"
              className={styles.textInput}
              value={filters.neutral_citation}
              onChange={(event) =>
                patchFilters({ neutral_citation: event.target.value })
              }
              placeholder="e.g. 2023 INSC"
            />
          </div>

          <div className={styles.field}>
            <label>DECISION YEAR</label>
            <div className={styles.rangeRow}>
              <input
                className={styles.textInput}
                type="number"
                inputMode="numeric"
                min={MIN_YEAR}
                max={MAX_YEAR}
                value={filters.year_from ?? ""}
                onChange={(event) =>
                  patchFilters({ year_from: numberOrNull(event.target.value) })
                }
                placeholder="From"
                aria-label="Year from"
              />
              <input
                className={styles.textInput}
                type="number"
                inputMode="numeric"
                min={MIN_YEAR}
                max={MAX_YEAR}
                value={filters.year_to ?? ""}
                onChange={(event) =>
                  patchFilters({ year_to: numberOrNull(event.target.value) })
                }
                placeholder="To"
                aria-label="Year to"
              />
            </div>
          </div>

          <div className={styles.field}>
            <label>DECISION DATE</label>
            <div className={styles.rangeRow}>
              <input
                className={styles.textInput}
                type="date"
                value={filters.date_from}
                onChange={(event) =>
                  patchFilters({ date_from: event.target.value })
                }
                aria-label="Date from"
              />
              <input
                className={styles.textInput}
                type="date"
                value={filters.date_to}
                onChange={(event) =>
                  patchFilters({ date_to: event.target.value })
                }
                aria-label="Date to"
              />
            </div>
          </div>

          <FacetSection
            label="DISPOSAL"
            buckets={facets?.disposal_nature ?? []}
            selected={filters.disposal}
            onToggle={(value) => toggleValue("disposal", value)}
            defaultOpen
          />

          <FacetSection
            label="BENCH STRENGTH"
            buckets={facets?.bench_size ?? []}
            selected={filters.bench.map(String)}
            onToggle={(value) => toggleBench(Number(value))}
            formatValue={benchLabel}
          />

          <FacetSection
            label="ERA"
            buckets={facets?.era ?? []}
            selected={filters.era}
            onToggle={(value) => toggleValue("era", value)}
          />

          <FacetSection
            label="JUDGE / CORAM"
            buckets={facets?.judges ?? []}
            selected={filters.judges}
            onToggle={(value) => toggleValue("judges", value)}
            searchable
          />

          <FacetSection
            label="LANGUAGE"
            buckets={LANGUAGE_BUCKETS}
            selected={filters.language}
            onToggle={(value) => toggleValue("language", value)}
            formatValue={(value) => LANGUAGE_LABELS[value] ?? value}
            hideCounts
          />
        </div>

        <button
          type="button"
          className={styles.mobileFilterToggle}
          style={{ margin: "0.75rem 1.1rem" }}
          onClick={() => setOpen(false)}
        >
          <X size={13} /> DONE
        </button>
      </aside>
    </>
  )
}
