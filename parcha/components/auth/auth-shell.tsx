import Link from "next/link"
import type { ReactNode } from "react"

import styles from "./auth.module.css"

export function AuthShell({
  eyebrow,
  title,
  description,
  children,
  footer,
}: {
  eyebrow: string
  title: string
  description: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="Lex Archives home">
          <span>LA</span>
          <strong>LEX ARCHIVES</strong>
        </Link>
        <Link href="/" className={styles.homeLink}>
          Return home
        </Link>
      </header>

      <section className={styles.stage}>
        <div className={styles.card}>
          <div className={styles.heading}>
            <span>{eyebrow}</span>
            <h1>{title}</h1>
            <p>{description}</p>
          </div>
          {children}
          {footer ? <div className={styles.footer}>{footer}</div> : null}
        </div>
      </section>
    </main>
  )
}

