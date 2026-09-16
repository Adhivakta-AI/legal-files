import { getAuth } from "@/lib/auth"
import {
  deleteResearchThread,
  getResearchThread,
} from "@/lib/research/chat-storage"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

async function authenticatedUserId(request: Request): Promise<string | null> {
  const session = await getAuth().api.getSession({ headers: request.headers })
  return session?.user.id ?? null
}

async function threadIdFrom(context: {
  params: Promise<{ threadId: string }>
}): Promise<string | null> {
  const { threadId } = await context.params
  return UUID_PATTERN.test(threadId) ? threadId : null
}

export async function GET(
  request: Request,
  context: { params: Promise<{ threadId: string }> }
): Promise<Response> {
  const userId = await authenticatedUserId(request)
  if (!userId) {
    return Response.json(
      { error: "Authentication required" },
      { status: 401, headers: { "cache-control": "no-store" } }
    )
  }
  const threadId = await threadIdFrom(context)
  if (!threadId)
    return Response.json({ error: "Invalid conversation ID" }, { status: 400 })

  const thread = await getResearchThread(userId, threadId)
  if (!thread)
    return Response.json({ error: "Conversation not found" }, { status: 404 })
  return Response.json({ thread }, { headers: { "cache-control": "no-store" } })
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ threadId: string }> }
): Promise<Response> {
  const userId = await authenticatedUserId(request)
  if (!userId) {
    return Response.json(
      { error: "Authentication required" },
      { status: 401, headers: { "cache-control": "no-store" } }
    )
  }
  const threadId = await threadIdFrom(context)
  if (!threadId)
    return Response.json({ error: "Invalid conversation ID" }, { status: 400 })

  const deleted = await deleteResearchThread(userId, threadId)
  if (!deleted)
    return Response.json({ error: "Conversation not found" }, { status: 404 })
  return new Response(null, { status: 204 })
}
