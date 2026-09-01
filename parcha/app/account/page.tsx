import type { Metadata } from "next"
import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { AccountActions } from "@/components/auth/auth-forms"
import { AuthShell } from "@/components/auth/auth-shell"
import styles from "@/components/auth/auth.module.css"
import { getAuth } from "@/lib/auth"

export const metadata: Metadata = { title: "Account — Lex Archives" }
export const dynamic = "force-dynamic"

export default async function AccountPage() {
  const session = await getAuth().api.getSession({ headers: await headers() })
  if (!session) redirect("/sign-in?callbackURL=/account")

  return (
    <AuthShell
      eyebrow="Account security"
      title="Your account."
      description="Review the identity attached to this research session."
    >
      <dl className={styles.accountDetails}>
        <div><dt>Name</dt><dd>{session.user.name}</dd></div>
        <div><dt>Verified email</dt><dd>{session.user.email}</dd></div>
        <div><dt>User ID</dt><dd>{session.user.id}</dd></div>
      </dl>
      <AccountActions />
    </AuthShell>
  )
}
