import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { getAuth } from "@/lib/auth"
import { listResearchThreads } from "@/lib/research/chat-storage"
import type { ResearchMode } from "@/lib/research/types"

import { AiProChatWorkspace } from "./ai-pro-chat-workspace"
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

  const user = {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    emailVerified: session.user.emailVerified,
    image: session.user.image,
  }

  if (mode === "ai_pro") {
    const initialThreads = await listResearchThreads(session.user.id)
    return <AiProChatWorkspace user={user} initialThreads={initialThreads} />
  }

  return (
    <ResearchWorkspace
      mode={mode}
      user={user}
    />
  )
}
