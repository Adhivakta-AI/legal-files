"use client"

import {
  BookOpen,
  ListFilter,
  Menu,
  Moon,
  Search,
  Sparkles,
  Sun,
} from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useTheme } from "next-themes"
import type { ReactNode } from "react"

import {
  ResearchAccountMenu,
  type ResearchUser,
} from "@/components/research/research-account-menu"
import { Button } from "@/components/ui/button"

import styles from "./app-navbar.module.css"

const navItems = [
  { href: "/browse", label: "Browse", icon: BookOpen },
  { href: "/search", label: "Search", icon: Search },
  { href: "/ai-pro", label: "AI Pro", icon: Sparkles },
]

export function AppNavbar({
  user,
  context,
  mobileAction,
}: {
  user: ResearchUser
  context?: ReactNode
  mobileAction?: {
    label: string
    kind: "filters" | "menu"
    onClick: () => void
  }
}) {
  const pathname = usePathname()
  const { resolvedTheme, setTheme } = useTheme()
  const dark = resolvedTheme !== "light"
  const MobileIcon = mobileAction?.kind === "filters" ? ListFilter : Menu

  return (
    <header className={styles.header}>
      <Link href="/" className={styles.brand} aria-label="Lex Archives home">
        <span className={styles.brandMark}>LA</span>
        <span className={styles.brandCopy}>
          <strong>LEX ARCHIVES</strong>
          <span>INDIAN CASE-LAW INTELLIGENCE</span>
        </span>
      </Link>

      {context ? <div className={styles.context}>{context}</div> : null}

      <nav className={styles.nav} aria-label="Primary navigation">
        {navItems.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={styles.navLink}
            data-active={pathname === href}
            aria-current={pathname === href ? "page" : undefined}
            title={label}
          >
            <Icon size={14} /> <span>{label}</span>
          </Link>
        ))}
      </nav>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={styles.themeButton}
        onClick={() => setTheme(dark ? "light" : "dark")}
        aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
        title={dark ? "Light mode" : "Dark mode"}
      >
        {dark ? <Sun size={16} /> : <Moon size={16} />}
      </Button>

      {mobileAction ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={styles.mobileAction}
          onClick={mobileAction.onClick}
          aria-label={mobileAction.label}
          title={mobileAction.label}
        >
          <MobileIcon size={17} />
        </Button>
      ) : null}

      <ResearchAccountMenu user={user} />
    </header>
  )
}
