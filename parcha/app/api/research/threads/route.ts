import { getAuth } from "@/lib/auth"
import { listResearchThreads } from "@/lib/research/chat-storage"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request): Promise<Response> {
  const session = await getAuth().api.getSession({ headers: request.headers })
  if (!session) {
    return Response.json(
      { error: "Authentication required" },
      { status: 401, headers: { "cache-control": "no-store" } }
    )
  }

  const threads = await listResearchThreads(session.user.id)
  return Response.json(
    { threads },
    { headers: { "cache-control": "no-store" } }
  )
}
