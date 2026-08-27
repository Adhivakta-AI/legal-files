import "server-only"

import type { SearchChunk } from "./types"

const DEFAULT_SEARCH_API =
  "https://parcha-search-api.politestranger18.workers.dev/api/search"

interface SearchResponse {
  results?: unknown
  error?: unknown
}

function searchApiUrl(): string {
  const value = process.env.SEARCH_API_URL ?? DEFAULT_SEARCH_API
  const url = new URL(value)
  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    throw new Error("SEARCH_API_URL must use HTTPS")
  }
  return url.toString()
}

function isSearchChunk(value: unknown): value is SearchChunk {
  if (typeof value !== "object" || value === null) return false
  const chunk = value as Partial<SearchChunk>
  return (
    typeof chunk.judgment_id === "string" &&
    typeof chunk.chunk_id === "string" &&
    typeof chunk.title === "string" &&
    typeof chunk.chunk_text === "string" &&
    typeof chunk.pdf_url === "string" &&
    typeof chunk.pdf_page === "number" &&
    typeof chunk.rrf_score === "number"
  )
}

async function requestSearch({
  query,
  limit,
  yearFrom,
  yearTo,
  signal,
}: {
  query: string
  limit: number
  yearFrom?: number
  yearTo?: number
  signal?: AbortSignal
}): Promise<SearchChunk[]> {
  const response = await fetch(searchApiUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query,
      limit,
      ...(yearFrom ? { year_from: yearFrom } : {}),
      ...(yearTo ? { year_to: yearTo } : {}),
    }),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
      : AbortSignal.timeout(30_000),
    cache: "no-store",
  })

  const payload = (await response.json().catch(() => ({}))) as SearchResponse
  if (!response.ok) {
    const message = typeof payload.error === "string" ? payload.error : "Search request failed"
    throw new Error(`Search API returned ${response.status}: ${message}`)
  }
  if (!Array.isArray(payload.results)) throw new Error("Search API returned an invalid result set")
  return payload.results.filter(isSearchChunk)
}

function capChunksPerJudgment(chunks: SearchChunk[], maxPerJudgment = 2): SearchChunk[] {
  const seen = new Map<string, number>()
  return chunks.filter((chunk) => {
    const count = seen.get(chunk.judgment_id) ?? 0
    if (count >= maxPerJudgment) return false
    seen.set(chunk.judgment_id, count + 1)
    return true
  })
}

export async function retrieveChunks({
  query,
  originalQuery,
  limit = 14,
  yearFrom,
  yearTo,
  signal,
}: {
  query: string
  originalQuery: string
  limit?: number
  yearFrom?: number
  yearTo?: number
  signal?: AbortSignal
}): Promise<{ chunks: SearchChunk[]; widened: boolean }> {
  let chunks = await requestSearch({ query, limit, yearFrom, yearTo, signal })
  let widened = false

  if (chunks.length === 0 && (yearFrom || yearTo)) {
    chunks = await requestSearch({ query, limit, signal })
    widened = true
  }

  if (chunks.length < 5 && originalQuery !== query) {
    const originals = await requestSearch({
      query: originalQuery,
      limit: Math.max(6, limit - chunks.length),
      ...(widened ? {} : { yearFrom, yearTo }),
      signal,
    })
    const byChunk = new Map(chunks.map((chunk) => [chunk.chunk_id, chunk]))
    originals.forEach((chunk) => {
      if (!byChunk.has(chunk.chunk_id)) byChunk.set(chunk.chunk_id, chunk)
    })
    chunks = [...byChunk.values()]
  }

  return { chunks: capChunksPerJudgment(chunks).slice(0, 12), widened }
}
