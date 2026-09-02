import { create } from "zustand"

import type { ResearchMode, ResearchResult } from "@/lib/research/types"

import {
  buildHistoryItem,
  mergeHistory,
  readHistory,
  writeHistory,
  type HistoryItem,
} from "../lib/history-storage"

interface HistoryStore {
  items: HistoryItem[]
  /** Mobile history drawer visibility. */
  open: boolean
  /** True once localStorage has been read on the client. */
  hydrated: boolean
  hydrate: () => void
  addResult: (result: ResearchResult, query: string, mode: ResearchMode) => void
  setOpen: (open: boolean) => void
}

export const useHistoryStore = create<HistoryStore>((set) => ({
  items: [],
  open: false,
  hydrated: false,

  hydrate: () => set({ items: readHistory(), hydrated: true }),

  addResult: (result, query, mode) =>
    set((state) => {
      const next = mergeHistory(
        state.items,
        buildHistoryItem(result, query, mode)
      )
      writeHistory(next)
      return { items: next }
    }),

  setOpen: (open) => set({ open }),
}))
