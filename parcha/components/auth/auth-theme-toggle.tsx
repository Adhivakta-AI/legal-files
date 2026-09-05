"use client"

import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"

import styles from "./auth.module.css"

export function AuthThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const dark = resolvedTheme !== "light"

  return (
    <button
      type="button"
      className={styles.themeButton}
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
    >
      {dark ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  )
}
