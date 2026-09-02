import { EMPTY_FILTERS, type BrowseFilters, type BrowseSort } from "./types"

const SORTS: BrowseSort[] = ["relevance", "recent", "oldest", "title"]

const TEXT_KEYS = {
  q: "q",
  party: "party",
  reporter: "reporter",
  neutral_citation: "nc",
} as const

const LIST_KEYS = {
  judges: "judge",
  disposal: "disposal",
  era: "era",
  language: "lang",
  court: "court",
} as const

function toInt(value: string | null): number | null {
  if (!value) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) ? parsed : null
}

export function filtersToSearchParams(
  filters: BrowseFilters,
  page: number
): URLSearchParams {
  const params = new URLSearchParams()

  for (const [key, param] of Object.entries(TEXT_KEYS)) {
    const value = filters[key as keyof typeof TEXT_KEYS]
    if (value) params.set(param, value)
  }
  for (const [key, param] of Object.entries(LIST_KEYS)) {
    for (const value of filters[key as keyof typeof LIST_KEYS]) {
      params.append(param, value)
    }
  }
  if (filters.year_from !== null) params.set("yf", String(filters.year_from))
  if (filters.year_to !== null) params.set("yt", String(filters.year_to))
  if (filters.date_from) params.set("df", filters.date_from)
  if (filters.date_to) params.set("dt", filters.date_to)
  for (const size of filters.bench) params.append("bench", String(size))
  if (filters.sort !== "recent") params.set("sort", filters.sort)
  if (page > 1) params.set("p", String(page))

  return params
}

export function searchParamsToState(params: URLSearchParams): {
  filters: BrowseFilters
  page: number
} {
  const sortParam = params.get("sort")
  const filters: BrowseFilters = {
    ...EMPTY_FILTERS,
    q: params.get("q") ?? "",
    party: params.get("party") ?? "",
    reporter: params.get("reporter") ?? "",
    neutral_citation: params.get("nc") ?? "",
    year_from: toInt(params.get("yf")),
    year_to: toInt(params.get("yt")),
    date_from: params.get("df") ?? "",
    date_to: params.get("dt") ?? "",
    bench: params
      .getAll("bench")
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isInteger(value)),
    judges: params.getAll("judge"),
    disposal: params.getAll("disposal"),
    era: params.getAll("era"),
    language: params.getAll("lang"),
    court: params.getAll("court"),
    sort:
      sortParam && SORTS.includes(sortParam as BrowseSort)
        ? (sortParam as BrowseSort)
        : "recent",
  }
  const page = Math.max(1, toInt(params.get("p")) ?? 1)
  return { filters, page }
}

export function filtersToBrowseRequest(filters: BrowseFilters) {
  return {
    q: filters.q || undefined,
    party: filters.party || undefined,
    reporter: filters.reporter || undefined,
    neutral_citation: filters.neutral_citation || undefined,
    year_from: filters.year_from ?? undefined,
    year_to: filters.year_to ?? undefined,
    date_from: filters.date_from || undefined,
    date_to: filters.date_to || undefined,
    judges: filters.judges,
    disposal: filters.disposal,
    era: filters.era,
    language: filters.language,
    court: filters.court,
    bench: filters.bench,
    sort: filters.sort,
  }
}

export function countActiveFilters(filters: BrowseFilters): number {
  let count = 0
  for (const key of Object.keys(TEXT_KEYS) as (keyof typeof TEXT_KEYS)[]) {
    if (filters[key]) count += 1
  }
  for (const key of Object.keys(LIST_KEYS) as (keyof typeof LIST_KEYS)[]) {
    count += filters[key].length
  }
  if (filters.year_from !== null || filters.year_to !== null) count += 1
  if (filters.date_from || filters.date_to) count += 1
  count += filters.bench.length
  return count
}
