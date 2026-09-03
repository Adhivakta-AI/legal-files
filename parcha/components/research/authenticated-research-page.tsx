import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { getAuth } from "@/lib/auth"
import type { ResearchMode } from "@/lib/research/types"

import { ResearchWorkspace } from "./research-workspace"

export async function AuthenticatedResearchPage({
  mode,
  callbackURL,
}: {
  mode: ResearchMode
  callbackURL: string
}) {
  const session = await getAuth().api.getSession({ headers: await headers() })
  if (!session) redirect(`/sign-in?callbackURL=${callbackURL}`)

  return (
    <ResearchWorkspace
      mode={mode}
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
