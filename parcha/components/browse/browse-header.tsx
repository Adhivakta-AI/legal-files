"use client"

import { SlidersHorizontal } from "lucide-react"
import Link from "next/link"

import {
  ResearchAccountMenu,
  type ResearchUser,
} from "@/components/research/research-account-menu"
import { countActiveFilters } from "@/lib/browse/url"

import styles from "./browse.module.css"
import { useBrowseStore } from "./store/browse-store"

export function BrowseHeader({ user }: { user: ResearchUser }) {
  const total = useBrowseStore((state) => state.total)
  const activeCount = useBrowseStore((state) =>
    countActiveFilters(state.filters)
  )
  const setOpen = useBrowseStore((state) => state.setMobileFiltersOpen)

  return (
    <header className={styles.header}>
      <Link href="/" className={styles.brand} aria-label="Lex Archives home">
        <span className={styles.brandMark}>LA</span>
        <strong>LEX ARCHIVES</strong>
      </Link>

      <button
        type="button"
        className={styles.mobileFilterToggle}
        onClick={() => setOpen(true)}
      >
        <SlidersHorizontal size={13} /> FILTERS
        {activeCount ? ` · ${activeCount}` : ""}
      </button>

      <span className={styles.headerCount}>
        {total.toLocaleString("en-IN")} JUDGMENTS INDEXED
      </span>

      <nav className={styles.headerNav}>
        <Link href="/browse" data-active="true">
          BROWSE
        </Link>
        <Link href="/research">RESEARCH</Link>
      </nav>

      <ResearchAccountMenu user={user} />
    </header>
  )
}
