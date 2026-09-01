import type { Metadata } from "next"
import Link from "next/link"

import { SignUpForm } from "@/components/auth/auth-forms"
import { AuthShell } from "@/components/auth/auth-shell"
import { isGoogleAuthConfigured } from "@/lib/auth"

export const metadata: Metadata = { title: "Create account — Lex Archives" }
export const dynamic = "force-dynamic"

export default function SignUpPage() {
  return (
    <AuthShell
      eyebrow="Public registration"
      title="Create your account."
      description="Verify your email before entering the research workspace."
      footer={<>Already have an account? <Link href="/sign-in">Sign in</Link></>}
    >
      <SignUpForm googleEnabled={isGoogleAuthConfigured()} />
    </AuthShell>
  )
}
