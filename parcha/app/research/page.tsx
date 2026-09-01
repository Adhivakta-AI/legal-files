import type { Metadata } from "next"
import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { ResearchWorkspace } from "@/components/research/research-workspace"
import { getAuth } from "@/lib/auth"

export const metadata: Metadata = {
  title: "Research — Lex Archives",
  description:
    "Citation-grounded Indian Supreme Court research across the Lex Archives judgment index.",
}
export const dynamic = "force-dynamic"

export default async function ResearchPage() {
  const session = await getAuth().api.getSession({ headers: await headers() })
  if (!session) redirect("/sign-in?callbackURL=/research")

  return (
    <ResearchWorkspace
      user={{
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        emailVerified: session.user.emailVerified,
        image: session.user.image,
      }}
    />
  )
}
