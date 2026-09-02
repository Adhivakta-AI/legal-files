import type { ResearchMode, ResearchResult } from "@/lib/research/types"

export const HISTORY_KEY = "lex-archives:research-history:v1"

const HISTORY_LIMIT = 20

export interface HistoryItem {
  id: string
  query: string
  mode: ResearchMode
  created_at: string
  result: ResearchResult
}

function normalizedMode(value: unknown): ResearchMode {
  return value === "search" ? "search" : "ai_pro"
}

export function safeHistory(value: string | null): HistoryItem[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (item): item is HistoryItem =>
          typeof item === "object" &&
          item !== null &&
          typeof item.id === "string" &&
          typeof item.query === "string" &&
          typeof item.created_at === "string" &&
          typeof item.result === "object" &&
          item.result !== null
      )
      .slice(0, HISTORY_LIMIT)
      .map((item) => {
        const mode = normalizedMode(item.mode)
        const legacyFallback = item.result.answer?.startsWith(
          "The generated synthesis did not pass"
        )
        return {
          ...item,
          mode,
          result: {
            ...item.result,
            mode,
            synthesis_status:
              item.result.synthesis_status ??
              (mode === "search"
                ? "not_requested"
                : legacyFallback
                  ? "retrieval_only"
                  : "grounded"),
          },
        }
      })
  } catch {
    return []
  }
}

export function readHistory(): HistoryItem[] {
  if (typeof window === "undefined") return []
  return safeHistory(window.localStorage.getItem(HISTORY_KEY))
}

export function writeHistory(items: HistoryItem[]): void {
  if (typeof window === "undefined") return
  window.localStorage.setItem(HISTORY_KEY, JSON.stringify(items))
}

export function buildHistoryItem(
  result: ResearchResult,
  query: string,
  mode: ResearchMode
): HistoryItem {
  return {
    id: crypto.randomUUID(),
    query,
    mode,
    created_at: new Date().toISOString(),
    result,
  }
}

export function mergeHistory(
  current: HistoryItem[],
  item: HistoryItem
): HistoryItem[] {
  return [item, ...current.filter((entry) => entry.query !== item.query)].slice(
    0,
    HISTORY_LIMIT
  )
}
