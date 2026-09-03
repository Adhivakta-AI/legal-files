import type { Metadata } from "next"
import Link from "next/link"

import { ResetPasswordForm } from "@/components/auth/auth-forms"
import { AuthShell } from "@/components/auth/auth-shell"

export const metadata: Metadata = {
  title: "Choose a new password — Lex Archives",
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>
}) {
  const { token, error } = await searchParams
  return (
    <AuthShell
      eyebrow="Account recovery"
      title="Choose a new password."
      description="Changing your password signs your account out on every device."
      footer={<Link href="/forgot-password">Request another link</Link>}
    >
      <ResetPasswordForm token={token} invalid={Boolean(error)} />
    </AuthShell>
  )
}
