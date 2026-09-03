import { create } from "zustand"
import { toast } from "sonner"

import type {
  QueryAnalysis,
  ResearchMode,
  ResearchResult,
  SearchChunk,
} from "@/lib/research/types"

import type { HistoryItem } from "../lib/history-storage"
import { runResearchStream } from "../lib/research-client"
import { initialStages, restoredStages, type StageMap } from "../lib/stage-meta"
import { useHistoryStore } from "./history-store"

const MIN_QUERY_LENGTH = 3
const MAX_QUERY_LENGTH = 3000

interface ResearchState {
  query: string
  mode: ResearchMode
  stages: StageMap
  analysis: QueryAnalysis | null
  sources: SearchChunk[]
  streamedAnswer: string
  result: ResearchResult | null
  error: string
  running: boolean
  hasSubmitted: boolean
  expandedCitationId: string | null
  citationPage: number
}

interface ResearchActions {
  setQuery: (query: string) => void
  setMode: (mode: ResearchMode) => void
  toggleCitation: (judgmentId: string) => void
  setExpandedCitation: (judgmentId: string | null) => void
  setCitationPage: (page: number) => void
  /** Runs the query currently in state against /api/research. */
  submit: () => Promise<void>
  /** Loads a stored session back into the workspace. */
  restore: (item: HistoryItem) => void
  /** Resets run state for a fresh query; keeps the selected mode. */
  reset: () => void
  /** Cancels any in-flight request (used on unmount). */
  abort: () => void
}

/**
 * Kept outside the store so it never triggers a re-render and survives
 * store updates. Only one research request runs at a time.
 */
let activeController: AbortController | null = null

const idleState: ResearchState = {
  query: "",
  mode: "search",
  stages: initialStages(),
  analysis: null,
  sources: [],
  streamedAnswer: "",
  result: null,
  error: "",
  running: false,
  hasSubmitted: false,
  expandedCitationId: null,
  citationPage: 1,
}

export const useResearchStore = create<ResearchState & ResearchActions>(
  (set, get) => ({
    ...idleState,

    setQuery: (query) => set({ query: query.slice(0, MAX_QUERY_LENGTH) }),

    setMode: (mode) => set({ mode }),

    toggleCitation: (judgmentId) =>
      set((state) => ({
        expandedCitationId:
          state.expandedCitationId === judgmentId ? null : judgmentId,
      })),

    setExpandedCitation: (judgmentId) =>
      set({ expandedCitationId: judgmentId }),

    setCitationPage: (page) =>
      set({
        citationPage: Math.max(1, Math.floor(page)),
        expandedCitationId: null,
      }),

    abort: () => {
      activeController?.abort()
      activeController = null
    },

    reset: () => {
      activeController?.abort()
      activeController = null
      set({
        query: "",
        stages: initialStages(),
        analysis: null,
        sources: [],
        streamedAnswer: "",
        result: null,
        error: "",
        running: false,
        hasSubmitted: false,
        expandedCitationId: null,
        citationPage: 1,
      })
    },

    restore: (item) => {
      activeController?.abort()
      activeController = null
      set({
        query: "",
        mode: item.mode,
        result: item.result,
        analysis: item.result.analysis,
        streamedAnswer: item.result.answer,
        sources: [],
        error: "",
        running: false,
        hasSubmitted: true,
        expandedCitationId: null,
        citationPage: 1,
        stages: restoredStages(),
      })
    },

    submit: async () => {
      const { query, mode, running } = get()
      const submittedQuery = query.trim()
      if (submittedQuery.length < MIN_QUERY_LENGTH || running) return

      activeController?.abort()
      const controller = new AbortController()
      activeController = controller
      const toastId = "lex-research-run"

      set({
        running: true,
        hasSubmitted: true,
        stages: initialStages(),
        analysis: null,
        sources: [],
        streamedAnswer: "",
        result: null,
        error: "",
        citationPage: 1,
      })
      toast.loading(mode === "search" ? "Searching cases" : "Synthesizing", {
        id: toastId,
        description:
          submittedQuery.length > 110
            ? `${submittedQuery.slice(0, 107)}...`
            : submittedQuery,
      })

      try {
        await runResearchStream({
          query: submittedQuery,
          mode,
          signal: controller.signal,
          onEvent: (event) => {
            switch (event.type) {
              case "stage":
                set((state) => ({
                  stages: {
                    ...state.stages,
                    [event.stage]: {
                      status: event.status,
                      message: event.message,
                      detail: event.detail,
                      elapsed_ms: event.elapsed_ms,
                    },
                  },
                }))
                break
              case "analysis":
                set({ analysis: event.analysis })
                break
              case "sources":
                set({ sources: event.chunks })
                break
              case "answer_delta":
                set((state) => ({
                  streamedAnswer: state.streamedAnswer + event.delta,
                }))
                break
              case "result":
                set({
                  result: event.result,
                  streamedAnswer: event.result.answer,
                  query: "",
                  citationPage: 1,
                })
                useHistoryStore
                  .getState()
                  .addResult(event.result, submittedQuery, mode)
                toast.success(
                  mode === "search" ? "Cases ready" : "Research ready",
                  {
                    id: toastId,
                    description:
                      mode === "search"
                        ? `${event.result.citations.length} ranked authorities found`
                        : `${event.result.citations.length} citations verified`,
                  }
                )
                break
              case "error":
                set({ error: event.message })
                toast.error("Research failed", {
                  id: toastId,
                  description: event.message,
                })
                break
            }
          },
        })
      } catch (caught) {
        if ((caught as Error).name !== "AbortError") {
          set({
            error:
              caught instanceof Error
                ? caught.message
                : "The research request failed",
          })
          toast.error("Research failed", {
            id: toastId,
            description:
              caught instanceof Error
                ? caught.message
                : "The research request failed",
          })
        }
      } finally {
        if (activeController === controller) {
          activeController = null
          set({ running: false })
        }
      }
    },
  })
)
