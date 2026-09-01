import type { Metadata } from "next"
import Link from "next/link"

import { SignInForm } from "@/components/auth/auth-forms"
import { AuthShell } from "@/components/auth/auth-shell"
import { isGoogleAuthConfigured } from "@/lib/auth"

export const metadata: Metadata = { title: "Sign in — Lex Archives" }

function safeCallback(value?: string) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/research"
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackURL?: string }>
}) {
  const { callbackURL } = await searchParams
  return (
    <AuthShell
      eyebrow="Secure research access"
      title="Welcome back."
      description="Sign in to use the citation-grounded research workspace."
      footer={<>New to Lex Archives? <Link href="/sign-up">Create an account</Link></>}
    >
      <SignInForm callbackURL={safeCallback(callbackURL)} googleEnabled={isGoogleAuthConfigured()} />
    </AuthShell>
  )
}
