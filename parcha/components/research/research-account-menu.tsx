"use client"

import { ChevronDown, LogOut, MonitorX, UserRound } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"

import { authClient } from "@/lib/auth-client"

import styles from "../app-navbar.module.css"

export interface ResearchUser {
  id: string
  name: string
  email: string
  emailVerified: boolean
  image?: string | null
}

export function ResearchAccountMenu({ user }: { user: ResearchUser }) {
  const router = useRouter()
  const menuRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", close)
    return () => document.removeEventListener("mousedown", close)
  }, [open])

  const leave = async (all: boolean) => {
    setBusy(true)
    if (all) await authClient.revokeSessions()
    await authClient.signOut()
    router.replace("/sign-in")
    router.refresh()
  }

  const initials =
    user.name
      .split(/\s+/)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "LA"

  return (
    <div className={styles.accountMenu} ref={menuRef}>
      <button
        type="button"
        className={styles.accountTrigger}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className={styles.accountAvatar}>{initials}</span>
        <span className={styles.accountName}>{user.name}</span>
        <ChevronDown size={13} />
      </button>
      {open ? (
        <div className={styles.accountPopover} role="menu">
          <div className={styles.accountIdentity}>
            <strong>{user.name}</strong>
            <span>{user.email}</span>
          </div>
          <Link href="/account" role="menuitem">
            <UserRound size={14} /> Account
          </Link>
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={() => void leave(false)}
          >
            <LogOut size={14} /> Sign out
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={() => void leave(true)}
          >
            <MonitorX size={14} /> Sign out all sessions
          </button>
        </div>
      ) : null}
    </div>
  )
}
