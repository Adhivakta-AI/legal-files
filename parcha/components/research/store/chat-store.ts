import { create } from "zustand"
import { toast } from "sonner"

import type {
  LegalSearchChunk,
  QueryAnalysis,
  ResearchChatMessage,
  ResearchResult,
  ResearchThread,
  ResearchThreadSummary,
  SearchChunk,
} from "@/lib/research/types"

import { runResearchStream } from "../lib/research-client"
import { initialStages, type StageMap } from "../lib/stage-meta"

const MIN_QUERY_LENGTH = 3
const MAX_QUERY_LENGTH = 3000

interface ChatState {
  threads: ResearchThreadSummary[]
  activeThreadId: string | null
  messages: ResearchChatMessage[]
  query: string
  stages: StageMap
  analysis: QueryAnalysis | null
  sources: SearchChunk[]
  legalSources: LegalSearchChunk[]
  streamedAnswer: string
  pendingQuery: string
  currentResult: ResearchResult | null
  error: string
  running: boolean
  loadingThread: boolean
  sidebarOpen: boolean
}

interface ChatActions {
  initialize: (threads: ResearchThreadSummary[]) => void
  setQuery: (query: string) => void
  setSidebarOpen: (open: boolean) => void
  newChat: (pushHistory?: boolean) => void
  loadThread: (threadId: string, pushHistory?: boolean) => Promise<void>
  deleteThread: (threadId: string) => Promise<void>
  submit: () => Promise<void>
  abort: () => void
}

let activeController: AbortController | null = null
let activeLoad = 0

const runState = {
  stages: initialStages(),
  analysis: null,
  sources: [],
  legalSources: [],
  streamedAnswer: "",
  pendingQuery: "",
  currentResult: null,
  error: "",
  running: false,
}

function conversationUrl(threadId?: string): string {
  return threadId ? `/ai-pro?thread=${encodeURIComponent(threadId)}` : "/ai-pro"
}

function updateBrowserUrl(threadId?: string, replace = false) {
  if (typeof window === "undefined") return
  const method = replace ? "replaceState" : "pushState"
  window.history[method](null, "", conversationUrl(threadId))
}

export const useChatStore = create<ChatState & ChatActions>((set, get) => ({
  threads: [],
  activeThreadId: null,
  messages: [],
  query: "",
  loadingThread: false,
  sidebarOpen: false,
  ...runState,

  initialize: (threads) => set({ threads }),

  setQuery: (query) => set({ query: query.slice(0, MAX_QUERY_LENGTH) }),

  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),

  abort: () => {
    const pendingQuery = get().pendingQuery
    activeController?.abort()
    activeController = null
    set((state) => ({
      running: false,
      pendingQuery: "",
      query: state.query || pendingQuery,
    }))
  },

  newChat: (pushHistory = true) => {
    activeController?.abort()
    activeController = null
    activeLoad += 1
    set({
      activeThreadId: null,
      messages: [],
      query: "",
      loadingThread: false,
      sidebarOpen: false,
      ...runState,
    })
    if (pushHistory) updateBrowserUrl()
  },

  loadThread: async (threadId, pushHistory = true) => {
    if (get().activeThreadId === threadId && get().messages.length) {
      set({ sidebarOpen: false })
      return
    }
    activeController?.abort()
    activeController = null
    const loadId = ++activeLoad
    set({
      activeThreadId: threadId,
      messages: [],
      query: "",
      loadingThread: true,
      sidebarOpen: false,
      ...runState,
    })
    if (pushHistory) updateBrowserUrl(threadId)
    try {
      const response = await fetch(
        `/api/research/threads/${encodeURIComponent(threadId)}`,
        { headers: { accept: "application/json" }, cache: "no-store" }
      )
      const payload = (await response.json().catch(() => ({}))) as {
        thread?: ResearchThread
        error?: string
      }
      if (!response.ok || !payload.thread) {
        throw new Error(payload.error ?? "Conversation could not be loaded")
      }
      if (loadId !== activeLoad) return
      set({
        activeThreadId: payload.thread.id,
        messages: payload.thread.messages,
        loadingThread: false,
      })
    } catch (error) {
      if (loadId !== activeLoad) return
      const message =
        error instanceof Error
          ? error.message
          : "Conversation could not be loaded"
      set({ activeThreadId: null, loadingThread: false, error: message })
      updateBrowserUrl(undefined, true)
      toast.error("Could not open conversation", { description: message })
    }
  },

  deleteThread: async (threadId) => {
    const response = await fetch(
      `/api/research/threads/${encodeURIComponent(threadId)}`,
      { method: "DELETE" }
    )
    if (!response.ok && response.status !== 404) {
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string
      }
      toast.error("Could not delete conversation", {
        description: payload.error ?? `Request failed (${response.status})`,
      })
      return
    }
    const wasActive = get().activeThreadId === threadId
    set((state) => ({
      threads: state.threads.filter((thread) => thread.id !== threadId),
    }))
    if (wasActive) get().newChat()
  },

  submit: async () => {
    const { query, running, activeThreadId } = get()
    const submittedQuery = query.trim()
    if (submittedQuery.length < MIN_QUERY_LENGTH || running) return

    activeController?.abort()
    const controller = new AbortController()
    activeController = controller
    const toastId = "lex-ai-pro-chat"
    set({
      query: "",
      pendingQuery: submittedQuery,
      running: true,
      stages: initialStages(),
      analysis: null,
      sources: [],
      legalSources: [],
      streamedAnswer: "",
      currentResult: null,
      error: "",
    })
    toast.loading("Researching your question", {
      id: toastId,
      description:
        submittedQuery.length > 100
          ? `${submittedQuery.slice(0, 97)}…`
          : submittedQuery,
    })

    try {
      await runResearchStream({
        query: submittedQuery,
        mode: "ai_pro",
        threadId: activeThreadId ?? undefined,
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
              set({
                sources: event.chunks,
                legalSources: event.legal_chunks ?? [],
              })
              break
            case "answer_delta":
              set((state) => ({
                streamedAnswer: state.streamedAnswer + event.delta,
              }))
              break
            case "result": {
              const createdAt = new Date().toISOString()
              const messages: ResearchChatMessage[] = [
                {
                  id: crypto.randomUUID(),
                  role: "user",
                  content: submittedQuery,
                  created_at: createdAt,
                },
                {
                  id: crypto.randomUUID(),
                  role: "assistant",
                  content: event.result.answer,
                  created_at: createdAt,
                  result: event.result,
                },
              ]
              set((state) => ({
                messages: [...state.messages, ...messages],
                currentResult: event.result,
                streamedAnswer: event.result.answer,
                pendingQuery: "",
                activeThreadId: event.thread?.id ?? state.activeThreadId,
                threads: event.thread
                  ? [
                      event.thread,
                      ...state.threads.filter(
                        (thread) => thread.id !== event.thread?.id
                      ),
                    ]
                  : state.threads,
              }))
              if (event.thread) {
                updateBrowserUrl(event.thread.id, Boolean(activeThreadId))
              }
              const grounded = event.result.synthesis_status === "grounded"
              const notify = grounded ? toast.success : toast.warning
              notify(
                grounded ? "Grounded answer ready" : "Verified passages ready",
                {
                  id: toastId,
                  description: grounded
                    ? `${event.result.citations.length} verified citation${event.result.citations.length === 1 ? "" : "s"}`
                    : "The generated synthesis did not pass grounding checks.",
                }
              )
              break
            }
            case "error":
              set({ error: event.message, query: submittedQuery })
              toast.error("Research failed", {
                id: toastId,
                description: event.message,
              })
              break
          }
        },
      })
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        const message =
          error instanceof Error ? error.message : "The research request failed"
        set({ error: message, query: submittedQuery })
        toast.error("Research failed", { id: toastId, description: message })
      }
    } finally {
      if (activeController === controller) {
        activeController = null
        set({ running: false })
      }
    }
  },
}))
