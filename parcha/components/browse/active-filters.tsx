"use client"

import { X } from "lucide-react"

import { LANGUAGE_LABELS, type BrowseFilters } from "@/lib/browse/types"

import styles from "./browse.module.css"
import { useBrowseStore } from "./store/browse-store"

interface Chip {
  key: string
  label: string
  clear: () => void
}

export function ActiveFilters() {
  const filters = useBrowseStore((state) => state.filters)
  const patchFilters = useBrowseStore((state) => state.patchFilters)
  const toggleValue = useBrowseStore((state) => state.toggleValue)
  const toggleBench = useBrowseStore((state) => state.toggleBench)

  const chips: Chip[] = []

  const textChip = (key: keyof BrowseFilters, label: string) => {
    const value = filters[key]
    if (typeof value === "string" && value) {
      chips.push({
        key: label,
        label: value,
        clear: () => patchFilters({ [key]: "" } as Partial<BrowseFilters>),
      })
    }
  }
  textChip("q", "KEYWORD")
  textChip("party", "PARTY")
  textChip("reporter", "REPORTER")
  textChip("neutral_citation", "NEUTRAL CIT.")

  if (filters.year_from !== null || filters.year_to !== null) {
    chips.push({
      key: "YEAR",
      label: `${filters.year_from ?? "…"} – ${filters.year_to ?? "…"}`,
      clear: () => patchFilters({ year_from: null, year_to: null }),
    })
  }
  if (filters.date_from || filters.date_to) {
    chips.push({
      key: "DATE",
      label: `${filters.date_from || "…"} – ${filters.date_to || "…"}`,
      clear: () => patchFilters({ date_from: "", date_to: "" }),
    })
  }
  for (const value of filters.disposal) {
    chips.push({
      key: "DISPOSAL",
      label: value,
      clear: () => toggleValue("disposal", value),
    })
  }
  for (const size of filters.bench) {
    chips.push({
      key: "BENCH",
      label: `${size} judge${size === 1 ? "" : "s"}`,
      clear: () => toggleBench(size),
    })
  }
  for (const value of filters.era) {
    chips.push({
      key: "ERA",
      label: value,
      clear: () => toggleValue("era", value),
    })
  }
  for (const value of filters.judges) {
    chips.push({
      key: "JUDGE",
      label: value,
      clear: () => toggleValue("judges", value),
    })
  }
  for (const value of filters.language) {
    chips.push({
      key: "LANG",
      label: LANGUAGE_LABELS[value] ?? value,
      clear: () => toggleValue("language", value),
    })
  }

  if (!chips.length) return null

  return (
    <div className={styles.activeFilters}>
      {chips.map((chip, index) => (
        <span className={styles.chip} key={`${chip.key}-${index}`}>
          <span className={styles.chipKey}>{chip.key}</span>
          {chip.label}
          <button
            type="button"
            onClick={chip.clear}
            aria-label={`Remove ${chip.key} filter`}
          >
            <X size={12} />
          </button>
        </span>
      ))}
    </div>
  )
}
