"use client"

import { AppNavbar } from "@/components/app-navbar"
import type { ResearchUser } from "@/components/research/research-account-menu"
import { countActiveFilters } from "@/lib/browse/url"

import { useBrowseStore } from "./store/browse-store"

export function BrowseHeader({ user }: { user: ResearchUser }) {
  const total = useBrowseStore((state) => state.total)
  const activeCount = useBrowseStore((state) =>
    countActiveFilters(state.filters)
  )
  const setOpen = useBrowseStore((state) => state.setMobileFiltersOpen)

  return (
    <AppNavbar
      user={user}
      context={<>{total.toLocaleString("en-IN")} judgments indexed</>}
      mobileAction={{
        label: `Open filters${activeCount ? ` (${activeCount} active)` : ""}`,
        kind: "filters",
        onClick: () => setOpen(true),
      }}
    />
  )
}
