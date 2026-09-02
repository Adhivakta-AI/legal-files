import { create } from "zustand"

import {
  DEFAULT_PAGE_SIZE,
  EMPTY_FILTERS,
  type BrowseFacets,
  type BrowseFilters,
  type BrowseResponse,
  type BrowseSort,
  type JudgmentSummary,
} from "@/lib/browse/types"
import { filtersToBrowseRequest } from "@/lib/browse/url"

type ArrayFilterKey = "judges" | "disposal" | "era" | "language" | "court"

interface BrowseState {
  filters: BrowseFilters
  page: number
  pageSize: number
  results: JudgmentSummary[]
  facets: BrowseFacets | null
  total: number
  loading: boolean
  error: string
  initialized: boolean
  mobileFiltersOpen: boolean
}

interface BrowseActions {
  hydrate: (payload: {
    filters: BrowseFilters
    page: number
    response: BrowseResponse
  }) => void
  /** Replace filters + page wholesale (browser back/forward, URL load). */
  replaceQuery: (filters: BrowseFilters, page: number) => void
  patchFilters: (partial: Partial<BrowseFilters>) => void
  toggleValue: (key: ArrayFilterKey, value: string) => void
  toggleBench: (size: number) => void
  setSort: (sort: BrowseSort) => void
  setPage: (page: number) => void
  clearAll: () => void
  setMobileFiltersOpen: (open: boolean) => void
  run: () => Promise<void>
}

let activeController: AbortController | null = null

export const useBrowseStore = create<BrowseState & BrowseActions>(
  (set, get) => ({
    filters: EMPTY_FILTERS,
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    results: [],
    facets: null,
    total: 0,
    loading: false,
    error: "",
    initialized: false,
    mobileFiltersOpen: false,

    hydrate: ({ filters, page, response }) =>
      set({
        filters,
        page,
        pageSize: response.page_size || DEFAULT_PAGE_SIZE,
        results: response.results,
        facets: response.facets ?? null,
        total: response.total,
        loading: false,
        error: "",
        initialized: true,
      }),

    replaceQuery: (filters, page) => set({ filters, page }),

    patchFilters: (partial) =>
      set((state) => ({ filters: { ...state.filters, ...partial }, page: 1 })),

    toggleValue: (key, value) =>
      set((state) => {
        const current = state.filters[key]
        const next = current.includes(value)
          ? current.filter((item) => item !== value)
          : [...current, value]
        return { filters: { ...state.filters, [key]: next }, page: 1 }
      }),

    toggleBench: (size) =>
      set((state) => {
        const current = state.filters.bench
        const next = current.includes(size)
          ? current.filter((item) => item !== size)
          : [...current, size].sort((a, b) => a - b)
        return { filters: { ...state.filters, bench: next }, page: 1 }
      }),

    setSort: (sort) =>
      set((state) => ({ filters: { ...state.filters, sort }, page: 1 })),

    setPage: (page) => set({ page: Math.max(1, page) }),

    clearAll: () => set({ filters: EMPTY_FILTERS, page: 1 }),

    setMobileFiltersOpen: (open) => set({ mobileFiltersOpen: open }),

    run: async () => {
      const { filters, page, pageSize } = get()
      activeController?.abort()
      const controller = new AbortController()
      activeController = controller
      set({ loading: true, error: "" })

      try {
        const response = await fetch("/api/browse", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...filtersToBrowseRequest(filters),
            page,
            page_size: pageSize,
            facets: true,
          }),
          signal: controller.signal,
        })
        const payload = (await response.json().catch(() => ({}))) as
          BrowseResponse | { error?: string }
        if (!response.ok) {
          throw new Error(
            ("error" in payload && payload.error) || "Browse request failed"
          )
        }
        const data = payload as BrowseResponse
        set({
          results: data.results,
          facets: data.facets ?? get().facets,
          total: data.total,
          pageSize: data.page_size || pageSize,
          loading: false,
        })
      } catch (caught) {
        if ((caught as Error).name === "AbortError") return
        set({
          loading: false,
          error:
            caught instanceof Error
              ? caught.message
              : "The browse request failed",
        })
      } finally {
        if (activeController === controller) activeController = null
      }
    },
  })
)
