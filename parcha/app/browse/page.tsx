import type { Metadata } from "next"
import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { Suspense } from "react"

import {
  BrowseWorkspace,
  type BrowseInitialState,
} from "@/components/browse/browse-workspace"
import { fetchBrowse } from "@/lib/browse/client"
import { DEFAULT_PAGE_SIZE, EMPTY_FILTERS } from "@/lib/browse/types"
import { filtersToBrowseRequest, searchParamsToState } from "@/lib/browse/url"
import { getAuth } from "@/lib/auth"

export const metadata: Metadata = {
  title: "Browse Judgments — Lex Archives",
  description:
    "Filter the Indian Supreme Court judgment archive by year, bench, disposal, judge, citation, and more.",
}
export const dynamic = "force-dynamic"

type SearchParams = Record<string, string | string[] | undefined>

function toURLSearchParams(input: SearchParams): URLSearchParams {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(input)) {
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item)
    } else if (typeof value === "string") {
      params.set(key, value)
    }
  }
  return params
}

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const session = await getAuth().api.getSession({ headers: await headers() })
  if (!session) redirect("/sign-in?callbackURL=/browse")

  const { filters, page } = searchParamsToState(
    toURLSearchParams(await searchParams)
  )

  let initialState: BrowseInitialState
  try {
    const response = await fetchBrowse({
      ...filtersToBrowseRequest(filters),
      page,
      page_size: DEFAULT_PAGE_SIZE,
      facets: true,
    })
    initialState = { filters, page, response }
  } catch {
    initialState = {
      filters: EMPTY_FILTERS,
      page: 1,
      response: {
        page: 1,
        page_size: DEFAULT_PAGE_SIZE,
        total: 0,
        sort: "recent",
        results: [],
      },
    }
  }

  return (
    <Suspense fallback={null}>
      <BrowseWorkspace
        user={{
          id: session.user.id,
          name: session.user.name,
          email: session.user.email,
          emailVerified: session.user.emailVerified,
          image: session.user.image,
        }}
        initialState={initialState}
      />
    </Suspense>
  )
}
