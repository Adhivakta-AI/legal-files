"use client"

import { Drawer } from "@base-ui/react/drawer"
import {
  ArrowDownUp,
  CalendarRange,
  RotateCcw,
  SlidersHorizontal,
  X,
} from "lucide-react"
import { useState } from "react"

import type {
  SearchSortOrder,
  SemanticSearchFilters,
} from "@/lib/research/types"

import styles from "./research.module.css"
import {
  DEFAULT_SEARCH_FILTERS,
  useResearchStore,
} from "./store/research-store"

const MIN_YEAR = 1800
const MAX_YEAR = 2200
const CURRENT_YEAR = new Date().getFullYear()

type DraftFilters = {
  yearFrom: string
  yearTo: string
  sort: SearchSortOrder
  limit: number
}

function toDraft(filters: SemanticSearchFilters): DraftFilters {
  return {
    yearFrom: filters.year_from?.toString() ?? "",
    yearTo: filters.year_to?.toString() ?? "",
    sort: filters.sort,
    limit: filters.limit,
  }
}

function parseYear(value: string): number | undefined {
  return value ? Number(value) : undefined
}

export function SearchFilterDrawer({
  disabled = false,
}: {
  disabled?: boolean
}) {
  const filters = useResearchStore((state) => state.searchFilters)
  const setSearchFilters = useResearchStore((state) => state.setSearchFilters)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<DraftFilters>(() => toDraft(filters))

  const yearFrom = parseYear(draft.yearFrom)
  const yearTo = parseYear(draft.yearTo)
  const yearOutOfRange = (year: number | undefined) =>
    year !== undefined &&
    (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR)
  const yearError =
    yearOutOfRange(yearFrom) || yearOutOfRange(yearTo)
      ? `Use a year between ${MIN_YEAR} and ${MAX_YEAR}.`
      : yearFrom && yearTo && yearFrom > yearTo
        ? "The starting year must come before the ending year."
        : ""

  const activeCount =
    Number(filters.year_from !== undefined) +
    Number(filters.year_to !== undefined) +
    Number(filters.sort !== DEFAULT_SEARCH_FILTERS.sort) +
    Number(filters.limit !== DEFAULT_SEARCH_FILTERS.limit)
  const draftActiveCount =
    Number(Boolean(draft.yearFrom)) +
    Number(Boolean(draft.yearTo)) +
    Number(draft.sort !== DEFAULT_SEARCH_FILTERS.sort) +
    Number(draft.limit !== DEFAULT_SEARCH_FILTERS.limit)

  const updateYear = (key: "yearFrom" | "yearTo", value: string) => {
    const numericValue = value.replace(/\D/g, "").slice(0, 4)
    setDraft((current) => ({ ...current, [key]: numericValue }))
  }

  const resetDraft = () => setDraft(toDraft(DEFAULT_SEARCH_FILTERS))

  const applyFilters = () => {
    if (yearError) return
    setSearchFilters({
      sort: draft.sort,
      limit: draft.limit,
      ...(yearFrom ? { year_from: yearFrom } : {}),
      ...(yearTo ? { year_to: yearTo } : {}),
    })
    setOpen(false)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) setDraft(toDraft(filters))
    setOpen(nextOpen)
  }

  return (
    <Drawer.Root
      open={open}
      onOpenChange={handleOpenChange}
      swipeDirection="right"
    >
      <Drawer.Trigger
        type="button"
        className={styles.filterTrigger}
        disabled={disabled}
      >
        <SlidersHorizontal size={16} />
        <span>Filters</span>
        {activeCount > 0 ? (
          <span
            className={styles.filterCount}
            aria-label={`${activeCount} active`}
          >
            {activeCount}
          </span>
        ) : null}
      </Drawer.Trigger>

      <Drawer.Portal>
        <Drawer.Backdrop className={styles.filterDrawerBackdrop} />
        <Drawer.Viewport className={styles.filterDrawerViewport}>
          <Drawer.Popup className={styles.filterDrawerPopup}>
            <Drawer.Content className={styles.filterDrawerContent}>
              <header className={styles.filterDrawerHeader}>
                <div className={styles.filterDrawerHeadingIcon}>
                  <SlidersHorizontal size={19} />
                </div>
                <div>
                  <span>SEMANTIC RETRIEVAL</span>
                  <Drawer.Title>Search filters</Drawer.Title>
                  <Drawer.Description>
                    Narrow the hybrid keyword and vector search before ranking.
                  </Drawer.Description>
                </div>
                <Drawer.Close
                  type="button"
                  className={styles.filterDrawerClose}
                  aria-label="Close search filters"
                >
                  <X size={18} />
                </Drawer.Close>
              </header>

              <div className={styles.filterDrawerBody}>
                <section className={styles.filterGroup}>
                  <div className={styles.filterGroupHeading}>
                    <CalendarRange size={16} />
                    <div>
                      <strong>Decision year</strong>
                      <span>Only return judgments inside this range</span>
                    </div>
                  </div>

                  <div className={styles.yearInputs}>
                    <label>
                      <span>FROM</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={draft.yearFrom}
                        onChange={(event) =>
                          updateYear("yearFrom", event.target.value)
                        }
                        placeholder="1950"
                        aria-invalid={Boolean(yearError)}
                      />
                    </label>
                    <span className={styles.yearDivider}>—</span>
                    <label>
                      <span>TO</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={draft.yearTo}
                        onChange={(event) =>
                          updateYear("yearTo", event.target.value)
                        }
                        placeholder={CURRENT_YEAR.toString()}
                        aria-invalid={Boolean(yearError)}
                      />
                    </label>
                  </div>

                  <div className={styles.yearPresets} aria-label="Year presets">
                    <button
                      type="button"
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          yearFrom: "",
                          yearTo: "",
                        }))
                      }
                    >
                      All time
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          yearFrom: String(CURRENT_YEAR - 4),
                          yearTo: String(CURRENT_YEAR),
                        }))
                      }
                    >
                      Last 5 years
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          yearFrom: "2015",
                          yearTo: "",
                        }))
                      }
                    >
                      Since 2015
                    </button>
                  </div>
                  {yearError ? (
                    <p className={styles.filterError} role="alert">
                      {yearError}
                    </p>
                  ) : (
                    <p className={styles.filterHint}>
                      Empty fields include every available year. Date limits are
                      strict and will not broaden automatically.
                    </p>
                  )}
                </section>

                <section className={styles.filterGroup}>
                  <div className={styles.filterGroupHeading}>
                    <ArrowDownUp size={16} />
                    <div>
                      <strong>Ranking order</strong>
                      <span>Choose how the matching passages are arranged</span>
                    </div>
                  </div>
                  <div className={styles.filterOptionGrid}>
                    {(
                      [
                        {
                          value: "relevance",
                          title: "Best match",
                          detail: "Keyword + semantic relevance",
                        },
                        {
                          value: "recent",
                          title: "Newest first",
                          detail: "Most recent decisions first",
                        },
                      ] as const
                    ).map((option) => (
                      <button
                        type="button"
                        key={option.value}
                        data-selected={draft.sort === option.value || undefined}
                        onClick={() =>
                          setDraft((current) => ({
                            ...current,
                            sort: option.value,
                          }))
                        }
                      >
                        <span className={styles.optionIndicator} />
                        <strong>{option.title}</strong>
                        <small>{option.detail}</small>
                      </button>
                    ))}
                  </div>
                </section>

                <section className={styles.filterGroup}>
                  <div className={styles.filterGroupHeading}>
                    <SlidersHorizontal size={16} />
                    <div>
                      <strong>Result depth</strong>
                      <span>How many ranked judgments to retrieve</span>
                    </div>
                  </div>
                  <div className={styles.resultDepth}>
                    {[20, 40, 50].map((limit) => (
                      <button
                        type="button"
                        key={limit}
                        data-selected={draft.limit === limit || undefined}
                        onClick={() =>
                          setDraft((current) => ({ ...current, limit }))
                        }
                      >
                        <strong>{limit}</strong>
                        <span>{limit === 40 ? "DEFAULT" : "CASES"}</span>
                      </button>
                    ))}
                  </div>
                </section>
              </div>

              <footer className={styles.filterDrawerFooter}>
                <button
                  type="button"
                  className={styles.filterResetButton}
                  onClick={resetDraft}
                >
                  <RotateCcw size={15} />
                  Reset
                </button>
                <button
                  type="button"
                  className={styles.filterApplyButton}
                  onClick={applyFilters}
                  disabled={Boolean(yearError)}
                >
                  Apply filters
                  {draftActiveCount > 0 ? (
                    <span>{draftActiveCount}</span>
                  ) : null}
                </button>
              </footer>
            </Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
