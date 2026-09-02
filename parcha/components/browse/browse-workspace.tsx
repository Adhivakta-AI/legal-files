"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useRef, useState } from "react"

import type { ResearchUser } from "@/components/research/research-account-menu"
import type { BrowseFilters, BrowseResponse } from "@/lib/browse/types"
import { filtersToSearchParams, searchParamsToState } from "@/lib/browse/url"

import { BrowseHeader } from "./browse-header"
import styles from "./browse.module.css"
import { FilterRail } from "./filter-rail"
import { ResultList } from "./result-list"
import { useBrowseStore } from "./store/browse-store"

export interface BrowseInitialState {
  filters: BrowseFilters
  page: number
  response: BrowseResponse
}

const SYNC_DEBOUNCE_MS = 300

export function BrowseWorkspace({
  user,
  initialState,
}: {
  user: ResearchUser
  initialState: BrowseInitialState
}) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const replaceQuery = useBrowseStore((state) => state.replaceQuery)
  const run = useBrowseStore((state) => state.run)
  const initialized = useBrowseStore((state) => state.initialized)
  const filters = useBrowseStore((state) => state.filters)
  const page = useBrowseStore((state) => state.page)

  const syncedKey = useRef<string | null>(
    filtersToSearchParams(initialState.filters, initialState.page).toString()
  )

  // Seed the store from the server-rendered payload exactly once.
  useState(() => {
    useBrowseStore.getState().hydrate(initialState)
    return true
  })

  // store -> URL + refetch
  useEffect(() => {
    if (!initialized) return
    const key = filtersToSearchParams(filters, page).toString()
    if (key === syncedKey.current) return
    const timer = window.setTimeout(() => {
      syncedKey.current = key
      router.replace(key ? `/browse?${key}` : "/browse", { scroll: false })
      void run()
    }, SYNC_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [initialized, filters, page, router, run])

  // URL -> store (browser back / forward)
  useEffect(() => {
    if (!initialized) return
    const key = searchParams.toString()
    if (key === syncedKey.current) return
    syncedKey.current = key
    const next = searchParamsToState(new URLSearchParams(key))
    replaceQuery(next.filters, next.page)
    void run()
  }, [initialized, searchParams, replaceQuery, run])

  return (
    <div className={styles.root}>
      <BrowseHeader user={user} />
      <div className={styles.shell}>
        <FilterRail />
        <ResultList />
      </div>
    </div>
  )
}
