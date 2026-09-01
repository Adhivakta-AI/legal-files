import type { Metadata } from "next"
import Link from "next/link"

import { VerifyEmailForm } from "@/components/auth/auth-forms"
import { AuthShell } from "@/components/auth/auth-shell"

export const metadata: Metadata = { title: "Verify email — Lex Archives" }

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; verified?: string; error?: string }>
}) {
  const params = await searchParams
  return (
    <AuthShell
      eyebrow="Email verification"
      title={params.verified === "true" ? "Address confirmed." : "Check your inbox."}
      description="Email verification protects the archive from automated abuse."
      footer={<Link href="/sign-in">Return to sign in</Link>}
    >
      <VerifyEmailForm
        initialEmail={params.email ?? ""}
        verified={params.verified === "true"}
        errorCode={params.error}
      />
    </AuthShell>
  )
}

