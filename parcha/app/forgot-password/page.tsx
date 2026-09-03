import type { Metadata } from "next"
import Link from "next/link"

import { ForgotPasswordForm } from "@/components/auth/auth-forms"
import { AuthShell } from "@/components/auth/auth-shell"

export const metadata: Metadata = { title: "Reset password — Lex Archives" }

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      eyebrow="Account recovery"
      title="Reset your password."
      description="We will send a single-use link that expires after one hour."
      footer={<Link href="/sign-in">Return to sign in</Link>}
    >
      <ForgotPasswordForm />
    </AuthShell>
  )
}
