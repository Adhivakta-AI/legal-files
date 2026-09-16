"use client"

import { AppNavbar } from "@/components/app-navbar"

import type { ResearchUser } from "./research-account-menu"
import { useHistoryStore } from "./store/history-store"

export function ResearchHeader({
  user,
  onOpenHistory,
  context,
}: {
  user: ResearchUser
  onOpenHistory?: () => void
  context?: "search" | "ai_pro"
}) {
  const openHistory = useHistoryStore((state) => state.setOpen)

  return (
    <AppNavbar
      user={user}
      context={
        <>
          {context === "ai_pro" ? (
            <>
              <span>Grounded AI</span>
              <span>BNS · BNSS · Constitution</span>
              <span>Supreme Court</span>
            </>
          ) : (
            <>
              <span>Indexed</span>
              <span>2.48M passages</span>
              <span>Supreme Court</span>
            </>
          )}
        </>
      }
      mobileAction={{
        label: "Open research history",
        kind: "menu",
        onClick: onOpenHistory ?? (() => openHistory(true)),
      }}
    />
  )
}
