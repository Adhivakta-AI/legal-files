import "server-only"

import { requiredServerSetting, serverSetting } from "@/lib/server-env"

import type { BrowseRequest, BrowseResponse, JudgmentSummary } from "./types"

const DEFAULT_SEARCH_API =
  "https://parcha-search-api.politestranger18.workers.dev/api/search"

function browseServiceUrl(): string {
  const value = serverSetting("SEARCH_API_URL") ?? DEFAULT_SEARCH_API
  const url = new URL(value)
  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    throw new Error("SEARCH_API_URL must use HTTPS")
  }
  url.pathname = "/api/browse"
  url.search = ""
  return url.toString()
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : []
}

function toSummary(value: unknown): JudgmentSummary | null {
  if (typeof value !== "object" || value === null) return null
  const row = value as Record<string, unknown>
  if (typeof row.judgment_id !== "string" || typeof row.title !== "string") {
    return null
  }
  return {
    judgment_id: row.judgment_id,
    title: row.title,
    petitioner: typeof row.petitioner === "string" ? row.petitioner : null,
    respondent: typeof row.respondent === "string" ? row.respondent : null,
    citation: typeof row.citation === "string" ? row.citation : null,
    neutral_citation:
      typeof row.neutral_citation === "string" ? row.neutral_citation : null,
    cnr: typeof row.cnr === "string" ? row.cnr : null,
    court: typeof row.court === "string" ? row.court : "Supreme Court of India",
    decision_date:
      typeof row.decision_date === "string" ? row.decision_date : null,
    decision_year:
      typeof row.decision_year === "number" ? row.decision_year : null,
    disposal_nature:
      typeof row.disposal_nature === "string" ? row.disposal_nature : null,
    era: typeof row.era === "string" ? row.era : null,
    bench_size: typeof row.bench_size === "number" ? row.bench_size : null,
    available_languages: normalizeStringArray(row.available_languages),
    judges: normalizeStringArray(row.judges),
    pdf_url: typeof row.pdf_url === "string" ? row.pdf_url : "",
    pdf_key: typeof row.pdf_key === "string" ? row.pdf_key : null,
  }
}

/** Calls the Cloudflare worker's /api/browse with the service token. */
export async function fetchBrowse(
  request: BrowseRequest,
  signal?: AbortSignal
): Promise<BrowseResponse> {
  const startedAt = performance.now()
  const response = await fetch(browseServiceUrl(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${requiredServerSetting("SEARCH_SERVICE_TOKEN")}`,
    },
    body: JSON.stringify(request),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
      : AbortSignal.timeout(20_000),
    cache: "no-store",
  })

  const payload = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >
  console.info(
    JSON.stringify({
      event: "search_service.response",
      operation: "browse",
      status: response.status,
      duration_ms: Math.round(performance.now() - startedAt),
    })
  )

  if (!response.ok) {
    const message =
      typeof payload.error === "string"
        ? payload.error
        : "Browse request failed"
    throw new Error(`Browse API returned ${response.status}: ${message}`)
  }

  const rawResults = Array.isArray(payload.results) ? payload.results : []
  return {
    page: typeof payload.page === "number" ? payload.page : 1,
    page_size: typeof payload.page_size === "number" ? payload.page_size : 20,
    total: typeof payload.total === "number" ? payload.total : 0,
    sort: (typeof payload.sort === "string"
      ? payload.sort
      : "recent") as BrowseResponse["sort"],
    results: rawResults
      .map(toSummary)
      .filter((row): row is JudgmentSummary => row !== null),
    facets: (payload.facets as BrowseResponse["facets"]) ?? undefined,
  }
}

export async function fetchJudgment(
  id: string,
  signal?: AbortSignal
): Promise<JudgmentSummary | null> {
  const { results } = await fetchBrowse({ ids: [id], page_size: 1 }, signal)
  return results[0] ?? null
}
