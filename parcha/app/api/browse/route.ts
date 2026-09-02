import { fetchBrowse } from "@/lib/browse/client"
import type { BrowseRequest, BrowseSort } from "@/lib/browse/types"
import { getAuth } from "@/lib/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const SORTS: BrowseSort[] = ["relevance", "recent", "oldest", "title"]
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function str(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim().replace(/\s+/g, " ").slice(0, max)
  return trimmed || undefined
}

function strList(value: unknown, maxItems: number, itemMax = 160): string[] {
  if (!Array.isArray(value)) return []
  const out = new Set<string>()
  for (const item of value) {
    if (typeof item !== "string") continue
    const trimmed = item.trim().replace(/\s+/g, " ").slice(0, itemMax)
    if (trimmed) out.add(trimmed)
    if (out.size >= maxItems) break
  }
  return [...out]
}

function int(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value)) return undefined
  if (value < min || value > max) return undefined
  return value
}

export async function POST(request: Request): Promise<Response> {
  const session = await getAuth().api.getSession({ headers: request.headers })
  if (!session) {
    return Response.json(
      { error: "Authentication required" },
      { status: 401, headers: { "cache-control": "no-store" } }
    )
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const dateFrom = str(body.date_from, 10)
  const dateTo = str(body.date_to, 10)

  const browseRequest: BrowseRequest = {
    q: str(body.q, 200),
    party: str(body.party, 160),
    reporter: str(body.reporter, 60),
    neutral_citation: str(body.neutral_citation, 60),
    year_from: int(body.year_from, 1800, 2200),
    year_to: int(body.year_to, 1800, 2200),
    date_from: dateFrom && ISO_DATE.test(dateFrom) ? dateFrom : undefined,
    date_to: dateTo && ISO_DATE.test(dateTo) ? dateTo : undefined,
    judges: strList(body.judges, 20),
    disposal: strList(body.disposal, 40),
    era: strList(body.era, 10, 40),
    language: strList(body.language, 20, 8),
    court: strList(body.court, 10),
    bench: Array.isArray(body.bench)
      ? body.bench.filter(
          (value): value is number =>
            typeof value === "number" && Number.isInteger(value)
        )
      : [],
    sort:
      typeof body.sort === "string" && SORTS.includes(body.sort as BrowseSort)
        ? (body.sort as BrowseSort)
        : undefined,
    page: int(body.page, 1, 10_000) ?? 1,
    page_size: int(body.page_size, 1, 100) ?? 20,
    facets: body.facets === true,
  }

  try {
    const result = await fetchBrowse(browseRequest)
    return Response.json(result, { headers: { "cache-control": "no-store" } })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The browse request failed"
    return Response.json({ error: message }, { status: 502 })
  }
}
