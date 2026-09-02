export type BrowseSort = "relevance" | "recent" | "oldest" | "title"

export interface BrowseFilters {
  q: string
  party: string
  reporter: string
  neutral_citation: string
  year_from: number | null
  year_to: number | null
  date_from: string
  date_to: string
  judges: string[]
  disposal: string[]
  era: string[]
  language: string[]
  court: string[]
  bench: number[]
  sort: BrowseSort
}

export interface BrowseRequest extends Partial<BrowseFilters> {
  ids?: string[]
  page?: number
  page_size?: number
  facets?: boolean
}

export interface JudgmentSummary {
  judgment_id: string
  title: string
  petitioner: string | null
  respondent: string | null
  citation: string | null
  neutral_citation: string | null
  cnr: string | null
  court: string
  decision_date: string | null
  decision_year: number | null
  disposal_nature: string | null
  era: string | null
  bench_size: number | null
  available_languages: string[]
  judges: string[]
  pdf_url: string
  pdf_key: string | null
}

export interface FacetBucket {
  value: string | number
  count: number
}

export interface BrowseFacets {
  disposal_nature: FacetBucket[]
  era: FacetBucket[]
  decision_year: FacetBucket[]
  bench_size: FacetBucket[]
  judges: FacetBucket[]
}

export interface BrowseResponse {
  page: number
  page_size: number
  total: number
  sort: BrowseSort
  results: JudgmentSummary[]
  facets?: BrowseFacets
}

export const DEFAULT_PAGE_SIZE = 20

export const EMPTY_FILTERS: BrowseFilters = {
  q: "",
  party: "",
  reporter: "",
  neutral_citation: "",
  year_from: null,
  year_to: null,
  date_from: "",
  date_to: "",
  judges: [],
  disposal: [],
  era: [],
  language: [],
  court: [],
  bench: [],
  sort: "recent",
}

export const LANGUAGE_LABELS: Record<string, string> = {
  ENG: "English",
  HIN: "Hindi",
  PUN: "Punjabi",
  BEN: "Bengali",
  GUJ: "Gujarati",
  MAL: "Malayalam",
  TAM: "Tamil",
  MAR: "Marathi",
  URD: "Urdu",
  TEL: "Telugu",
  KAN: "Kannada",
  ORI: "Odia",
  ASM: "Assamese",
  NEP: "Nepali",
  SAN: "Sanskrit",
  KOK: "Konkani",
  GAR: "Garo",
  KHA: "Khasi",
  KAS: "Kashmiri",
}
