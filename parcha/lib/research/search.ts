import "server-only"

import { requiredServerSetting, serverSetting } from "@/lib/server-env"

import type { JudgmentContext, LegalSearchChunk, SearchChunk } from "./types"

const DEFAULT_SEARCH_API =
  "https://parcha-search-api.politestranger18.workers.dev/api/search"

interface SearchResponse {
  results?: unknown
  error?: unknown
}

function searchApiUrl(): string {
  const value = serverSetting("SEARCH_API_URL") ?? DEFAULT_SEARCH_API
  const url = new URL(value)
  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    throw new Error("SEARCH_API_URL must use HTTPS")
  }
  return url.toString()
}

function searchServiceUrl(
  pathname: "/api/search" | "/api/context" | "/api/legal-search"
): string {
  const url = new URL(searchApiUrl())
  url.pathname = pathname
  url.search = ""
  return url.toString()
}

function isLegalSearchChunk(value: unknown): value is LegalSearchChunk {
  if (typeof value !== "object" || value === null) return false
  const chunk = value as Partial<LegalSearchChunk>
  return (
    typeof chunk.chunk_id === "string" &&
    typeof chunk.document_id === "string" &&
    typeof chunk.unit_id === "string" &&
    typeof chunk.document_title === "string" &&
    typeof chunk.short_title === "string" &&
    (chunk.source_kind === "statute" || chunk.source_kind === "constitution") &&
    (chunk.unit_kind === "preamble" ||
      chunk.unit_kind === "article" ||
      chunk.unit_kind === "section" ||
      chunk.unit_kind === "schedule_page") &&
    typeof chunk.unit_number === "string" &&
    typeof chunk.heading === "string" &&
    typeof chunk.part_index === "number" &&
    typeof chunk.chunk_text === "string" &&
    typeof chunk.source_url === "string" &&
    typeof chunk.canonical_url === "string" &&
    typeof chunk.authority === "string" &&
    typeof chunk.rrf_score === "number" &&
    typeof chunk.direct_match === "boolean"
  )
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
  order,
  titleQuery,
  signal,
}: {
  query: string
  limit: number
  yearFrom?: number
  yearTo?: number
  order: "relevance" | "recent"
  titleQuery?: string
  signal?: AbortSignal
}): Promise<SearchChunk[]> {
  const startedAt = performance.now()
  const response = await fetch(searchServiceUrl("/api/search"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${requiredServerSetting("SEARCH_SERVICE_TOKEN")}`,
    },
    body: JSON.stringify({
      query,
      limit,
      ...(yearFrom ? { year_from: yearFrom } : {}),
      ...(yearTo ? { year_to: yearTo } : {}),
      sort: order,
      ...(titleQuery ? { title_query: titleQuery } : {}),
    }),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
      : AbortSignal.timeout(30_000),
    cache: "no-store",
  })

  const payload = (await response.json().catch(() => ({}))) as SearchResponse
  console.info(
    JSON.stringify({
      event: "search_service.response",
      operation: "search",
      status: response.status,
      duration_ms: Math.round(performance.now() - startedAt),
    })
  )
  if (!response.ok) {
    const message =
      typeof payload.error === "string"
        ? payload.error
        : "Search request failed"
    throw new Error(`Search API returned ${response.status}: ${message}`)
  }
  if (!Array.isArray(payload.results))
    throw new Error("Search API returned an invalid result set")
  return payload.results.filter(isSearchChunk)
}

function capChunksPerJudgment(
  chunks: SearchChunk[],
  maxPerJudgment = 2
): SearchChunk[] {
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
  maxPerJudgment = 2,
  yearFrom,
  yearTo,
  order = "relevance",
  widenYearFilter = true,
  titleQuery,
  signal,
}: {
  query: string
  originalQuery: string
  limit?: number
  maxPerJudgment?: number
  yearFrom?: number
  yearTo?: number
  order?: "relevance" | "recent"
  widenYearFilter?: boolean
  titleQuery?: string
  signal?: AbortSignal
}): Promise<{ chunks: SearchChunk[]; widened: boolean }> {
  let chunks = await requestSearch({
    query,
    limit,
    yearFrom,
    yearTo,
    order,
    titleQuery,
    signal,
  })
  let widened = false

  if (widenYearFilter && chunks.length === 0 && (yearFrom || yearTo)) {
    chunks = await requestSearch({ query, limit, order, titleQuery, signal })
    widened = true
  }

  if (chunks.length < 5 && originalQuery !== query) {
    const originals = await requestSearch({
      query: originalQuery,
      limit: Math.max(6, limit - chunks.length),
      ...(widened ? {} : { yearFrom, yearTo }),
      order,
      titleQuery,
      signal,
    })
    const byChunk = new Map(chunks.map((chunk) => [chunk.chunk_id, chunk]))
    originals.forEach((chunk) => {
      if (!byChunk.has(chunk.chunk_id)) byChunk.set(chunk.chunk_id, chunk)
    })
    chunks = [...byChunk.values()]
  }

  return {
    chunks: capChunksPerJudgment(chunks, maxPerJudgment).slice(0, limit),
    widened,
  }
}

function isJudgmentContext(value: unknown): value is JudgmentContext {
  if (typeof value !== "object" || value === null) return false
  const context = value as Partial<JudgmentContext>
  return (
    typeof context.judgment_id === "string" &&
    Array.isArray(context.chunks) &&
    context.chunks.every(isSearchChunk) &&
    typeof context.truncated === "boolean" &&
    typeof context.included_characters === "number"
  )
}

export async function retrieveJudgmentContexts({
  judgmentIds,
  signal,
}: {
  judgmentIds: string[]
  signal?: AbortSignal
}): Promise<JudgmentContext[]> {
  if (judgmentIds.length === 0) return []
  const startedAt = performance.now()
  const response = await fetch(searchServiceUrl("/api/context"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${requiredServerSetting("SEARCH_SERVICE_TOKEN")}`,
    },
    body: JSON.stringify({
      judgment_ids: [...new Set(judgmentIds)].slice(0, 5),
      max_chars_per_judgment: 80_000,
    }),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
      : AbortSignal.timeout(30_000),
    cache: "no-store",
  })
  const payload = (await response.json().catch(() => ({}))) as {
    contexts?: unknown
    error?: unknown
  }
  console.info(
    JSON.stringify({
      event: "search_service.response",
      operation: "judgment_context",
      status: response.status,
      duration_ms: Math.round(performance.now() - startedAt),
    })
  )
  if (!response.ok) {
    const message =
      typeof payload.error === "string"
        ? payload.error
        : "Context request failed"
    throw new Error(
      `Search context API returned ${response.status}: ${message}`
    )
  }
  if (!Array.isArray(payload.contexts)) {
    throw new Error("Search context API returned an invalid context set")
  }
  return payload.contexts.filter(isJudgmentContext)
}

export async function retrieveLegalChunks({
  query,
  limit = 12,
  signal,
}: {
  query: string
  limit?: number
  signal?: AbortSignal
}): Promise<LegalSearchChunk[]> {
  const startedAt = performance.now()
  const response = await fetch(searchServiceUrl("/api/legal-search"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${requiredServerSetting("SEARCH_SERVICE_TOKEN")}`,
    },
    body: JSON.stringify({ query, limit }),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
      : AbortSignal.timeout(30_000),
    cache: "no-store",
  })
  const payload = (await response.json().catch(() => ({}))) as {
    results?: unknown
    error?: unknown
  }
  console.info(
    JSON.stringify({
      event: "search_service.response",
      operation: "legal_search",
      status: response.status,
      duration_ms: Math.round(performance.now() - startedAt),
    })
  )
  if (!response.ok) {
    const message =
      typeof payload.error === "string"
        ? payload.error
        : "Legal search request failed"
    throw new Error(`Legal search API returned ${response.status}: ${message}`)
  }
  if (!Array.isArray(payload.results)) {
    throw new Error("Legal search API returned an invalid result set")
  }
  return payload.results.filter(isLegalSearchChunk).slice(0, limit)
}
