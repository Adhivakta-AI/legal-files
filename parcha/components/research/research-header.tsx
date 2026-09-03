"use client"

import { AppNavbar } from "@/components/app-navbar"

import type { ResearchUser } from "./research-account-menu"
import { useHistoryStore } from "./store/history-store"

export function ResearchHeader({ user }: { user: ResearchUser }) {
  const openHistory = useHistoryStore((state) => state.setOpen)

  return (
    <AppNavbar
      user={user}
      context={
        <>
          <span>Indexed</span>
          <span>2.48M passages</span>
          <span>Supreme Court</span>
        </>
      }
      mobileAction={{
        label: "Open research history",
        kind: "menu",
        onClick: () => openHistory(true),
      }}
    />
  )
}
